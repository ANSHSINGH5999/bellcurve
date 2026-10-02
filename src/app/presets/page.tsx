'use client'
import { useMemo, useState } from 'react'
import CurveChart from '@/components/CurveChart'
import { buildLaunchPlan } from '@/lib/curve'
import { fmtUsd, useUsdPrices } from '@/lib/hooks'
import { PRESETS } from '@/lib/presets'
import { XSTOCKS } from '@/lib/stocks'

/** Preset gallery — every preset is exportable as a ready-to-use DBC ConfigParameters JSON for other launchpads. */
export default function PresetsPage() {
    const [stockSym, setStockSym] = useState('NVDAx')
    const stock = XSTOCKS.find((s) => s.symbol === stockSym)!
    const prices = useUsdPrices([stock.mint])
    const px = prices[stock.mint] ?? 0

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold">Curve presets</h1>
                    <p className="text-sm text-muted">Opinionated DBC configs for stock-quoted launches. Export any of them as JSON and plug it into your own launchpad.</p>
                </div>
                <select className="input w-40" value={stockSym} onChange={(e) => setStockSym(e.target.value)}>
                    {XSTOCKS.map((s) => (
                        <option key={s.symbol}>{s.symbol}</option>
                    ))}
                </select>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
                {PRESETS.map((p) => (
                    <PresetCard key={p.id} id={p.id} px={px} color={stock.color} sym={stock.symbol} />
                ))}
            </div>
        </div>
    )
}

function PresetCard({ id, px, color, sym }: { id: string; px: number; color: string; sym: string }) {
    const p = PRESETS.find((x) => x.id === id)!
    const plan = useMemo(() => (px ? buildLaunchPlan({ preset: p, usdPerRawStock: px, stockDecimals: 8 }) : null), [p, px])
    const [copied, setCopied] = useState(false)
    const exportJson = () => {
        if (!plan) return
        const json = JSON.stringify(plan.config, (_, v) => (v && typeof v === 'object' && 'words' in v ? v.toString() : v), 2)
        navigator.clipboard.writeText(json)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }
    return (
        <div className="card space-y-3 p-5">
            <div className="flex items-center justify-between">
                <h2 className="font-semibold">{p.name}</h2>
                <div className="flex gap-1">{p.bestFor.map((b) => <span key={b} className="tag">{b}</span>)}</div>
            </div>
            <p className="text-sm text-muted">{p.description}</p>
            {plan ? <CurveChart points={plan.points} color={color} /> : <div className="h-64 animate-pulse rounded bg-line/40" />}
            <div className="mono grid grid-cols-3 gap-2 text-xs text-muted">
                <span>raise {plan ? `${plan.thresholdStock.toFixed(1)} ${sym}` : '—'}</span>
                <span>≈ {fmtUsd(plan?.thresholdUsd, 0)}</span>
                <span>fee {p.feeBps / 100}%{p.antiSnipe ? ` (from ${p.antiSnipe.startFeeBps / 100}%)` : ''}</span>
            </div>
            <button className="btn btn-ghost w-full text-sm" onClick={exportJson} disabled={!plan}>
                {copied ? 'Copied ConfigParameters JSON ✓' : 'Copy DBC config JSON'}
            </button>
        </div>
    )
}
