import { NextResponse } from 'next/server'
import { Connection } from '@solana/web3.js'
import { buildLaunchPlan, configToJson, LaunchPlanError } from '@/lib/curve'
import { RPC_URL } from '@/lib/env'
import { getStockPrice } from '@/lib/price'
import { PRESETS } from '@/lib/presets'
import { getStock, tokenBadgeFor, XSTOCKS } from '@/lib/stocks'

export const revalidate = 0

/**
 * Plug-and-play DBC configs for other launchpads.
 *   GET /api/presets                         -> presets + supported xStocks
 *   GET /api/presets?id=flat-rwa&stock=NVDAx -> ready ConfigParameters (BN fields as decimal strings),
 *                                               priced live and dividend-adjusted, plus the TokenBadge to pass
 */
export async function GET(req: Request) {
    const q = new URL(req.url).searchParams
    const id = q.get('id')
    if (!id)
        return NextResponse.json({
            presets: PRESETS.map(({ id, name, tagline, kind, startMcapUsd, gradMcapUsd, feeBps, migratedFeeBps, migratedCollectMode, bestFor }) => ({
                id, name, tagline, kind, startMcapUsd, gradMcapUsd, feeBps, migratedFeeBps,
                migratedPool: migratedCollectMode === 2 ? 'DAMM v2 compounding' : 'DAMM v2 (fees in quote)',
                bestFor,
            })),
            stocks: XSTOCKS.map(({ symbol, mint, decimals }) => ({ symbol, mint, decimals })),
            usage: '/api/presets?id=<preset>&stock=<symbol|mint>[&startMcapUsd=&gradMcapUsd=]',
        })

    const preset = PRESETS.find((p) => p.id === id)
    const stock = getStock(q.get('stock') ?? 'SPYx')
    if (!preset || !stock || !XSTOCKS.includes(stock)) return NextResponse.json({ error: 'unknown preset or stock' }, { status: 400 })
    const num = (k: string) => (q.get(k) ? Number(q.get(k)) : undefined)
    try {
        const price = await getStockPrice(new Connection(process.env.RPC_URL ?? RPC_URL, 'confirmed'), stock.mint)
        if (price.paused) return NextResponse.json({ error: `${stock.symbol} is paused by its issuer` }, { status: 409 })
        const plan = buildLaunchPlan({ preset, usdPerRawStock: price.usdPerRaw, stockDecimals: stock.decimals, startMcapUsd: num('startMcapUsd'), gradMcapUsd: num('gradMcapUsd') })
        return NextResponse.json(
            {
                preset: preset.id,
                quoteMint: stock.mint,
                tokenBadge: tokenBadgeFor(stock.mint).toBase58(),
                pricing: { usdPerUi: price.usdPerUi, scaledUiMultiplier: price.multiplier, usdPerRaw: price.usdPerRaw },
                graduation: { quoteThreshold: plan.thresholdStock, usd: plan.thresholdUsd, keeperFloorUsd: 750 },
                warnings: plan.warnings,
                config: JSON.parse(configToJson(plan.config)),
            },
            { headers: { 'cache-control': 's-maxage=30, stale-while-revalidate=120', 'access-control-allow-origin': '*' } }
        )
    } catch (e) {
        const status = e instanceof LaunchPlanError ? 400 : 502
        return NextResponse.json({ error: (e as Error).message }, { status })
    }
}
