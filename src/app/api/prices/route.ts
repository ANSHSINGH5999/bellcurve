import { NextResponse } from 'next/server'
import { fetchUsdPrices } from '@/lib/price'
import { XSTOCKS } from '@/lib/stocks'

export const revalidate = 0

// Server-side proxy for Jupiter Price API v3 (avoids CORS + lets us cache for 15s)
export async function GET(req: Request) {
    const ids = new URL(req.url).searchParams.get('ids')?.split(',').filter(Boolean) ?? XSTOCKS.map((s) => s.mint)
    try {
        const prices = await fetchUsdPrices(ids.slice(0, 50))
        return NextResponse.json(prices, { headers: { 'cache-control': 's-maxage=15, stale-while-revalidate=60' } })
    } catch (e) {
        return NextResponse.json({ error: String(e) }, { status: 502 })
    }
}
