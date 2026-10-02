/** Driven by scripts/fork-e2e.sh. Uses the exact library code the UI uses (src/lib/dbc.ts). */
import fs from 'fs'
import os from 'os'
import BN from 'bn.js'
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js'
import { getOrCreateAssociatedTokenAccount, mintTo, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import { DAMM_V2_MIGRATION_FEE_ADDRESS, DAMM_V2_PROGRAM_ID, deriveDammV2PoolAddress, getPriceFromSqrtPrice } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { buildLaunchPlan } from '../src/lib/curve'
import { buildLaunchTx, buildSwapTx, dbcClient, loadPoolByMint, PLATFORM_FEE_CLAIMER, quoteSwap } from '../src/lib/dbc'
import DLMM, { ActivationType as DlmmActivation, CollectFeeMode as DlmmCollect, ConcreteFunctionType } from '@meteora-ag/dlmm'
import { binIdForPrice, buildCommitTx, buildCreateConvictionPoolTx, buildWithdrawTx, CONVICTION_BIN_STEP, listMyCommitments, loadConvictionPool, readLadder } from '../src/lib/conviction'
import { TOTAL_SUPPLY } from '../src/lib/curve'
import { buildDammSwapTx, quoteDammSwap, successorPool } from '../src/lib/damm'
import { findLaunches } from '../src/lib/launches'
import { getPreset, PRESETS } from '../src/lib/presets'
import { getStock } from '../src/lib/stocks'

const conn = new Connection('http://127.0.0.1:8899', 'confirmed')
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path(), 'utf8'))))
const NVDAX = new PublicKey(getStock('NVDAx')!.mint)
const USD_PER_RAW = 232 // approx NVDAx price × ScaledUiAmount multiplier at time of writing; only sizes the curve

function path() {
    return process.env.KEYPAIR ?? `${os.homedir()}/.config/solana/id.json`
}

async function send(tx: Transaction, ...signers: Keypair[]) {
    tx.recentBlockhash ??= (await conn.getLatestBlockhash()).blockhash
    tx.feePayer ??= kp.publicKey
    tx.partialSign(kp, ...signers)
    const sig = await conn.sendRawTransaction(tx.serialize())
    await conn.confirmTransaction(sig, 'confirmed')
    return sig
}

/** For txs another wallet pays for and signs (finalized by our lib with feePayer = that wallet). */
async function sendAs(tx: Transaction, signer: Keypair) {
    tx.partialSign(signer)
    const sig = await conn.sendRawTransaction(tx.serialize())
    const { value } = await conn.confirmTransaction(sig, 'confirmed')
    if (value.err) throw new Error(`tx failed: ${JSON.stringify(value.err)}`)
    return sig
}

const balance = async (mint: PublicKey, owner: PublicKey, program = TOKEN_PROGRAM_ID) =>
    BigInt((await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(mint, owner, false, program)).catch(() => ({ value: { amount: '0' } }))).value.amount)

async function launch(presetId: string) {
    const plan = buildLaunchPlan({ preset: getPreset(presetId), usdPerRawStock: USD_PER_RAW, stockDecimals: 8 })
    const { txs, baseMintKeypair } = await buildLaunchTx({
        connection: conn,
        creator: kp.publicKey,
        quoteMint: NVDAX.toBase58(),
        plan,
        name: 'Fork Test',
        symbol: 'FORK',
        uri: `https://bellcurve-launch.vercel.app/api/meta?n=Fork&s=FORK&q=NVDAx&p=${presetId}`,
        firstBuyRaw: new BN(10_000_000), // 0.1 NVDAx
    })
    for (const tx of txs) await send(tx)
    return { plan, mint: baseMintKeypair.publicKey }
}

