'use client'
import { useCallback, useEffect, useState } from 'react'
import BN from 'bn.js'
import { PublicKey, type Transaction } from '@solana/web3.js'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
    buildCommitTx,
    buildCreateConvictionPoolTx,
    buildWithdrawTx,
    listMyCommitments,
    loadConvictionPool,
    quoteCommitCost,
    readLadder,
    type ConvictionPool,
} from '@/lib/conviction'
import { TOTAL_SUPPLY } from '@/lib/curve'
import { confirmOrThrow } from '@/lib/dbc'
import { fmtUsd } from '@/lib/hooks'

type Ladder = Awaited<ReturnType<typeof readLadder>>
type Mine = Awaited<ReturnType<typeof listMyCommitments>>

// Free RPCs throttle the account scan behind listMyCommitments, so also remember orders placed from this browser.
const storeKey = (pool: PublicKey, owner: PublicKey) => `bc:orders:${pool.toBase58()}:${owner.toBase58()}`
function storedOrders(pool: PublicKey, owner: PublicKey): string[] {
    try {
        return JSON.parse(localStorage.getItem(storeKey(pool, owner)) ?? '[]')
    } catch {
        return []
    }
}
function rememberOrder(pool: PublicKey, owner: PublicKey, order: PublicKey) {
    try {
        localStorage.setItem(storeKey(pool, owner), JSON.stringify([...new Set([...storedOrders(pool, owner), order.toBase58()])]))
    } catch {}
}

const RANGES = {
    wall: [
        { label: '1.5×–3×', from: 1.5, to: 3 },
        { label: '2×–5×', from: 2, to: 5 },
        { label: '5×–10×', from: 5, to: 10 },
    ],
    support: [
        { label: '−10% to −50%', from: 0.9, to: 0.5 },
        { label: '−30% to −70%', from: 0.7, to: 0.3 },
    ],
}

