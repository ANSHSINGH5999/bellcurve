import BN from 'bn.js'
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, type TransactionInstruction } from '@solana/web3.js'
import {
    DynamicBondingCurveClient,
    getCurrentPoint,
    SwapMode,
    type PoolConfig,
    type VirtualPool,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import type { LaunchPlan } from './curve'
import type { LaunchRef } from './launches'
import { tokenBadgeFor } from './stocks'

export const PLATFORM_FEE_CLAIMER = new PublicKey(
    process.env.NEXT_PUBLIC_PLATFORM_FEE_CLAIMER ?? '11111111111111111111111111111111'
)

/** confirmTransaction resolves even when the tx failed on-chain; this throws instead. */
export async function confirmOrThrow(connection: Connection, sig: string) {
    const { value } = await connection.confirmTransaction(sig, 'confirmed')
    if (value.err) throw new Error(`Transaction failed on-chain (${JSON.stringify(value.err)}) — ${sig.slice(0, 10)}…`)
}

/**
 * Busy mainnet drops unprioritized txs. Adds a compute-unit price (recent median, clamped) and, if the SDK
 * didn't set one, a compute-unit limit sized by simulation. Max cost at the cap is ~0.0004 SOL per tx.
 * Must run before signing.
 */
export async function withPriorityFee(connection: Connection, tx: Transaction, fallbackUnits = 400_000) {
    const has = (code: number) => tx.instructions.some((ix) => ix.programId.equals(ComputeBudgetProgram.programId) && ix.data[0] === code)
    const pre: TransactionInstruction[] = []
    if (!has(2)) {
        const sim = await connection.simulateTransaction(tx).catch(() => null)
        const used = sim && !sim.value.err ? sim.value.unitsConsumed : undefined
        pre.push(ComputeBudgetProgram.setComputeUnitLimit({ units: used ? Math.ceil(used * 1.2) + 10_000 : fallbackUnits }))
    }
    if (!has(3)) {
        const fees = (await connection.getRecentPrioritizationFees().catch(() => [])).map((f) => f.prioritizationFee).filter((f) => f > 0).sort((a, b) => a - b)
        const median = fees.length ? fees[Math.floor(fees.length / 2)] : 0
        pre.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.min(Math.max(median, 50_000), 1_000_000) }))
    }
    tx.instructions.unshift(...pre)
    return tx
}

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
    // tx 2 can't be simulated before tx 1 creates the config, so it uses the fallback limit
    await Promise.all(txs.map((tx) => withPriorityFee(args.connection, tx)))
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

/** `poolHint` (from the launch link) skips getPoolByBaseMint, a getProgramAccounts scan that many public RPCs block. */
export async function loadPoolByMint(connection: Connection, baseMint: string, poolHint?: string): Promise<PoolView | null> {
    const client = dbcClient(connection)
    const hinted = poolHint ? await client.state.getPool(poolHint) : null
    const acc =
        hinted && hinted.poolState.baseMint.toBase58() === baseMint
            ? { publicKey: new PublicKey(poolHint!), account: hinted }
            : await client.state.getPoolByBaseMint(baseMint)
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
    // PartialFill: a buy larger than what's left on the curve fills up to graduation and leaves the rest unspent,
    // instead of reverting with "Insufficient Liquidity" — so anyone can make the graduating buy
    const q = client.pool.swapQuote2({
        virtualPool: view.pool,
        config: view.config,
        swapBaseForQuote: sell,
        swapMode: SwapMode.PartialFill,
        amountIn,
        slippageBps,
        hasReferral: false,
        eligibleForFirstSwapWithMinFee: false,
        currentPoint,
    })
    return { outputAmount: q.outputAmount, minimumAmountOut: q.minimumAmountOut!, amountLeft: q.amountLeft }
}

export async function buildSwapTx(connection: Connection, owner: PublicKey, view: PoolView, amountIn: BN, minOut: BN, sell: boolean) {
    const tx = await dbcClient(connection).pool.swap2({
        owner,
        pool: view.address,
        swapMode: SwapMode.PartialFill,
        amountIn,
        minimumAmountOut: minOut,
        swapBaseForQuote: sell,
        referralTokenAccount: null,
    })
    const { blockhash } = await connection.getLatestBlockhash('confirmed')
    tx.recentBlockhash = blockhash
    tx.feePayer = owner
    return withPriorityFee(connection, tx)
}

/** All launches made through this platform (configs whose fee claimer is the platform wallet), via /api/launches. */
export async function listPlatformLaunches(connection: Connection) {
    const res = await fetch('/api/launches')
    const refs = (await res.json()) as LaunchRef[] | { error: string }
    if ('error' in refs) throw new Error(refs.error)
    const client = dbcClient(connection)
    const rows = await Promise.all(
        refs.map(async (r) => {
            const [account, config] = await Promise.all([client.state.getPool(r.pool), client.state.getPoolConfig(r.config)])
            return account && config ? { publicKey: new PublicKey(r.pool), account, config } : null
        })
    )
    return rows.filter((r) => r !== null)
}