async function lifecycle(presetId: string) {
    const preset = getPreset(presetId)
    const { plan, mint: baseMint } = await launch(presetId)
    const baseMintKeypair = { publicKey: baseMint }
    const mint = baseMint.toBase58()
    const view = async () => (await loadPoolByMint(conn, mint))!

    const buyIn = new BN(100_000_000)
    let v = await view()
    const qb = await quoteSwap(conn, v, buyIn, false)
    await send(await buildSwapTx(conn, kp.publicKey, v, buyIn, qb.minimumAmountOut, false))
    v = await view()
    const sellIn = qb.outputAmount.divn(3)
    await send(await buildSwapTx(conn, kp.publicKey, v, sellIn, (await quoteSwap(conn, v, sellIn, true)).minimumAmountOut, true))

    v = await view()
    const fee = v.pool.poolState.creatorQuoteFee
    const claim = await dbcClient(conn).creator.claimCreatorTradingFee({
        creator: kp.publicKey,
        payer: kp.publicKey,
        pool: v.address,
        maxBaseAmount: new BN(0),
        maxQuoteAmount: new BN('18446744073709551615'),
    })
    await send(claim)

    // over-buy (3x covers the 50% Opening Bell launch fee): PartialFill stops exactly at the migration threshold and leaves the rest in the wallet
    v = await view()
    const fill = new BN(Math.ceil(plan.thresholdStock * 3 * 1e8))
    const qf = await quoteSwap(conn, v, fill, false)
    await send(await buildSwapTx(conn, kp.publicKey, v, fill, qf.minimumAmountOut, false))
    v = await view()
    if (v.progress < 1) throw new Error(`curve not complete: ${v.progress}`)

    const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[6] // MigrationFeeOption.Customizable
    const m = await dbcClient(conn).migration.migrateToDammV2({ payer: kp.publicKey, pool: v.address, dammConfig })
    const sig = await send(m.transaction, m.firstPositionNftKeypair, m.secondPositionNftKeypair)
    const damm = deriveDammV2PoolAddress(dammConfig, baseMintKeypair.publicKey, NVDAX)
    const ok = (await conn.getAccountInfo(damm))?.owner.equals(DAMM_V2_PROGRAM_ID) && (await view()).pool.poolState.isMigrated === 1
    if (!ok) throw new Error('migration did not produce a DAMM v2 pool')

    // graduation handling: the app derives the successor pool and trades it in-app
    v = await view()
    const successor = successorPool(v)
    if (!successor.equals(damm)) throw new Error(`successor pool mismatch: ${successor.toBase58()} vs ${damm.toBase58()}`)
    const before = await balance(baseMint, kp.publicKey)
    const qd = await quoteDammSwap(conn, successor, new BN(100_000_000), false) // buy with 1 NVDAx
    await send(await buildDammSwapTx(conn, kp.publicKey, successor, qd.poolState, new BN(100_000_000), qd.minimumAmountOut, false))
    const bought = (await balance(baseMint, kp.publicKey)) - before
    if (bought < BigInt(qd.minimumAmountOut.toString())) throw new Error('DAMM v2 buy returned less than the quoted minimum')
    const qs = await quoteDammSwap(conn, successor, new BN((bought / BigInt(2)).toString()), true)
    await send(await buildDammSwapTx(conn, kp.publicKey, successor, qs.poolState, new BN((bought / BigInt(2)).toString()), qs.minimumAmountOut, true))
    console.log(
        `✓ ${preset.id.padEnd(15)} launch+first buy, buy, sell, claim ${(Number(fee) / 1e8).toFixed(4)} NVDAx fees, fill (${(Number(qf.amountLeft) / 1e8).toFixed(2)} NVDAx unspent), migrate ${sig.slice(0, 8)}… -> DAMM v2, in-app buy+sell on DAMM v2`
    )
    return v.address.toBase58()
}

