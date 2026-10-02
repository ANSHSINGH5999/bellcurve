'use client'
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import BN from 'bn.js'
import type { PublicKey } from '@solana/web3.js'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { getPriceFromSqrtPrice, type ConfigParameters } from '@meteora-ag/dynamic-bonding-curve-sdk'
import ConvictionPanel from '@/components/ConvictionPanel'
import CurveChart from '@/components/CurveChart'
import { simulateCurve, TOTAL_SUPPLY } from '@/lib/curve'
import { buildSwapTx, confirmOrThrow, dbcClient, loadPoolByMint, quoteSwap, withPriorityFee, type PoolView } from '@/lib/dbc'
import { explorer } from '@/lib/env'
import { fmtUsd, useStockQuote } from '@/lib/hooks'
import { fetchTokenImage, fetchTokenMeta, type TokenMeta } from '@/lib/metadata'
import { getPreset } from '@/lib/presets'
import { getStock } from '@/lib/stocks'
import { buildSolToStockTx, quoteSolToStock, type JupQuote } from '@/lib/zap'
import { buildDammSwapTx, quoteDammSwap, successorPool, type DammQuote } from '@/lib/damm'

export default function TokenPage({ params }: { params: Promise<{ mint: string }> }) {
    const { mint } = use(params)
    const poolHint = useSearchParams().get('pool') ?? undefined
    const { connection } = useConnection()
    const wallet = useWallet()
    const { setVisible } = useWalletModal()
    const [view, setView] = useState<PoolView | null | undefined>(undefined)
    const [meta, setMeta] = useState<TokenMeta | null>(null)

    const refresh = useCallback(() => loadPoolByMint(connection, mint, poolHint).then(setView).catch(() => setView(null)), [connection, mint, poolHint])
    useEffect(() => {
        refresh()
        fetchTokenMeta(connection, mint)
            .then((m) => {
                setMeta(m)
                if (m) fetchTokenImage(m).then((image) => image && setMeta({ ...m, image })).catch(() => {})
            })
            .catch(() => {})
        const t = setInterval(refresh, 10_000)
        return () => clearInterval(t)
    }, [connection, mint, refresh])

    const quoteMint = view?.config.quoteMint.toBase58()
    const stock = quoteMint ? getStock(quoteMint) : undefined
    const qDec = stock?.decimals ?? 8
    const sq = useStockQuote(quoteMint)
    const usdPerRaw = sq.usdPerRaw ?? 0

    const derived = useMemo(() => {
        if (!view) return null
        const baseDec = view.config.tokenDecimal
        const priceStock = getPriceFromSqrtPrice(view.pool.poolState.sqrtPrice, baseDec, qDec).toNumber()
        // priced in shares, so the change in stock terms is exactly the return vs. just holding the stock
        const alphaPct = (priceStock / getPriceFromSqrtPrice(view.config.sqrtStartPrice, baseDec, qDec).toNumber() - 1) * 100
        const points = simulateCurve(view.config as unknown as ConfigParameters, qDec, usdPerRaw || 1)
        const nearest = points.reduce((a, b) => (Math.abs(b.priceStock - priceStock) < Math.abs(a.priceStock - priceStock) ? b : a), points[0])
        const raisedStock = Number(view.pool.poolState.quoteReserve.toString()) / 10 ** qDec
        const creatorFeeStock = Number(view.pool.poolState.creatorQuoteFee.toString()) / 10 ** qDec
        return { baseDec, priceStock, alphaPct, points, marker: nearest?.pctSold, raisedStock, creatorFeeStock }
    }, [view, qDec, usdPerRaw])

    if (view === undefined) return <p className="text-muted">Loading pool…</p>
    if (view === null || !derived) return <p className="text-muted">No BellCurve pool found for {mint}.</p>

    const isCreator = wallet.publicKey?.equals(view.pool.poolState.creator)
    const preset = meta?.preset ? getPreset(meta.preset) : undefined

    return (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <section className="space-y-4">
                <div className="card flex items-center gap-4 p-5">
                    {/* eslint-disable-next-line @next/next/no-img-element -- creator-supplied image URLs from any host */}
                    {meta?.image ? <img src={meta.image} alt="" className="h-14 w-14 rounded-xl object-cover" /> : <div className="h-14 w-14 rounded-xl bg-line" />}
                    <div className="flex-1">
                        <div className="text-xl font-bold">
                            {meta?.name ?? 'Unknown'} <span className="mono text-muted">${meta?.symbol}</span>
                        </div>
                        <div className="text-sm text-muted">
                            paired with <b style={{ color: stock?.color }}>{stock?.symbol ?? quoteMint?.slice(0, 6)}</b>
                            {preset && <> · {preset.name} curve</>} · <a className="underline" href={explorer(view.address.toBase58())} target="_blank">pool</a>
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="mono text-lg font-semibold">{fmtUsd(derived.priceStock * usdPerRaw * TOTAL_SUPPLY, 0)}</div>
                        <div className="text-xs text-muted">market cap</div>
                    </div>
                </div>

                <div className="card p-5">
                    <div className="mb-2 flex justify-between text-sm">
                        <span>{view.pool.poolState.isMigrated ? '🎓 Graduated to DAMM v2' : 'Bonding curve progress'}</span>
                        <span className="mono">{(view.progress * 100).toFixed(1)}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded bg-line">
                        <div className="h-full bg-accent" style={{ width: `${view.progress * 100}%` }} />
                    </div>
                    <div className="mt-2 text-xs text-muted mono">
                        {derived.raisedStock.toFixed(3)} / {(Number(view.config.migrationQuoteThreshold.toString()) / 10 ** qDec).toFixed(3)} {stock?.symbol} raised
                        ({fmtUsd(derived.raisedStock * usdPerRaw, 0)})
                    </div>
                    <div className="mt-4">
                        <CurveChart points={derived.points} color={stock?.color} marker={derived.marker} />
                    </div>
                </div>

                <div className="card flex items-center justify-between gap-4 p-5">
                    <div>
                        <div className="text-xs text-muted">Since launch, vs. just holding {stock?.symbol ?? 'the stock'}</div>
                        <div className={`mono text-2xl font-semibold ${derived.alphaPct >= 0 ? 'text-accent' : 'text-danger'}`}>
                            {derived.alphaPct >= 0 ? '+' : ''}
                            {derived.alphaPct.toFixed(1)}%
                        </div>
                    </div>
                    <p className="max-w-xs text-right text-xs text-muted">
                        This token is priced in {stock?.symbol ?? 'stock'}, so {stock?.ticker ?? 'the stock'} moving up or down doesn’t change this number. It’s pure outperformance.
                    </p>
                </div>

                <div className="card grid grid-cols-2 gap-3 p-5 text-sm sm:grid-cols-4">
                    <Mini k="Price" v={`${derived.priceStock.toExponential(3)} ${stock?.symbol ?? ''}`} />
                    <Mini k="Price (USD)" v={fmtUsd(derived.priceStock * usdPerRaw)} />
                    <Mini k={`${stock?.symbol} price`} v={fmtUsd(sq.usdPerUi)} />
                    <Mini k="Creator fees" v={`${derived.creatorFeeStock.toFixed(4)} ${stock?.symbol ?? ''}`} />
                </div>

                {stock && (
                    <ConvictionPanel
                        base={view.pool.poolState.baseMint}
                        quote={view.config.quoteMint}
                        symbol={meta?.symbol ? `$${meta.symbol}` : 'tokens'}
                        stockSymbol={stock.symbol}
                        baseDec={derived.baseDec}
                        qDec={qDec}
                        multiplier={sq.multiplier}
                        usdPerRaw={usdPerRaw}
                        marketPrice={derived.priceStock}
                    />
                )}
            </section>

            <section className="space-y-4">
                <TradePanel view={view} stockSymbol={stock?.symbol ?? 'quote'} qDec={qDec} baseDec={derived.baseDec} usdPerRaw={usdPerRaw} multiplier={sq.multiplier} paused={sq.paused} onDone={refresh} />
                {isCreator && (
                    <ClaimPanel view={view} amount={derived.creatorFeeStock} symbol={stock?.symbol ?? ''} onDone={refresh} />
                )}
                {!wallet.publicKey && (
                    <button className="btn btn-ghost w-full" onClick={() => setVisible(true)}>Connect wallet to trade</button>
                )}
            </section>
        </div>
    )
}

