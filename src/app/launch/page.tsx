'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import BN from 'bn.js'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import CurveChart from '@/components/CurveChart'
import { buildLaunchPlan, LaunchPlanError, type LaunchPlan } from '@/lib/curve'
import { buildLaunchTx, confirmOrThrow } from '@/lib/dbc'
import { CLUSTER, SITE_URL, explorer } from '@/lib/env'
import { fmtUsd, useStockQuote, useUsdPrices } from '@/lib/hooks'
import { PRESETS, getPreset } from '@/lib/presets'
import { DEVNET_MOCK_STOCK, XSTOCKS, getStock } from '@/lib/stocks'

const STOCKS = CLUSTER === 'devnet' && DEVNET_MOCK_STOCK.mint ? [DEVNET_MOCK_STOCK] : XSTOCKS

export default function LaunchPage() {
    const router = useRouter()
    const { connection } = useConnection()
    const wallet = useWallet()
    const { setVisible } = useWalletModal()

    const [name, setName] = useState('')
    const [symbol, setSymbol] = useState('')
    const [image, setImage] = useState('')
    const [stockSym, setStockSym] = useState(STOCKS[0].symbol)
    const [presetId, setPresetId] = useState(PRESETS[0].id)
    const [startMcap, setStartMcap] = useState<number | ''>('')
    const [gradMcap, setGradMcap] = useState<number | ''>('')
    const [creatorShare, setCreatorShare] = useState(50)
    const [firstBuy, setFirstBuy] = useState<number | ''>('')
    const [status, setStatus] = useState<string>('')
    const [busy, setBusy] = useState(false)

    const stock = getStock(stockSym)!
    const preset = getPreset(presetId)
    const prices = useUsdPrices(STOCKS.map((s) => s.mint))
    const q = useStockQuote(stock.mint)
    const usdPerRaw = q.usdPerRaw

    const plan: LaunchPlan | { error: string } | null = useMemo(() => {
        if (!usdPerRaw) return null
        try {
            return buildLaunchPlan({
                preset,
                usdPerRawStock: usdPerRaw,
                stockDecimals: stock.decimals,
                startMcapUsd: startMcap || undefined,
                gradMcapUsd: gradMcap || undefined,
                creatorFeeSharePct: creatorShare,
            })
        } catch (e) {
            return { error: e instanceof LaunchPlanError ? e.message : `Curve error: ${(e as Error).message}` }
        }
    }, [preset, usdPerRaw, stock.decimals, startMcap, gradMcap, creatorShare])

    const ok = plan && !('error' in plan)
    const canLaunch = ok && name.trim() && symbol.trim() && !busy && !q.paused

    async function launch() {
        if (!wallet.publicKey || !wallet.signAllTransactions) return setVisible(true)
        if (!ok) return
        setBusy(true)
        try {
            setStatus('Building transactions…')
            const uri = `${SITE_URL}/api/meta?n=${encodeURIComponent(name)}&s=${encodeURIComponent(symbol)}&q=${stock.symbol}&p=${preset.id}${
                image ? `&i=${encodeURIComponent(image)}` : ''
            }`
            if (uri.length > 200) throw new Error('Image URL too long for on-chain metadata (max ~120 chars). Use a shorter link.')
            const firstBuyRaw =
                firstBuy && Number(firstBuy) > 0 ? new BN(Math.floor((Number(firstBuy) / q.multiplier) * 10 ** stock.decimals)) : undefined
            const { txs, baseMintKeypair, pool } = await buildLaunchTx({
                connection,
                creator: wallet.publicKey,
                quoteMint: stock.mint,
                plan,
                name: name.trim(),
                symbol: symbol.trim().toUpperCase(),
                uri,
                firstBuyRaw,
                useBadge: CLUSTER !== 'devnet',
            })
            setStatus('Approve in your wallet (2 transactions)…')
            const signed = await wallet.signAllTransactions(txs)
            for (const [i, tx] of signed.entries()) {
                setStatus(i === 0 ? 'Creating stock-quoted curve config…' : 'Creating pool' + (firstBuyRaw ? ' + your first buy…' : '…'))
                const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false })
                await confirmOrThrow(connection, sig)
            }
            router.push(`/t/${baseMintKeypair.publicKey.toBase58()}?pool=${pool.toBase58()}`)
        } catch (e) {
            setStatus(`❌ ${(e as Error).message}`)
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
            <section className="card space-y-5 p-5">
                <h1 className="text-xl font-bold">Launch a stock-paired token</h1>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="label">Name</label>
                        <input className="input" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} placeholder="Robotaxi Index" />
                    </div>
                    <div>
                        <label className="label">Ticker</label>
                        <input className="input mono" maxLength={10} value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="TAXI" />
                    </div>
                </div>
                <div>
                    <label className="label">Image URL (optional)</label>
                    <input className="input" value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…/logo.png" />
                </div>

                <div>
                    <label className="label">Quote asset — what buyers pay with & creators earn</label>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {STOCKS.map((s) => (
                            <button
                                key={s.symbol}
                                onClick={() => setStockSym(s.symbol)}
                                className={`rounded-lg border px-2 py-2 text-left text-sm ${s.symbol === stockSym ? 'border-accent bg-accent/10' : 'border-line'}`}
                            >
                                <div className="font-semibold" style={{ color: s.color }}>{s.symbol}</div>
                                <div className="mono text-xs text-muted">{fmtUsd(prices[s.mint])}</div>
                            </button>
                        ))}
                    </div>
                    {q.paused && <p className="mt-2 text-sm text-danger">{stock.symbol} is currently paused by its issuer — launches disabled.</p>}
                    {q.multiplier !== 1 && (
                        <p className="mt-2 text-xs text-muted">
                            Dividend-adjusted: {stock.symbol} ScaledUiAmount multiplier {q.multiplier.toFixed(6)} applied to the curve maths.
                        </p>
                    )}
                </div>

                <div>
                    <label className="label">Curve preset</label>
                    <div className="space-y-2">
                        {PRESETS.map((p) => (
                            <button
                                key={p.id}
                                onClick={() => setPresetId(p.id)}
                                className={`w-full rounded-lg border p-3 text-left ${p.id === presetId ? 'border-accent bg-accent/10' : 'border-line'}`}
                            >
                                <div className="flex items-center justify-between">
                                    <span className="font-semibold">{p.name}</span>
                                    <span className="mono text-xs text-muted">
                                        {fmtUsd(p.startMcapUsd, 0)} → {fmtUsd(p.gradMcapUsd, 0)} · fee {p.feeBps / 100}%
                                    </span>
                                </div>
                                <div className="text-xs text-muted">{p.tagline}</div>
                            </button>
                        ))}
                    </div>
                </div>

                <details className="rounded-lg border border-line p-3">
                    <summary className="cursor-pointer text-sm text-muted">Advanced</summary>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                        <div>
                            <label className="label">Start mcap (USD)</label>
                            <input className="input mono" type="number" placeholder={String(preset.startMcapUsd)} value={startMcap} onChange={(e) => setStartMcap(e.target.value ? +e.target.value : '')} />
                        </div>
                        <div>
                            <label className="label">Graduation mcap (USD)</label>
                            <input className="input mono" type="number" placeholder={String(preset.gradMcapUsd)} value={gradMcap} onChange={(e) => setGradMcap(e.target.value ? +e.target.value : '')} />
                        </div>
                        <div className="col-span-2">
                            <label className="label">Creator share of trading fees: {creatorShare}%</label>
                            <input type="range" min={0} max={100} value={creatorShare} onChange={(e) => setCreatorShare(+e.target.value)} className="w-full" />
                        </div>
                    </div>
                </details>

                <div>
                    <label className="label">Your first buy ({stock.symbol}, optional — lands in the create tx, unsnipeable)</label>
                    <input className="input mono" type="number" step="0.01" placeholder="0.5" value={firstBuy} onChange={(e) => setFirstBuy(e.target.value ? +e.target.value : '')} />
                </div>

                <button className="btn btn-primary w-full" disabled={!!wallet.publicKey && !canLaunch} onClick={launch}>
                    {!wallet.publicKey ? 'Connect wallet' : busy ? 'Launching…' : `Launch ${symbol || 'token'} / ${stock.symbol}`}
                </button>
                {status && <p className="text-sm text-muted">{status}</p>}
            </section>

            <section className="space-y-4">
                <div className="card p-5">
                    <div className="mb-2 flex items-center justify-between">
                        <h2 className="font-semibold">{preset.name}</h2>
                        <span className="tag">{stock.symbol} quoted</span>
                    </div>
                    <p className="mb-4 text-sm text-muted">{preset.description}</p>
                    {!plan && <p className="text-sm text-muted">Fetching {stock.symbol} price…</p>}
                    {plan && 'error' in plan && <p className="text-sm text-danger">{plan.error}</p>}
                    {ok && (
                        <>
                            <CurveChart points={plan.points} color={stock.color} />
                            <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                                <Stat k="Raise to graduate" v={`${plan.thresholdStock.toFixed(2)} ${stock.symbol}`} sub={fmtUsd(plan.thresholdUsd, 0)} />
                                <Stat k="Start price" v={`${plan.startPriceStock.toExponential(2)}`} sub={fmtUsd(plan.startPriceUsd)} />
                                <Stat k="Graduation mcap" v={fmtUsd(plan.gradPriceUsd * 1e9, 0)} sub="→ DAMM v2" />
                                <Stat k="Keeper floor" v={plan.thresholdUsd >= 750 ? '✓ auto-migrate' : '✗'} sub="≥ $750 eq." />
                            </div>
                            {plan.warnings.map((w) => (
                                <p key={w} className="mt-3 text-xs text-amber-400">{w}</p>
                            ))}
                        </>
                    )}
                </div>
                <div className="card p-5 text-sm text-muted">
                    <h3 className="mb-2 font-semibold text-text">What happens on-chain</h3>
                    <ol className="list-decimal space-y-1 pl-5">
                        <li>A dedicated DBC config is created with <b>{stock.symbol}</b> as quote mint (passing its DBC TokenBadge).</li>
                        <li>Your token mints into a virtual pool; all trading fees ({preset.feeBps / 100}%) are paid in {stock.symbol} — you get {creatorShare}%.</li>
                        <li>When the curve raises its threshold, Meteora keepers migrate it to a DAMM v2 pool ({preset.migratedFeeBps / 100}% fee{preset.migratedCollectMode === 2 ? ', compounding' : ''}).</li>
                        <li>60% of graduated LP is permanently locked. Token authority is immutable.</li>
                    </ol>
                    {CLUSTER === 'devnet' && <p className="mt-2">Devnet mode: quote = mock stock {DEVNET_MOCK_STOCK.mint && <a className="underline" href={explorer(DEVNET_MOCK_STOCK.mint)}>mint</a>}.</p>}
                </div>
            </section>
        </div>
    )
}

function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
    return (
        <div className="rounded-lg border border-line p-3">
            <div className="text-xs text-muted">{k}</div>
            <div className="mono font-semibold">{v}</div>
            {sub && <div className="mono text-xs text-muted">{sub}</div>}
        </div>
    )
}
