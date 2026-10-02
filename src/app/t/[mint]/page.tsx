'use client'
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import BN from 'bn.js'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { getPriceFromSqrtPrice, type ConfigParameters } from '@meteora-ag/dynamic-bonding-curve-sdk'
import CurveChart from '@/components/CurveChart'
import { simulateCurve, TOTAL_SUPPLY } from '@/lib/curve'
import { buildSwapTx, dbcClient, loadPoolByMint, quoteSwap, type PoolView } from '@/lib/dbc'
import { explorer } from '@/lib/env'
import { fmtUsd, useStockQuote } from '@/lib/hooks'
import { fetchTokenMeta, type TokenMeta } from '@/lib/metadata'
import { getPreset } from '@/lib/presets'
import { getStock } from '@/lib/stocks'

export default function TokenPage({ params }: { params: Promise<{ mint: string }> }) {
    const { mint } = use(params)
    const { connection } = useConnection()
    const wallet = useWallet()
    const { setVisible } = useWalletModal()
    const [view, setView] = useState<PoolView | null | undefined>(undefined)
    const [meta, setMeta] = useState<TokenMeta | null>(null)

    const refresh = useCallback(() => loadPoolByMint(connection, mint).then(setView).catch(() => setView(null)), [connection, mint])
    useEffect(() => {
        refresh()
        fetchTokenMeta(connection, mint).then(setMeta).catch(() => {})
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
        const points = simulateCurve(view.config as unknown as ConfigParameters, qDec, usdPerRaw || 1)
        const nearest = points.reduce((a, b) => (Math.abs(b.priceStock - priceStock) < Math.abs(a.priceStock - priceStock) ? b : a), points[0])
        const raisedStock = Number(view.pool.poolState.quoteReserve.toString()) / 10 ** qDec
        const creatorFeeStock = Number(view.pool.poolState.creatorQuoteFee.toString()) / 10 ** qDec
        return { baseDec, priceStock, points, marker: nearest?.pctSold, raisedStock, creatorFeeStock }
    }, [view, qDec, usdPerRaw])

    if (view === undefined) return <p className="text-muted">Loading pool…</p>
    if (view === null || !derived) return <p className="text-muted">No StockCurve pool found for {mint}.</p>

    const isCreator = wallet.publicKey?.equals(view.pool.poolState.creator)
    const preset = meta?.preset ? getPreset(meta.preset) : undefined

    return (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <section className="space-y-4">
                <div className="card flex items-center gap-4 p-5">
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

                <div className="card grid grid-cols-2 gap-3 p-5 text-sm sm:grid-cols-4">
                    <Mini k="Price" v={`${derived.priceStock.toExponential(3)} ${stock?.symbol ?? ''}`} />
                    <Mini k="Price (USD)" v={fmtUsd(derived.priceStock * usdPerRaw)} />
                    <Mini k={`${stock?.symbol} price`} v={fmtUsd(sq.usdPerUi)} />
                    <Mini k="Creator fees" v={`${derived.creatorFeeStock.toFixed(4)} ${stock?.symbol ?? ''}`} />
                </div>
            </section>

            <section className="space-y-4">
                <TradePanel view={view} stockSymbol={stock?.symbol ?? 'quote'} qDec={qDec} baseDec={derived.baseDec} usdPerRaw={usdPerRaw} paused={sq.paused} onDone={refresh} />
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

function TradePanel(props: { view: PoolView; stockSymbol: string; qDec: number; baseDec: number; usdPerRaw: number; paused: boolean; onDone: () => void }) {
    const { view, stockSymbol, qDec, baseDec, usdPerRaw, paused, onDone } = props
    const { connection } = useConnection()
    const wallet = useWallet()
    const [side, setSide] = useState<'buy' | 'sell'>('buy')
    const [amt, setAmt] = useState('')
    const [out, setOut] = useState<{ out: BN; min: BN } | null>(null)
    const [msg, setMsg] = useState('')
    const sell = side === 'sell'
    const inDec = sell ? baseDec : qDec
    const outDec = sell ? qDec : baseDec

    useEffect(() => {
        setOut(null)
        const n = Number(amt)
        if (!(n > 0)) return
        const amountIn = new BN(Math.floor(n * 10 ** inDec).toString())
        const t = setTimeout(() => {
            quoteSwap(connection, view, amountIn, sell, 100)
                .then((q) => setOut({ out: new BN(q.outputAmount.toString()), min: new BN(q.minimumAmountOut.toString()) }))
                .catch((e) => setMsg(e.message))
        }, 250)
        return () => clearTimeout(t)
    }, [amt, sell, inDec, connection, view])

    async function trade() {
        if (!wallet.publicKey || !wallet.signTransaction || !out) return
        try {
            setMsg('Confirm in wallet…')
            const amountIn = new BN(Math.floor(Number(amt) * 10 ** inDec).toString())
            const tx = await buildSwapTx(connection, wallet.publicKey, view, amountIn, out.min, sell)
            const signed = await wallet.signTransaction(tx)
            const sig = await connection.sendRawTransaction(signed.serialize())
            await connection.confirmTransaction(sig, 'confirmed')
            setMsg(`✅ Done — ${sig.slice(0, 10)}…`)
            setAmt('')
            onDone()
        } catch (e) {
            setMsg(`❌ ${(e as Error).message}`)
        }
    }

    const outNum = out ? Number(out.out.toString()) / 10 ** outDec : 0
    return (
        <div className="card space-y-3 p-5">
            <div className="grid grid-cols-2 gap-2">
                {(['buy', 'sell'] as const).map((s) => (
                    <button key={s} onClick={() => setSide(s)} className={`btn ${side === s ? (s === 'buy' ? 'btn-primary' : 'bg-danger text-black') : 'btn-ghost'}`}>
                        {s === 'buy' ? 'Buy' : 'Sell'}
                    </button>
                ))}
            </div>
            <label className="label">{sell ? 'Tokens to sell' : `${stockSymbol} to spend`}</label>
            <input className="input mono" type="number" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="0.0" />
            <div className="text-sm text-muted">
                You receive ≈ <span className="mono text-text">{out ? outNum.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—'}</span>{' '}
                {sell ? stockSymbol : 'tokens'}
                {sell && out && <span className="mono"> ({fmtUsd(outNum * usdPerRaw)})</span>}
            </div>
            <button className="btn btn-primary w-full" disabled={!wallet.publicKey || !out || paused || view.pool.poolState.isMigrated === 1} onClick={trade}>
                {view.pool.poolState.isMigrated ? 'Trade on Meteora DAMM v2' : paused ? `${stockSymbol} paused` : sell ? 'Sell' : 'Buy'}
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
            const sig = await connection.sendRawTransaction((await wallet.signTransaction(tx)).serialize())
            await connection.confirmTransaction(sig, 'confirmed')
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
