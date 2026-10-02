import BN from 'bn.js'
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js'
import DLMM, {
    ActivationType,
    CollectFeeMode,
    ConcreteFunctionType,
    deriveCustomizablePermissionlessLbPair,
    LBCLMM_PROGRAM_IDS,
} from '@meteora-ag/dlmm'
import { withPriorityFee } from './dbc'

/**
 * Conviction Pools: a DLMM pool next to every launch where holders make public, on-chain commitments as
 * DLMM limit orders — "I sell only above price P" (sell walls) and "I buy below price P" (support).
 * Limit orders, not plain liquidity: once a wall fills it stays filled, so a commitment can't silently revert.
 *
 * Prices are always "quote (stock) per base token", whatever orientation the DLMM pair was created in:
 * there is exactly one customizable DLMM pair per mint pair, and anyone could have created it.
 */
export const DLMM_PROGRAM = new PublicKey(LBCLMM_PROGRAM_IDS['mainnet-beta'])
export const CONVICTION_BIN_STEP = 100 // 1% per bin: coarse enough for thin, new markets
export const CONVICTION_FEE_BPS = 100
/** a commitment is spread over at most this many bins (they needn't be adjacent), so any price range fits one tx */
export const MAX_BINS_PER_COMMIT = 12

export const convictionPoolAddress = (base: PublicKey, quote: PublicKey) => deriveCustomizablePermissionlessLbPair(base, quote, DLMM_PROGRAM)[0]

export type Orientation = { baseIsX: boolean; baseDecimals: number; quoteDecimals: number }

/** Price (quote per base, UI units) → DLMM bin id, in the pair's own X/Y orientation. */
export function binIdForPrice(priceQuotePerBase: number, o: Orientation, binStep = CONVICTION_BIN_STEP, roundDown = true) {
    // DLMM prices are Y per X
    const yPerX = o.baseIsX ? priceQuotePerBase : 1 / priceQuotePerBase
    const [xDec, yDec] = o.baseIsX ? [o.baseDecimals, o.quoteDecimals] : [o.quoteDecimals, o.baseDecimals]
    return DLMM.getBinIdFromPrice(DLMM.getPricePerLamport(xDec, yDec, yPerX), binStep, roundDown)
}

/** Bin id → price (quote per base, UI units). */
export function priceForBinId(binId: number, o: Orientation, binStep = CONVICTION_BIN_STEP) {
    const [xDec, yDec] = o.baseIsX ? [o.baseDecimals, o.quoteDecimals] : [o.quoteDecimals, o.baseDecimals]
    const yPerXLamport = Math.pow(1 + binStep / 10_000, binId)
    const yPerX = yPerXLamport * 10 ** (xDec - yDec)
    return o.baseIsX ? yPerX : 1 / yPerX
}

export async function buildCreateConvictionPoolTx(args: {
    connection: Connection
    creator: PublicKey
    base: PublicKey
    quote: PublicKey
    baseDecimals: number
    quoteDecimals: number
    /** current market price, quote per base (curve or DAMM v2) — the pool opens there */
    priceQuotePerBase: number
}) {
    const o = { baseIsX: true, baseDecimals: args.baseDecimals, quoteDecimals: args.quoteDecimals }
    const tx = await DLMM.createCustomizablePermissionlessLbPair2(
        args.connection,
        new BN(CONVICTION_BIN_STEP),
        args.base,
        args.quote,
        new BN(binIdForPrice(args.priceQuotePerBase, o)),
        new BN(CONVICTION_FEE_BPS),
        ActivationType.Timestamp,
        false,
        args.creator,
        undefined,
        false,
        ConcreteFunctionType.LimitOrder,
        CollectFeeMode.InputOnly
    )
    return finalize(args.connection, tx, args.creator)
}

export async function loadConvictionPool(connection: Connection, base: PublicKey, quote: PublicKey) {
    const address = convictionPoolAddress(base, quote)
    if (!(await connection.getAccountInfo(address))) return null
    const dlmm = await DLMM.create(connection, address)
    const baseIsX = dlmm.tokenX.publicKey.equals(base)
    const o: Orientation = {
        baseIsX,
        baseDecimals: (baseIsX ? dlmm.tokenX : dlmm.tokenY).mint.decimals,
        quoteDecimals: (baseIsX ? dlmm.tokenY : dlmm.tokenX).mint.decimals,
    }
    return { address, dlmm, o }
}
export type ConvictionPool = NonNullable<Awaited<ReturnType<typeof loadConvictionPool>>>

