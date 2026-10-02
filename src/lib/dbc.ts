import BN from 'bn.js'
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js'
import {
    DynamicBondingCurveClient,
    getCurrentPoint,
    type PoolConfig,
    type VirtualPool,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import type { LaunchPlan } from './curve'
import { tokenBadgeFor } from './stocks'

export const PLATFORM_FEE_CLAIMER = new PublicKey(
    process.env.NEXT_PUBLIC_PLATFORM_FEE_CLAIMER ?? '11111111111111111111111111111111'
)

export const dbcClient = (connection: Connection) => new DynamicBondingCurveClient(connection, 'confirmed')

export type LaunchTx = {
    /** [createConfig, createPool(+firstBuy)] — must land in order */
    txs: Transaction[]
    configKeypair: Keypair
    baseMintKeypair: Keypair
    pool: PublicKey
}

/**
 * One transaction: create a per-launch DBC config (quote = xStock, with its TokenBadge)
 * + initialize the virtual pool. Optional creator first-buy is bundled in the same tx
 * so the creator gets the min-fee first swap and no bot can front-run them.
 */
export async function buildLaunchTx(args: {
    connection: Connection
    creator: PublicKey
    quoteMint: string
    plan: LaunchPlan
    name: string
    symbol: string
    uri: string
    firstBuyRaw?: BN
    useBadge?: boolean
}): Promise<LaunchTx> {
    const client = dbcClient(args.connection)
    const configKeypair = Keypair.generate()
    const baseMintKeypair = Keypair.generate()
    const quoteMint = new PublicKey(args.quoteMint)
    const common = {
        payer: args.creator,
        config: configKeypair.publicKey,
        feeClaimer: PLATFORM_FEE_CLAIMER,
        leftoverReceiver: PLATFORM_FEE_CLAIMER,
        quoteMint,
        tokenBadge: args.useBadge === false ? undefined : tokenBadgeFor(args.quoteMint),
        ...args.plan.config,
        preCreatePoolParam: {
            baseMint: baseMintKeypair.publicKey,
            name: args.name,
            symbol: args.symbol,
            uri: args.uri,
            poolCreator: args.creator,
        },
    }

    // Split into two txs: the config ix carries the full curve (up to 20 points) and
    // together with Token-2022 ATA creation + first buy it would overflow the 1232-byte limit.
    const res = await client.partner.createConfigAndPoolWithFirstBuy({
        ...common,
        firstBuyParam:
            args.firstBuyRaw && args.firstBuyRaw.gtn(0)
                ? { buyer: args.creator, buyAmount: args.firstBuyRaw, minimumAmountOut: new BN(1), referralTokenAccount: null }
                : undefined,
    })

    const { blockhash } = await args.connection.getLatestBlockhash('confirmed')
    const txs = [res.createConfigTx, res.createPoolWithFirstBuyTx]
    for (const tx of txs) {
        tx.recentBlockhash = blockhash
        tx.feePayer = args.creator
    }
    txs[0].partialSign(configKeypair)
    txs[1].partialSign(baseMintKeypair)

    const pool = await poolAddressFor(configKeypair.publicKey, baseMintKeypair.publicKey, quoteMint)
    return { txs, configKeypair, baseMintKeypair, pool }
}

export async function poolAddressFor(config: PublicKey, baseMint: PublicKey, quoteMint: PublicKey) {
    const { deriveDbcPoolAddress } = await import('@meteora-ag/dynamic-bonding-curve-sdk')
    return deriveDbcPoolAddress(quoteMint, baseMint, config)
}

export type PoolView = {
    address: PublicKey
    pool: VirtualPool
    config: PoolConfig
    progress: number // 0..1 toward graduation
}

export async function loadPoolByMint(connection: Connection, baseMint: string): Promise<PoolView | null> {
    const client = dbcClient(connection)
    const acc = await client.state.getPoolByBaseMint(baseMint)
    if (!acc) return null
    const config = await client.state.getPoolConfig(acc.account.poolState.config)
    if (!config) return null
    const progress = Math.min(
        1,
        Number(acc.account.poolState.quoteReserve.toString()) / Math.max(1, Number(config.migrationQuoteThreshold.toString()))
    )
    return { address: acc.publicKey, pool: acc.account, config, progress }
}

export async function quoteSwap(connection: Connection, view: PoolView, amountIn: BN, sell: boolean, slippageBps = 100) {
    const client = dbcClient(connection)
    const currentPoint = await getCurrentPoint(connection, view.config.activationType)
    return client.pool.swapQuote({
        virtualPool: view.pool,
        config: view.config,
        swapBaseForQuote: sell,
        amountIn,
        slippageBps,
        hasReferral: false,
        eligibleForFirstSwapWithMinFee: false,
        currentPoint,
    })
}

export async function buildSwapTx(connection: Connection, owner: PublicKey, view: PoolView, amountIn: BN, minOut: BN, sell: boolean) {
    const tx = await dbcClient(connection).pool.swap({
        owner,
        pool: view.address,
        amountIn,
        minimumAmountOut: minOut,
        swapBaseForQuote: sell,
        referralTokenAccount: null,
    })
    const { blockhash } = await connection.getLatestBlockhash('confirmed')
    tx.recentBlockhash = blockhash
    tx.feePayer = owner
    return tx
}

/** All launches made through this platform = all configs whose fee claimer is the platform wallet. */
export async function listPlatformLaunches(connection: Connection) {
    const client = dbcClient(connection)
    const configs = await client.state.getPoolConfigsByOwner(PLATFORM_FEE_CLAIMER)
    const pools = await Promise.all(configs.map((c) => client.state.getPoolsByConfig(c.publicKey).then((ps) => ps.map((p) => ({ ...p, config: c.account })))))
    return pools.flat()
}
