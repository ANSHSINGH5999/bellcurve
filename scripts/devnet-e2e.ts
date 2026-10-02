/**
 * End-to-end devnet proof: mock xStock (Token-2022, 8 decimals) -> StockCurve launch -> buy -> sell.
 *
 *   solana-keygen new -o ~/.config/solana/id.json   (if you don't have one)
 *   solana airdrop 2 --url devnet                   (or https://faucet.solana.com)
 *   pnpm devnet:e2e
 *
 * Prints the mock stock mint (put it in NEXT_PUBLIC_DEVNET_MOCK_STOCK_MINT) and the launched token mint.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import BN from 'bn.js'
import { Connection, Keypair, sendAndConfirmTransaction, Transaction } from '@solana/web3.js'
import {
    createMint,
    getOrCreateAssociatedTokenAccount,
    mintTo,
    TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token'
import { DynamicBondingCurveClient, getCurrentPoint } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { buildLaunchPlan } from '../src/lib/curve'
import { getPreset } from '../src/lib/presets'

const RPC = process.env.RPC_URL ?? 'https://api.devnet.solana.com'
const KEY = process.env.KEYPAIR ?? path.join(os.homedir(), '.config/solana/id.json')
const MOCK_USD = 200 // pretend the mock stock trades at $200
const PRESET = process.env.PRESET ?? 'opening-bell'

async function main() {
    const conn = new Connection(RPC, 'confirmed')
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEY, 'utf8'))))
    console.log('wallet', payer.publicKey.toBase58(), 'SOL', (await conn.getBalance(payer.publicKey)) / 1e9)

    // 1. mock xStock: plain Token-2022, 8 decimals (permissionless quote on DBC, no badge needed)
    let stockMint = process.env.MOCK_STOCK_MINT
    if (!stockMint) {
        const m = await createMint(conn, payer, payer.publicKey, null, 8, Keypair.generate(), undefined, TOKEN_2022_PROGRAM_ID)
        stockMint = m.toBase58()
        const ata = await getOrCreateAssociatedTokenAccount(conn, payer, m, payer.publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID)
        await mintTo(conn, payer, m, ata.address, payer, BigInt(10_000) * BigInt(10 ** 8), [], undefined, TOKEN_2022_PROGRAM_ID)
        console.log('✓ mock stock mint', stockMint, '(10,000 minted to wallet)')
    }

    // 2. plan the curve with the same engine as the UI
    const plan = buildLaunchPlan({ preset: getPreset(PRESET), usdPerRawStock: MOCK_USD, stockDecimals: 8 })
    console.log(`✓ plan ${PRESET}: raise ${plan.thresholdStock.toFixed(2)} mock-stock (~$${plan.thresholdUsd.toFixed(0)})`)

    // 3. create config + pool
    const client = new DynamicBondingCurveClient(conn, 'confirmed')
    const config = Keypair.generate()
    const baseMint = Keypair.generate()
    const { createConfigTx, createPoolWithFirstBuyTx } = await client.partner.createConfigAndPoolWithFirstBuy({
        payer: payer.publicKey,
        config: config.publicKey,
        feeClaimer: payer.publicKey,
        leftoverReceiver: payer.publicKey,
        quoteMint: new (await import('@solana/web3.js')).PublicKey(stockMint),
        ...plan.config,
        preCreatePoolParam: {
            baseMint: baseMint.publicKey,
            name: 'StockCurve Devnet Test',
            symbol: 'SCDT',
            uri: 'https://stockcurve.vercel.app/api/meta?n=StockCurve%20Devnet%20Test&s=SCDT&q=mNVDAx&p=' + PRESET,
            poolCreator: payer.publicKey,
        },
        firstBuyParam: {
            buyer: payer.publicKey,
            buyAmount: new BN(1).mul(new BN(10).pow(new BN(8))), // 1 mock stock
            minimumAmountOut: new BN(1),
            referralTokenAccount: null,
        },
    })
    const s1 = await sendAndConfirmTransaction(conn, createConfigTx, [payer, config])
    console.log('✓ config', config.publicKey.toBase58(), s1)
    const s2 = await sendAndConfirmTransaction(conn, createPoolWithFirstBuyTx, [payer, baseMint])
    console.log('✓ pool + first buy', baseMint.publicKey.toBase58(), s2)

    // 4. buy again through the normal swap path, then sell half
    const pool = await client.state.getPoolByBaseMint(baseMint.publicKey)
    if (!pool) throw new Error('pool not found')
    const cfg = (await client.state.getPoolConfig(pool.account.poolState.config))!
    const point = await getCurrentPoint(conn, cfg.activationType)
    const buyIn = new BN(5).mul(new BN(10).pow(new BN(8)))
    const q = client.pool.swapQuote({
        virtualPool: pool.account,
        config: cfg,
        swapBaseForQuote: false,
        amountIn: buyIn,
        slippageBps: 200,
        hasReferral: false,
        eligibleForFirstSwapWithMinFee: false,
        currentPoint: point,
    })
    const buyTx = await client.pool.swap({
        owner: payer.publicKey,
        pool: pool.publicKey,
        amountIn: buyIn,
        minimumAmountOut: q.minimumAmountOut,
        swapBaseForQuote: false,
        referralTokenAccount: null,
    })
    console.log('✓ buy 5 mock-stock ->', q.outputAmount.toString(), 'base', await sendAndConfirmTransaction(conn, buyTx, [payer]))

    const sellIn = new BN(q.outputAmount.toString()).divn(2)
    const sellTx = await client.pool.swap({
        owner: payer.publicKey,
        pool: pool.publicKey,
        amountIn: sellIn,
        minimumAmountOut: new BN(0),
        swapBaseForQuote: true,
        referralTokenAccount: null,
    })
    console.log('✓ sell half', await sendAndConfirmTransaction(conn, sellTx, [payer]))

    const after = await client.state.getPoolByBaseMint(baseMint.publicKey)
    console.log('✓ quote reserve', after!.account.poolState.quoteReserve.toString(), 'creator fee', after!.account.poolState.creatorQuoteFee.toString())
    console.log(`\nNEXT_PUBLIC_DEVNET_MOCK_STOCK_MINT=${stockMint}\nToken page: /t/${baseMint.publicKey.toBase58()}`)
    void Transaction
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