/** Conviction Pool next to a live (not graduated) launch: one wallet commits a sell wall, another commits support. */
async function conviction() {
    const { mint: base } = await launch('fair-discovery')
    let v = (await loadPoolByMint(conn, base.toBase58()))!
    const buy = new BN(200_000_000) // 2 NVDAx
    await send(await buildSwapTx(conn, kp.publicKey, v, buy, (await quoteSwap(conn, v, buy, false)).minimumAmountOut, false))
    v = (await loadPoolByMint(conn, base.toBase58()))!
    const price = getPriceFromSqrtPrice(v.pool.poolState.sqrtPrice, 6, 8).toNumber()

    await send(await buildCreateConvictionPoolTx({ connection: conn, creator: kp.publicKey, base, quote: NVDAX, baseDecimals: 6, quoteDecimals: 8, priceQuotePerBase: price }))
    const pool = (await loadConvictionPool(conn, base, NVDAX))!

    // creator commits half their tokens: "I only sell from 1.02x to 3x the current price"
    const held = await balance(base, kp.publicKey)
    const wallAmt = new BN((held / BigInt(2)).toString())
    const wall = await buildCommitTx({ connection: conn, pool, owner: kp.publicKey, kind: 'wall', amount: wallAmt, fromPrice: price * 1.02, toPrice: price * 3 })
    await send(wall.tx)

    // a second holder commits 5 NVDAx of support between 0.7x and 0.95x
    const fan = Keypair.generate()
    await conn.confirmTransaction(await conn.requestAirdrop(fan.publicKey, 5e9), 'confirmed')
    const fanAta = await getOrCreateAssociatedTokenAccount(conn, kp, NVDAX, fan.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID)
    await mintTo(conn, kp, NVDAX, fanAta.address, kp, BigInt(20) * BigInt(1e8), [], undefined, TOKEN_2022_PROGRAM_ID)
    const support = await buildCommitTx({ connection: conn, pool, owner: fan.publicKey, kind: 'support', amount: new BN(500_000_000), fromPrice: price * 0.95, toPrice: price * 0.7 })
    await sendAs(support.tx, fan)

    const l1 = await readLadder(pool, TOTAL_SUPPLY)
    const wallUi = Number(wallAmt.toString()) / 1e6
    if (Math.abs(l1.committedBase - wallUi) / wallUi > 0.01) throw new Error(`ladder wall ${l1.committedBase} != committed ${wallUi}`)
    if (Math.abs(l1.supportQuote - 5) > 0.01) throw new Error(`ladder support ${l1.supportQuote} != 5`)

    // the fan buys through the wall on DLMM: the wall fills and stays filled
    await pool.dlmm.refetchStates()
    const swapForY = !pool.o.baseIsX // buying base: input is quote
    const inAmt = new BN(100_000_000) // 1 NVDAx
    const arrays = await pool.dlmm.getBinArrayForSwap(swapForY)
    const q = pool.dlmm.swapQuote(inAmt, swapForY, new BN(200), arrays, true, 3)
    const swapTx = await pool.dlmm.swap({ inToken: NVDAX, outToken: base, inAmount: inAmt, minOutAmount: q.minOutAmount, lbPair: pool.address, user: fan.publicKey, binArraysPubkey: q.binArraysPubkey })
    swapTx.feePayer = fan.publicKey
    swapTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash
    await sendAs(swapTx, fan)
    const l2 = await readLadder(pool, TOTAL_SUPPLY)
    if (!(l2.committedBase < l1.committedBase)) throw new Error('buying through the wall did not fill it')

    // creator withdraws: unfilled tokens + the NVDAx their wall sold for come back
    const [mine] = await listMyCommitments(pool, kp.publicKey)
    const quoteBefore = await balance(NVDAX, kp.publicKey, TOKEN_2022_PROGRAM_ID)
    const binIds = mine.limitOrderData.limitOrderBinData.filter((b) => !b.empty).map((b) => b.binId)
    await send(await buildWithdrawTx(conn, pool, kp.publicKey, mine.publicKey, binIds))
    const gotQuote = Number((await balance(NVDAX, kp.publicKey, TOKEN_2022_PROGRAM_ID)) - quoteBefore) / 1e8
    if (!(gotQuote > 0)) throw new Error('withdraw returned no sale proceeds for the filled wall')
    const l3 = await readLadder(pool, TOTAL_SUPPLY)
    if (l3.committedBase > 1e-6) throw new Error(`wall still open after withdraw: ${l3.committedBase}`)
    console.log(
        `✓ conviction pool    wall ${wallUi.toFixed(0)} tokens (${l1.convictionPct.toFixed(3)}% of supply) + support 5 NVDAx by a 2nd wallet; DLMM buy filled ${(l1.committedBase - l2.committedBase).toFixed(0)} tokens; creator withdrew ${gotQuote.toFixed(4)} NVDAx of sale proceeds + unfilled tokens`
    )
}

