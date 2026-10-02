'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useConnection } from '@solana/wallet-adapter-react'
import { getPriceFromSqrtPrice } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { listPlatformLaunches } from '@/lib/dbc'
import { fmtUsd, useUsdPrices } from '@/lib/hooks'
import { XSTOCKS, getStock } from '@/lib/stocks'

type Row = { mint: string; quote: string; priceStock: number; progress: number; migrated: boolean }

export default function Home() {
    const { connection } = useConnection()
    const prices = useUsdPrices(XSTOCKS.map((s) => s.mint))
    const [rows, setRows] = useState<Row[] | null>(null)
    const [err, setErr] = useState('')

    useEffect(() => {
        listPlatformLaunches(connection)
            .then((ps) =>
                setRows(
                    ps.map((p) => {
                        const quote = p.config.quoteMint.toBase58()
                        const dec = getStock(quote)?.decimals ?? 8
                        return {
                            mint: p.account.poolState.baseMint.toBase58(),
                            quote,
                            priceStock: getPriceFromSqrtPrice(p.account.poolState.sqrtPrice, p.config.tokenDecimal, dec).toNumber(),
                            progress: Number(p.account.poolState.quoteReserve.toString()) / Math.max(1, Number(p.config.migrationQuoteThreshold.toString())),
                            migrated: !!p.account.poolState.isMigrated,
                        }
                    })
                )
            )
            .catch((e) => {
                setErr(String(e?.message ?? e))
                setRows([])
            })
    }, [connection])

    return (
        <div className="space-y-10">
            <section className="grid items-center gap-8 lg:grid-cols-2">
                <div className="space-y-4">
                    <span className="tag">Meteora DBC × DAMM v2 × xStocks</span>
                    <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
                        Launch tokens priced in <span className="text-accent">equities</span>, not SOL.
                    </h1>
                    <p className="text-muted">
                        StockCurve is a launchpad where every bonding curve is quoted in a tokenized stock — SPYx, NVDAx, TSLAx and more. Buyers pay in
                        stock, creators earn stock, and every graduated pool deepens on-chain equity liquidity on Meteora DAMM v2.
                    </p>
                    <div className="flex gap-3">
                        <Link href="/launch" className="btn btn-primary">Launch a token</Link>
                        <Link href="/presets" className="btn btn-ghost">Explore curve presets</Link>
                    </div>
                </div>
                <div className="card grid grid-cols-3 gap-px overflow-hidden p-0 sm:grid-cols-4">
                    {XSTOCKS.map((s) => (
                        <div key={s.mint} className="bg-panel p-3">
                            <div className="text-sm font-semibold" style={{ color: s.color }}>{s.symbol}</div>
                            <div className="mono text-xs text-muted">{fmtUsd(prices[s.mint])}</div>
                        </div>
                    ))}
                </div>
            </section>

            <section className="grid gap-4 sm:grid-cols-3">
                {[
                    ['Equity-denominated curves', 'Your token’s price is literally “X shares of NVDA”. USD targets are converted live using Jupiter prices and each xStock’s dividend multiplier.'],
                    ['Creators earn stock', 'All curve and post-graduation fees are collected in the quote asset — creators accumulate SPYx/NVDAx instead of dumping their own token.'],
                    ['Graduates to DAMM v2', 'Thresholds are enforced above Meteora’s $750 keeper floor, so every curve auto-migrates. 60% of LP is permanently locked.'],
                ].map(([t, d]) => (
                    <div key={t} className="card p-5">
                        <div className="mb-1 font-semibold">{t}</div>
                        <div className="text-sm text-muted">{d}</div>
                    </div>
                ))}
            </section>

            <section>
                <h2 className="mb-3 text-lg font-semibold">Live launches</h2>
                {rows === null && <p className="text-sm text-muted">Loading on-chain launches…</p>}
                {rows?.length === 0 && (
                    <p className="text-sm text-muted">
                        No launches yet — <Link className="underline" href="/launch">be the first</Link>.
                        {err && <span className="block text-xs">(RPC: {err.slice(0, 120)} — set NEXT_PUBLIC_RPC_URL to an RPC that allows getProgramAccounts)</span>}
                    </p>
                )}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {rows?.map((r) => {
                        const s = getStock(r.quote)
                        const usd = s ? (prices[s.mint] ?? 0) : 0
                        return (
                            <Link key={r.mint} href={`/t/${r.mint}`} className="card block p-4 hover:border-accent">
                                <div className="flex justify-between text-sm">
                                    <span className="mono">{r.mint.slice(0, 4)}…{r.mint.slice(-4)}</span>
                                    <span style={{ color: s?.color }}>{s?.symbol}</span>
                                </div>
                                <div className="mono mt-1 text-lg">{fmtUsd(r.priceStock * usd * 1e9, 0)}</div>
                                <div className="mt-2 h-1.5 overflow-hidden rounded bg-line">
                                    <div className="h-full bg-accent" style={{ width: `${Math.min(100, r.progress * 100)}%` }} />
                                </div>
                                <div className="mt-1 text-xs text-muted">{r.migrated ? 'Graduated' : `${(r.progress * 100).toFixed(1)}% to DAMM v2`}</div>
                            </Link>
                        )
                    })}
                </div>
            </section>
        </div>
    )
}