function Mini({ k, v }: { k: string; v: string }) {
    return (
        <div>
            <div className="text-xs text-muted">{k}</div>
            <div className="mono">{v}</div>
        </div>
    )
}

function TradePanel(props: { view: PoolView; stockSymbol: string; qDec: number; baseDec: number; usdPerRaw: number; multiplier: number; paused: boolean; onDone: () => void }) {
    const { view, stockSymbol, qDec, baseDec, usdPerRaw, multiplier, paused, onDone } = props
    const { connection } = useConnection()
    const wallet = useWallet()
    const [side, setSide] = useState<'buy' | 'sell'>('buy')
    const [paySol, setPaySol] = useState(false)
    const [jup, setJup] = useState<JupQuote | null>(null)
    const [amt, setAmt] = useState('')
    const [out, setOut] = useState<{ out: BN; min: BN; left: BN } | null>(null)
    const [msg, setMsg] = useState('')
    const sell = side === 'sell'
    const viaSol = paySol && !sell
    const priceKey = view.pool.poolState.sqrtPrice.toString()
    // after graduation the curve is closed: trade the DAMM v2 pool it migrated into
    const migrated = !!view.pool.poolState.isMigrated
    const dammPool = useMemo(() => (migrated ? successorPool(view) : null), [migrated, view])
    const dammState = useRef<DammQuote['poolState'] | null>(null)
    const quote = async (amountIn: BN) => {
        if (!dammPool) return quoteSwap(connection, view, amountIn, sell, 100)
        const q = await quoteDammSwap(connection, dammPool, amountIn, sell, 100)
        dammState.current = q.poolState
        return q
    }
    const build = (owner: PublicKey, amountIn: BN, min: BN, isSell: boolean) =>
        dammPool && dammState.current
            ? buildDammSwapTx(connection, owner, dammPool, dammState.current, amountIn, min, isSell)
            : buildSwapTx(connection, owner, view, amountIn, min, isSell)
    const inDec = sell ? baseDec : viaSol ? 9 : qDec
    const outDec = sell ? qDec : baseDec
    // wallets show xStocks in UI units (raw × ScaledUiAmount multiplier); the curve trades raw units
    const toRaw = (n: number) => new BN(Math.floor((sell || viaSol ? n : n / multiplier) * 10 ** inDec).toString())

    useEffect(() => {
        setOut(null)
        setJup(null)
        setMsg('')
        const n = Number(amt)
        if (!(n > 0)) return
        const t = setTimeout(async () => {
            try {
                let amountIn = toRaw(n)
                if (viaSol) {
                    // size the curve buy to Jupiter's guaranteed minimum so tx 2 can never be short of stock
                    const jq = await quoteSolToStock(view.config.quoteMint.toBase58(), BigInt(amountIn.toString()))
                    setJup(jq)
                    amountIn = new BN(jq.otherAmountThreshold)
                }
                const q = await quote(amountIn)
                setOut({ out: new BN(q.outputAmount.toString()), min: new BN(q.minimumAmountOut.toString()), left: new BN(q.amountLeft.toString()) })
            } catch (e) {
                setMsg((e as Error).message)
            }
        }, 300)
        return () => clearTimeout(t)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- toRaw/view are covered by the listed deps (priceKey = pool price)
    }, [amt, sell, viaSol, inDec, multiplier, connection, priceKey, dammPool])

    async function trade() {
        if (!wallet.publicKey || !wallet.signTransaction || !out) return
        try {
            setMsg('Confirm in wallet…')
            let sig: string
            if (viaSol && jup && wallet.signAllTransactions) {
                // one approval, two txs: Jupiter SOL -> stock, then the curve buy with the guaranteed minimum
                const swapTx = await buildSolToStockTx(jup, wallet.publicKey)
                const buyTx = await build(wallet.publicKey, new BN(jup.otherAmountThreshold), out.min, false)
                const [s1, s2] = await wallet.signAllTransactions([swapTx, buyTx] as (typeof swapTx | typeof buyTx)[])
                setMsg(`Swapping SOL → ${stockSymbol}…`)
                const sig1 = await connection.sendRawTransaction(s1.serialize())
                await confirmOrThrow(connection, sig1)
                setMsg(dammPool ? 'Buying on DAMM v2…' : 'Buying on the curve…')
                sig = await connection.sendRawTransaction(s2.serialize())
            } else {
                const tx = await build(wallet.publicKey, toRaw(Number(amt)), out.min, sell)
                sig = await connection.sendRawTransaction((await wallet.signTransaction(tx)).serialize())
            }
            await confirmOrThrow(connection, sig)
            setMsg(`✅ Done — ${sig.slice(0, 10)}…`)
            setAmt('')
            onDone()
        } catch (e) {
            setMsg(`❌ ${(e as Error).message}`)
        }
    }

    const outNum = out ? (Number(out.out.toString()) / 10 ** outDec) * (sell ? multiplier : 1) : 0
    return (
        <div className="card space-y-3 p-5">
            {dammPool && (
                <p className="text-xs text-muted">
                    🎓 Graduated: trading in the Meteora DAMM v2 pool, still paired with {stockSymbol}. Also on{' '}
                    <a className="underline" href={`https://jup.ag/swap?sell=${view.config.quoteMint.toBase58()}&buy=${view.pool.poolState.baseMint.toBase58()}`} target="_blank" rel="noreferrer">
                        Jupiter
                    </a>
                    .
                </p>
            )}
            <div className="grid grid-cols-2 gap-2">
                {(['buy', 'sell'] as const).map((s) => (
                    <button key={s} onClick={() => setSide(s)} className={`btn ${side === s ? (s === 'buy' ? 'btn-primary' : 'bg-danger text-black') : 'btn-ghost'}`}>
                        {s === 'buy' ? 'Buy' : 'Sell'}
                    </button>
                ))}
            </div>
            {!sell && (
                <div className="flex gap-2 text-xs">
                    {[false, true].map((v) => (
                        <button key={String(v)} onClick={() => setPaySol(v)} className={`tag ${paySol === v ? 'border-accent text-accent' : ''}`}>
                            Pay with {v ? 'SOL' : stockSymbol}
                        </button>
                    ))}
                </div>
            )}
            <label className="label">{sell ? 'Tokens to sell' : `${viaSol ? 'SOL' : stockSymbol} to spend`}</label>
            <input className="input mono" type="number" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="0.0" />
            <div className="text-sm text-muted">
                You receive ≈ <span className="mono text-text">{out ? outNum.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—'}</span>{' '}
                {sell ? stockSymbol : 'tokens'}
                {sell && out && <span className="mono"> ({fmtUsd((outNum * usdPerRaw) / multiplier)})</span>}
            </div>
            {viaSol && jup && (
                <p className="text-xs text-muted">
                    Routed by Jupiter: {amt} SOL → ≥ {((Number(jup.otherAmountThreshold) / 10 ** qDec) * multiplier).toFixed(4)} {stockSymbol} → curve. Any extra {stockSymbol} stays in your wallet.
                </p>
            )}
            {!sell && out && out.left.gtn(0) && (
                <p className="text-xs text-accent">
                    This buy completes the curve 🎓 — only part of it is used; {((Number(out.left.toString()) / 10 ** qDec) * multiplier).toFixed(4)} {stockSymbol} stays in your wallet.
                </p>
            )}
            <button className="btn btn-primary w-full" disabled={!wallet.publicKey || !out || paused} onClick={trade}>
                {paused ? `${stockSymbol} paused` : sell ? 'Sell' : 'Buy'}
            </button>
            {msg && <p className="text-xs text-muted break-all">{msg}</p>}
        </div>
    )
}

function ClaimPanel({ view, amount, symbol, onDone }: { view: PoolView; amount: number; symbol: string; onDone: () => void }) {
    const { connection } = useConnection()
    const wallet = useWallet()
    const [msg, setMsg] = useState('')
    async function claim() {
        if (!wallet.publicKey || !wallet.signTransaction) return
        try {
            const tx = await dbcClient(connection).creator.claimCreatorTradingFee({
                creator: wallet.publicKey,
                payer: wallet.publicKey,
                pool: view.address,
                maxBaseAmount: new BN(0),
                maxQuoteAmount: new BN('18446744073709551615'),
            })
            tx.feePayer = wallet.publicKey
            tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
            await withPriorityFee(connection, tx)
            const sig = await connection.sendRawTransaction((await wallet.signTransaction(tx)).serialize())
            await confirmOrThrow(connection, sig)
            setMsg('✅ Claimed')
            onDone()
        } catch (e) {
            setMsg(`❌ ${(e as Error).message}`)
        }
    }
    return (
        <div className="card space-y-2 p-5">
            <div className="text-sm">You created this token. Your fee earnings are paid in <b>{symbol}</b> — tokenized equity.</div>
            <button className="btn btn-ghost w-full" disabled={amount <= 0} onClick={claim}>
                Claim {amount.toFixed(4)} {symbol}
            </button>
            {msg && <p className="text-xs text-muted">{msg}</p>}
        </div>
    )
}