/** Someone else creates the pair first, upside down (quote as X). Commitments must still land on the right side. */
async function convictionReversed() {
    const { mint: base } = await launch('fair-discovery')
    let v = (await loadPoolByMint(conn, base.toBase58()))!
    const buy = new BN(200_000_000)
    await send(await buildSwapTx(conn, kp.publicKey, v, buy, (await quoteSwap(conn, v, buy, false)).minimumAmountOut, false))
    v = (await loadPoolByMint(conn, base.toBase58()))!
    const price = getPriceFromSqrtPrice(v.pool.poolState.sqrtPrice, 6, 8).toNumber()
    const reversed = { baseIsX: false, baseDecimals: 6, quoteDecimals: 8 }
    const tx = await DLMM.createCustomizablePermissionlessLbPair2(conn, new BN(CONVICTION_BIN_STEP), NVDAX, base, new BN(binIdForPrice(price, reversed)), new BN(100), DlmmActivation.Timestamp, false, kp.publicKey, undefined, false, ConcreteFunctionType.LimitOrder, DlmmCollect.InputOnly)
    await send(tx)
    const pool = (await loadConvictionPool(conn, base, NVDAX))!
    if (pool.o.baseIsX) throw new Error('expected a reversed pair')
    const held = await balance(base, kp.publicKey)
    const wallAmt = new BN((held / BigInt(2)).toString())
    await send((await buildCommitTx({ connection: conn, pool, owner: kp.publicKey, kind: 'wall', amount: wallAmt, fromPrice: price * 1.5, toPrice: price * 4 })).tx)
    const l = await readLadder(pool, TOTAL_SUPPLY)
    const wallUi = Number(wallAmt.toString()) / 1e6
    const offMarket = l.rungs.filter((r) => r.wallBase > 0).every((r) => r.price > price * 1.45 && r.price < price * 4.1)
    if (Math.abs(l.committedBase - wallUi) / wallUi > 0.01 || !offMarket) throw new Error(`reversed pair: wall ${l.committedBase} vs ${wallUi}, prices ok=${offMarket}`)
    console.log(`✓ reversed pair      wall of ${wallUi.toFixed(0)} tokens lands above market at 1.5x–4x across non-adjacent bins even with quote as DLMM token X`)
}

async function main() {
    await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, 50e9), 'confirmed')
    const ata = await getOrCreateAssociatedTokenAccount(conn, kp, NVDAX, kp.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID)
    await mintTo(conn, kp, NVDAX, ata.address, kp, BigInt(50_000) * BigInt(1e8), [], undefined, TOKEN_2022_PROGRAM_ID)
    const pools: string[] = []
    for (const p of PRESETS) pools.push(await lifecycle(p.id))
    await conviction()
    await convictionReversed()

    // the launch index must find exactly these pools from signature history alone (no getProgramAccounts)
    const found = (await findLaunches(conn, PLATFORM_FEE_CLAIMER)).map((l) => l.pool)
    const missing = pools.filter((p) => !found.includes(p))
    // + the two conviction-flow launches
    if (missing.length || found.length !== pools.length + 2) throw new Error(`launch index mismatch: found ${found.length}, missing ${missing}`)
    console.log(`✓ launch index found all ${found.length} launches without getProgramAccounts`)
}

main().catch((e) => {
    console.error(e?.transactionLogs ?? '', e)
    process.exit(1)
})
