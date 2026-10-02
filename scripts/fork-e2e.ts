/** Driven by scripts/fork-e2e.sh. Uses the exact library code the UI uses (src/lib/dbc.ts). */
import fs from 'fs'
import os from 'os'
import BN from 'bn.js'
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js'
import { getOrCreateAssociatedTokenAccount, mintTo, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import { DAMM_V2_MIGRATION_FEE_ADDRESS, DAMM_V2_PROGRAM_ID, deriveDammV2PoolAddress } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { buildLaunchPlan } from '../src/lib/curve'
import { buildLaunchTx, buildSwapTx, dbcClient, loadPoolByMint, PLATFORM_FEE_CLAIMER, quoteSwap } from '../src/lib/dbc'
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

async function lifecycle(presetId: string) {
    const preset = getPreset(presetId)
    const plan = buildLaunchPlan({ preset, usdPerRawStock: USD_PER_RAW, stockDecimals: 8 })
    const { txs, baseMintKeypair } = await buildLaunchTx({
        connection: conn,
        creator: kp.publicKey,
        quoteMint: NVDAX.toBase58(),
        plan,
        name: 'Fork Test',
        symbol: 'FORK',
        uri: `https://bellcurve-launch.vercel.app/api/meta?n=Fork&s=FORK&q=NVDAx&p=${preset.id}`,
        firstBuyRaw: new BN(10_000_000), // 0.1 NVDAx
    })
    for (const tx of txs) await send(tx)
    const mint = baseMintKeypair.publicKey.toBase58()
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
    console.log(
        `✓ ${preset.id.padEnd(15)} launch+first buy, buy, sell, claim ${(Number(fee) / 1e8).toFixed(4)} NVDAx fees, fill (${(Number(qf.amountLeft) / 1e8).toFixed(2)} NVDAx unspent), migrate ${sig.slice(0, 8)}… -> DAMM v2 ${damm.toBase58()}`
    )
    return v.address.toBase58()
}

async function main() {
    await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, 50e9), 'confirmed')
    const ata = await getOrCreateAssociatedTokenAccount(conn, kp, NVDAX, kp.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID)
    await mintTo(conn, kp, NVDAX, ata.address, kp, BigInt(50_000) * BigInt(1e8), [], undefined, TOKEN_2022_PROGRAM_ID)
    const pools: string[] = []
    for (const p of PRESETS) pools.push(await lifecycle(p.id))

    // the launch index must find exactly these pools from signature history alone (no getProgramAccounts)
    const found = (await findLaunches(conn, PLATFORM_FEE_CLAIMER)).map((l) => l.pool)
    const missing = pools.filter((p) => !found.includes(p))
    if (missing.length || found.length !== pools.length) throw new Error(`launch index mismatch: found ${found.length}, missing ${missing}`)
    console.log(`✓ launch index found all ${found.length} launches without getProgramAccounts`)
}

main().catch((e) => {
    console.error(e?.transactionLogs ?? '', e)
    process.exit(1)
})