/**
 * A commitment = one limit order spread evenly over bins between two prices (quote per base).
 * kind 'wall': sell base at prices ≥ fromPrice. kind 'support': buy base with quote at prices ≤ fromPrice.
 */
export async function buildCommitTx(args: {
    connection: Connection
    pool: ConvictionPool
    owner: PublicKey
    kind: 'wall' | 'support'
    /** base units of base (wall) or quote (support) */
    amount: BN
    fromPrice: number
    toPrice: number
}) {
    const { pool, kind } = args
    await pool.dlmm.refetchStates()
    const active = pool.dlmm.lbPair.activeId
    const ids = [binIdForPrice(args.fromPrice, pool.o), binIdForPrice(args.toPrice, pool.o)]
    // selling base = asking X when base is X, bidding (selling Y) when base is Y
    const isAskSide = (kind === 'wall') === pool.o.baseIsX
    // asks must sit above the active bin, bids below — clamp so an order never crosses the market
    let lo = Math.min(...ids)
    let hi = Math.max(...ids)
    if (isAskSide) lo = Math.max(lo, active + 1)
    else hi = Math.min(hi, active - 1)
    if (hi < lo) throw new Error(kind === 'wall' ? 'Wall prices must be above the current price' : 'Support prices must be below the current price')
    const n = Math.min(MAX_BINS_PER_COMMIT, hi - lo + 1)
    const ids2 = [...new Set(Array.from({ length: n }, (_, i) => Math.round(lo + (n === 1 ? 0 : ((hi - lo) * i) / (n - 1)))))]
    const per = args.amount.divn(ids2.length)
    if (per.isZero()) throw new Error('Amount too small to spread across these prices')
    const bins = ids2.map((id, i) => ({ id, amount: i === ids2.length - 1 ? args.amount.sub(per.muln(ids2.length - 1)) : per }))
    const order = Keypair.generate()
    const tx = await pool.dlmm.placeLimitOrder({
        owner: args.owner,
        payer: args.owner,
        sender: args.owner,
        limitOrder: order.publicKey,
        params: { isAskSide, relativeBin: null, bins },
    })
    await finalize(args.connection, tx, args.owner)
    tx.partialSign(order) // the limit-order account keypair co-signs; the wallet signs last
    return { tx, order: order.publicKey }
}

export type LadderRung = { price: number; wallBase: number; supportQuote: number }

/** Open commitments around the market, in quote-per-base prices, plus the headline numbers. */
/** span 240 bins ≈ 0.09x–10.9x at 1% bins: the full range commitments are allowed in */
export async function readLadder(pool: ConvictionPool, totalSupply: number, span = 240) {
    await pool.dlmm.refetchStates()
    const { activeBin, bins } = await pool.dlmm.getBinsAroundActiveBin(span, span)
    const bScale = 10 ** pool.o.baseDecimals
    const qScale = 10 ** pool.o.quoteDecimals
    const rungs: LadderRung[] = []
    for (const b of bins) {
        const open = Number((b.openOrderAmount ?? new BN(0)).toString())
        if (!open) continue
        // asks hold X above the active bin, bids hold Y below it
        const holdsX = b.binId > activeBin
        const holdsBase = holdsX === pool.o.baseIsX
        rungs.push({
            price: priceForBinId(b.binId, pool.o),
            wallBase: holdsBase ? open / bScale : 0,
            supportQuote: holdsBase ? 0 : open / qScale,
        })
    }
    rungs.sort((a, b) => a.price - b.price)
    const committedBase = rungs.reduce((s, r) => s + r.wallBase, 0)
    const supportQuote = rungs.reduce((s, r) => s + r.supportQuote, 0)
    return {
        marketPrice: priceForBinId(activeBin, pool.o),
        rungs,
        committedBase,
        supportQuote,
        /** share of total supply publicly committed to sell only above market */
        convictionPct: (committedBase / totalSupply) * 100,
    }
}

export async function listMyCommitments(pool: ConvictionPool, owner: PublicKey) {
    return pool.dlmm.getLimitOrderByUserAndLbPair(owner)
}

export async function buildWithdrawTx(connection: Connection, pool: ConvictionPool, owner: PublicKey, order: PublicKey, binIds: number[]) {
    const tx = await pool.dlmm.cancelLimitOrder({ limitOrderPubkey: order, owner, rentReceiver: owner, binIds })
    return finalize(connection, tx, owner)
}

async function finalize(connection: Connection, tx: Transaction, payer: PublicKey) {
    tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash
    tx.feePayer = payer
    return withPriorityFee(connection, tx)
}
