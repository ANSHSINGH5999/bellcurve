import { NextResponse } from 'next/server'

/**
 * Stateless Metaplex-compatible metadata. The on-chain `uri` is
 * `${SITE}/api/meta?n=<name>&s=<symbol>&i=<imageUrl>&q=<quoteSymbol>&p=<presetId>` (kept < 200 chars).
 */
export async function GET(req: Request) {
    const p = new URL(req.url).searchParams
    const name = (p.get('n') ?? '').slice(0, 32)
    const symbol = (p.get('s') ?? '').slice(0, 10)
    const image = p.get('i') ?? ''
    const quote = p.get('q') ?? ''
    const preset = p.get('p') ?? ''
    return NextResponse.json(
        {
            name,
            symbol,
            image,
            description: `${name} launched on StockCurve — bonding curve quoted in ${quote}.`,
            attributes: [
                { trait_type: 'quote', value: quote },
                { trait_type: 'curve', value: preset },
            ],
            properties: { category: 'image', files: image ? [{ uri: image, type: 'image/png' }] : [] },
        },
        { headers: { 'cache-control': 'public, max-age=31536000, immutable' } }
    )
}
