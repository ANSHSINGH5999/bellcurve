'use client'
import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { CurvePoint } from '@/lib/curve'
import { fmtUsd } from '@/lib/hooks'

export default function CurveChart({ points, color = '#34d399', marker }: { points: CurvePoint[]; color?: string; marker?: number }) {
    const data = points.map((p) => ({ x: +p.pctSold.toFixed(2), mcap: p.mcapUsd, raised: p.raisedUsd, stock: p.priceStock }))
    const markerPt = marker !== undefined ? data.reduce((a, b) => (Math.abs(b.x - marker) < Math.abs(a.x - marker) ? b : a), data[0]) : undefined
    return (
        <div className="h-64 w-full">
            <ResponsiveContainer>
                <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                            <stop offset="100%" stopColor={color} stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1c2533" strokeDasharray="3 3" />
                    <XAxis dataKey="x" type="number" domain={[0, 'dataMax']} tickFormatter={(v) => `${v}%`} stroke="#8392a7" fontSize={11} />
                    <YAxis dataKey="mcap" tickFormatter={(v) => fmtUsd(v, 0)} stroke="#8392a7" fontSize={11} width={60} />
                    <Tooltip
                        contentStyle={{ background: '#0e131b', border: '1px solid #1c2533', borderRadius: 10 }}
                        labelFormatter={(v) => `${v}% of supply sold`}
                        formatter={(v, k) => [k === 'mcap' ? fmtUsd(Number(v), 0) : String(v), k === 'mcap' ? 'Market cap' : String(k)]}
                    />
                    <Area type="monotone" dataKey="mcap" stroke={color} strokeWidth={2} fill="url(#cg)" isAnimationActive={false} />
                    {markerPt && <ReferenceDot x={markerPt.x} y={markerPt.mcap} r={5} fill="#fff" stroke={color} />}
                </AreaChart>
            </ResponsiveContainer>
        </div>
    )
}
