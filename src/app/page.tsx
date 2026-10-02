'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useConnection } from '@solana/wallet-adapter-react'
import { getPriceFromSqrtPrice } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { listPlatformLaunches } from '@/lib/dbc'
import { fetchTokenMeta, type TokenMeta } from '@/lib/metadata'
import { fmtUsd, useUsdPrices } from '@/lib/hooks'
import { XSTOCKS, getStock } from '@/lib/stocks'

type Row = { mint: string; pool: string; quote: string; priceStock: number; progress: number; migrated: boolean }

export default function Home() {
    const { connection } = useConnection()
    const prices = useUsdPrices(XSTOCKS.map((s) => s.mint))
    const [rows, setRows] = useState<Row[] | null>(null)
    const [err, setErr] = useState('')
    const [metas, setMetas] = useState<Record<string, TokenMeta | null>>({})

    useEffect(() => {
        listPlatformLaunches(connection)
            .then((ps) =>
                setRows(
                    ps.map((p) => {
                        const quote = p.config.quoteMint.toBase58()
                        const dec = getStock(quote)?.decimals ?? 8
                        return {
                            mint: p.account.poolState.baseMint.toBase58(),
                            pool: p.publicKey.toBase58(),
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

    useEffect(() => {
        rows?.forEach((r) => fetchTokenMeta(connection, r.mint).then((m) => setMetas((prev) => ({ ...prev, [r.mint]: m })), () => {}))
    }, [connection, rows])

    return (
        <div className="space-y-10">
            <section className="grid items-center gap-8 lg:grid-cols-2">
                <div className="space-y-4">
                    <span className="tag">Meteora DBC × DAMM v2 × DLMM · priced in xStocks</span>
                    <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
                        Conviction you can <span className="text-accent">verify</span>.
                    </h1>
                    <p className="text-muted">
                        98.9% of Meteora DBC graduations were uncontested, with no real competing buyers (Litmus data), so a graduation proves nothing. BellCurve launches tokens
                        priced in tokenized stocks (NVDAx, SPYx…), graduates them into Meteora DAMM v2, and gives every launch a Conviction Pool on DLMM where
                        holders publicly commit, as limit orders, to sell only above a price or to buy the dip.
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
                    ['Conviction Pools', 'Sell walls (“only above 3×”) and support (“buy to −30%”) as Meteora DLMM limit orders. Every launch is scored on the share of supply committed above market.'],
                    ['Priced in shares', 'Your token’s price is literally “X shares of NVDA”, so every launch shows its alpha vs. the stock. Creators earn fees in equity, not their own token.'],
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
                        {err && <span className="block text-xs">(Couldn’t load launches: {err.slice(0, 120)})</span>}
                    </p>
                )}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {rows?.map((r) => {
                        const s = getStock(r.quote)
                        const usd = s ? (prices[s.mint] ?? 0) : 0
                        return (
                            <Link key={r.mint} href={`/t/${r.mint}?pool=${r.pool}`} className="card block p-4 hover:border-accent">
                                <div className="flex justify-between text-sm">
                                    <span className="truncate font-semibold">
                                        {metas[r.mint]?.name ?? <span className="mono font-normal">{r.mint.slice(0, 4)}…{r.mint.slice(-4)}</span>}
                                        {metas[r.mint]?.symbol && <span className="mono font-normal text-muted"> ${metas[r.mint]!.symbol}</span>}
                                    </span>
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