export default function ConvictionPanel(props: {
    base: PublicKey
    quote: PublicKey
    symbol: string
    stockSymbol: string
    baseDec: number
    qDec: number
    multiplier: number
    usdPerRaw: number
    /** current market price in raw stock per token (curve or DAMM v2), used to open the pool */
    marketPrice: number
}) {
    const { base, quote, symbol, stockSymbol, baseDec, qDec, multiplier, usdPerRaw, marketPrice } = props
    const { connection } = useConnection()
    const wallet = useWallet()
    const [pool, setPool] = useState<ConvictionPool | null | undefined>(undefined)
    const [ladder, setLadder] = useState<Ladder | null>(null)
    const [mine, setMine] = useState<Mine>([])
    const [kind, setKind] = useState<'wall' | 'support'>('wall')
    const [range, setRange] = useState(0)
    const [amt, setAmt] = useState('')
    const [msg, setMsg] = useState('')
    const [busy, setBusy] = useState(false)
    const [cost, setCost] = useState<Awaited<ReturnType<typeof quoteCommitCost>> | null>(null)

    const refresh = useCallback(async () => {
        const p = await loadConvictionPool(connection, base, quote).catch(() => null)
        setPool(p)
        if (!p) return
        setLadder(await readLadder(p, TOTAL_SUPPLY).catch(() => null))
        if (wallet.publicKey) {
            const owner = wallet.publicKey
            const scanned = await listMyCommitments(p, owner).catch(() => [] as Mine)
            const known = new Set(scanned.map((o) => o.publicKey.toBase58()))
            const extra = await Promise.all(
                storedOrders(p.address, owner)
                    .filter((k) => !known.has(k))
                    .map((k) => p.dlmm.getLimitOrder(new PublicKey(k)).catch(() => null))
            )
            // withdrawn orders are closed and simply drop out
            setMine([...scanned, ...extra.filter((o): o is Mine[number] => !!o && o.limitOrderData.limitOrderBinData.some((b) => !b.empty))])
        }
    }, [connection, base, quote, wallet.publicKey])

    useEffect(() => {
        refresh()
        const t = setInterval(refresh, 15_000)
        return () => clearInterval(t)
    }, [refresh])

    const market = ladder?.marketPrice
    useEffect(() => {
        setCost(null)
        if (!pool || !market) return
        const r = RANGES[kind][range]
        quoteCommitCost(pool, kind, market * r.from, market * r.to).then(setCost, () => setCost(null))
    }, [pool, market, kind, range])

    async function run(label: string, build: () => Promise<{ tx: Transaction; order?: PublicKey }>) {
        if (!wallet.publicKey || !wallet.signTransaction) return
        setBusy(true)
        try {
            setMsg('Confirm in wallet…')
            const { tx, order } = await build()
            const sig = await connection.sendRawTransaction((await wallet.signTransaction(tx)).serialize())
            setMsg(`${label}…`)
            await confirmOrThrow(connection, sig)
            if (order && pool) rememberOrder(pool.address, wallet.publicKey, order)
            setMsg(`✅ ${label} — ${sig.slice(0, 10)}…`)
            setAmt('')
            await refresh()
        } catch (e) {
            setMsg(`❌ ${(e as Error).message}`)
        } finally {
            setBusy(false)
        }
    }

    const owner = wallet.publicKey
    const openPool = () =>
        run('Opening Conviction Pool', async () => ({
            tx: await buildCreateConvictionPoolTx({ connection, creator: owner!, base, quote, baseDecimals: baseDec, quoteDecimals: qDec, priceQuotePerBase: marketPrice }),
        }))

    const commit = () => {
        const n = Number(amt)
        if (!pool || !ladder || !(n > 0)) return
        const r = RANGES[kind][range]
        // walls are in tokens; support is in the stock as wallets show it (UI = raw × multiplier)
        const raw = new BN(Math.floor((kind === 'wall' ? n : n / multiplier) * 10 ** (kind === 'wall' ? baseDec : qDec)).toString())
        return run(kind === 'wall' ? 'Committing sell wall' : 'Committing support', () =>
            buildCommitTx({ connection, pool, owner: owner!, kind, amount: raw, fromPrice: ladder.marketPrice * r.from, toPrice: ladder.marketPrice * r.to })
        )
    }

    const withdraw = (order: Mine[number]) =>
        run('Withdrawing commitment', async () => ({
            tx: await buildWithdrawTx(
                connection,
                pool!,
                owner!,
                order.publicKey,
                order.limitOrderData.limitOrderBinData.filter((b) => !b.empty).map((b) => b.binId)
            ),
        }))

    if (pool === undefined) return <div className="card p-5 text-sm text-muted">Loading Conviction Pool…</div>

    if (pool === null)
        return (
            <div className="card space-y-3 p-5">
                <h2 className="font-semibold">Conviction Pool</h2>
                <p className="text-sm text-muted">
                    Most launches graduate on hype nobody can verify. A Conviction Pool lets holders put it on-chain instead: “I only sell above 3×” (a sell
                    wall) or “I buy any dip to −30%” (support), as Meteora DLMM limit orders anyone can audit. Open one for ${symbol}; it trades against{' '}
                    {stockSymbol}.
                </p>
                <button className="btn btn-primary w-full" disabled={!owner || busy || !(marketPrice > 0)} onClick={openPool}>
                    {owner ? 'Open Conviction Pool' : 'Connect wallet to open'}
                </button>
                {msg && <p className="text-xs text-muted break-all">{msg}</p>}
            </div>
        )

    const usd = (rawStock: number) => (usdPerRaw > 0 ? fmtUsd(rawStock * usdPerRaw) : '—')
    const chart = ladder ? depthSeries(ladder, usdPerRaw) : []
    return (
        <div className="card space-y-4 p-5">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="font-semibold">Conviction Pool</h2>
                    <p className="text-xs text-muted">Public commitments as Meteora DLMM limit orders, priced in {stockSymbol}.</p>
                </div>
                {ladder && (
                    <div className="text-right">
                        <div className="mono text-2xl font-semibold text-accent">{ladder.convictionPct.toFixed(2)}%</div>
                        <div className="text-xs text-muted">of supply committed to sell only above market</div>
                    </div>
                )}
            </div>

            {ladder && (
                <>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-lg border border-line p-3">
                            <div className="text-xs text-muted">Sell walls (above market)</div>
                            <div className="mono">{ladder.committedBase.toLocaleString(undefined, { maximumFractionDigits: 0 })} {symbol}</div>
                            <div className="mono text-xs text-muted">{usd(ladder.rungs.reduce((s, r) => s + r.wallBase * r.price, 0))} at their prices</div>
                        </div>
                        <div className="rounded-lg border border-line p-3">
                            <div className="text-xs text-muted">Support (below market)</div>
                            <div className="mono">{(ladder.supportQuote * multiplier).toFixed(4)} {stockSymbol}</div>
                            <div className="mono text-xs text-muted">{usd(ladder.supportQuote)}</div>
                        </div>
                    </div>
                    {chart.length > 1 ? (
                        <div className="h-44 w-full">
                            <ResponsiveContainer>
                                <AreaChart data={chart} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                                    <CartesianGrid stroke="#1c2533" strokeDasharray="3 3" />
                                    <XAxis dataKey="x" type="number" scale="log" domain={['dataMin', 'dataMax']} tickFormatter={(v) => `${(+v).toFixed(v < 1 ? 2 : 1)}×`} stroke="#8392a7" fontSize={11} />
                                    <YAxis tickFormatter={(v) => fmtUsd(v, 0)} stroke="#8392a7" fontSize={11} width={56} />
                                    <Tooltip
                                        contentStyle={{ background: '#0e131b', border: '1px solid #1c2533', borderRadius: 10 }}
                                        labelFormatter={(v) => `${Number(v).toFixed(2)}× market price`}
                                        formatter={(v, k) => [fmtUsd(Number(v), 0), k === 'wall' ? 'Sell walls up to here' : 'Support down to here']}
                                    />
                                    <ReferenceLine x={1} stroke="#8392a7" strokeDasharray="4 4" />
                                    <Area type="stepBefore" dataKey="support" stroke="#34d399" fill="#34d39933" isAnimationActive={false} connectNulls={false} />
                                    <Area type="stepAfter" dataKey="wall" stroke="#f59e0b" fill="#f59e0b33" isAnimationActive={false} connectNulls={false} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <p className="text-sm text-muted">No commitments yet. Be the first to put your conviction on-chain.</p>
                    )}
                </>
            )}

            <div className="space-y-2 rounded-lg border border-line p-3">
                <div className="grid grid-cols-2 gap-2">
                    {(['wall', 'support'] as const).map((k) => (
                        <button key={k} onClick={() => (setKind(k), setRange(0))} className={`btn ${kind === k ? 'btn-primary' : 'btn-ghost'}`}>
                            {k === 'wall' ? 'Sell wall' : 'Support'}
                        </button>
                    ))}
                </div>
                <p className="text-xs text-muted">
                    {kind === 'wall'
                        ? `Commit ${symbol} you'll only sell at these prices. It fills as buyers push the price up; filled parts pay you ${stockSymbol}.`
                        : `Commit ${stockSymbol} that buys ${symbol} only if the price falls into this range.`}
                </p>
                <div className="flex flex-wrap gap-2">
                    {RANGES[kind].map((r, i) => (
                        <button key={r.label} onClick={() => setRange(i)} className={`tag ${range === i ? 'border-accent text-accent' : ''}`}>
                            {r.label}
                        </button>
                    ))}
                </div>
                <input className="input mono" type="number" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder={kind === 'wall' ? `${symbol} amount` : `${stockSymbol} amount`} />
                <button className="btn btn-primary w-full" disabled={!owner || busy || !(Number(amt) > 0) || !ladder} onClick={commit}>
                    {owner ? (kind === 'wall' ? 'Commit sell wall' : 'Commit support') : 'Connect wallet to commit'}
                </button>
                <p className="text-xs text-muted">
                    {cost
                        ? `Cost: ${cost.refundableSol.toFixed(4)} SOL deposit (refunded when you withdraw)${
                              cost.oneTimeSol > 0 ? ` + ${cost.oneTimeSol.toFixed(4)} SOL one-time DLMM rent: you're first in this price range (${cost.newBinArrays} bin array${cost.newBinArrays === 1 ? '' : 's'}), so this part isn't refunded` : ''
                          }. Withdraw unfilled amounts any time.`
                        : 'Calculating cost…'}
                </p>
            </div>

            {mine.length > 0 && (
                <div className="space-y-2">
                    <h3 className="text-sm font-semibold">My commitments</h3>
                    {mine.map((o) => {
                        const d = o.limitOrderData
                        const x = pool.o.baseIsX
                        const unfilledBase = Number(x ? d.totalUnfilledAmountX : d.totalUnfilledAmountY) / 10 ** baseDec
                        const unfilledQuote = Number(x ? d.totalUnfilledAmountY : d.totalUnfilledAmountX) / 10 ** qDec
                        // a wall deposits the token; support deposits the stock
                        const isWall = Number(x ? d.totalDepositAmountX : d.totalDepositAmountY) > 0
                        return (
                            <div key={o.publicKey.toBase58()} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3 text-sm">
                                <div className="mono text-xs">
                                    {isWall ? 'Wall' : 'Support'} · open {isWall ? `${unfilledBase.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${symbol}` : `${(unfilledQuote * multiplier).toFixed(4)} ${stockSymbol}`}
                                </div>
                                <button className="btn btn-ghost" disabled={busy} onClick={() => withdraw(o)}>
                                    Withdraw
                                </button>
                            </div>
                        )
                    })}
                </div>
            )}
            {msg && <p className="text-xs text-muted break-all">{msg}</p>}
        </div>
    )
}

/**
 * Cumulative depth either side of the market, x = multiple of market price, y = USD.
 * Walls fill as price rises (value holds until the next rung: stepAfter); support fills as it falls (stepBefore).
 */
function depthSeries(l: Ladder, usdPerRaw: number) {
    const m = l.marketPrice
    const sup = l.rungs.filter((r) => r.supportQuote > 0).sort((a, b) => b.price - a.price)
    const walls = l.rungs.filter((r) => r.wallBase > 0).sort((a, b) => a.price - b.price)
    const pts: { x: number; support?: number; wall?: number }[] = [{ x: 1, support: 0, wall: 0 }]
    let acc = 0
    for (const r of sup) pts.push({ x: r.price / m, support: (acc += r.supportQuote * usdPerRaw) })
    acc = 0
    for (const r of walls) pts.push({ x: r.price / m, wall: (acc += r.wallBase * r.price * usdPerRaw) })
    return pts.sort((a, b) => a.x - b.x)
}
