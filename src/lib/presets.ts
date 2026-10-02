/**
 * Curve presets — opinionated DBC configurations tuned for launches quoted in tokenized stocks.
 * Every number here is expressed in USD; the engine (curve.ts) converts to raw xStock units
 * at launch time using the live price + ScaledUiAmount multiplier.
 */
export type PresetKind = 'marketCap' | 'weights' | 'twoSegments'

export type CurvePreset = {
    id: string
    name: string
    tagline: string
    description: string
    kind: PresetKind
    startMcapUsd: number
    gradMcapUsd: number
    /** only for twoSegments */
    percentSupplyOnMigration?: number
    /** only for weights: 16 values */
    weights?: number[]
    /** bonding-curve trading fee */
    feeBps: number
    /** optional anti-snipe: fee decays from startFeeBps -> feeBps over feeDecaySeconds */
    antiSnipe?: { startFeeBps: number; seconds: number; periods: number; exponential: boolean }
    /** post-graduation DAMM v2 pool fee */
    migratedFeeBps: number
    /** DAMM v2 collect mode after graduation: 0 quote (earn stock), 2 compounding */
    migratedCollectMode: 0 | 2
    bestFor: string[]
}

const ramp = (from: number, to: number) =>
    Array.from({ length: 16 }, (_, i) => +(from * Math.pow(to / from, i / 15)).toFixed(4))

export const PRESETS: CurvePreset[] = [
    {
        id: 'fair-discovery',
        name: 'Fair Discovery',
        tagline: 'Classic constant-product curve, priced in stock',
        description:
            'A standard x*y=k curve from a $6k to a $69k market cap, denominated in the chosen xStock. This is the baseline: simple and easy for traders to read.',
        kind: 'marketCap',
        startMcapUsd: 6_000,
        gradMcapUsd: 69_000,
        feeBps: 100,
        migratedFeeBps: 50,
        migratedCollectMode: 0,
        bestFor: ['memes', 'community tokens'],
    },
    {
        id: 'opening-bell',
        name: 'Opening Bell',
        tagline: 'Anti-snipe fee that rings down like a market open',
        description:
            'The fee starts at 50% and decays exponentially to 1% over the first 3 minutes. Bots that snipe the first block pay the creator instead of dumping on the community. Mirrors the opening auction volatility of real equity markets.',
        kind: 'marketCap',
        startMcapUsd: 8_000,
        gradMcapUsd: 80_000,
        feeBps: 100,
        antiSnipe: { startFeeBps: 5_000, seconds: 180, periods: 18, exponential: true },
        migratedFeeBps: 50,
        migratedCollectMode: 0,
        bestFor: ['high-hype launches', 'ticker-themed memes'],
    },
    {
        id: 'earnings-run',
        name: 'Earnings Run',
        tagline: 'Thin early liquidity, thick late — conviction gets rewarded',
        description:
            'Liquidity weights ramp 1x→12x across 16 segments. Early buyers move price fast (convex discovery), while late buyers face a deep book, which damps the pre-graduation pump-and-dump.',
        kind: 'weights',
        startMcapUsd: 5_000,
        gradMcapUsd: 100_000,
        weights: ramp(1, 12),
        feeBps: 125,
        migratedFeeBps: 80,
        migratedCollectMode: 0,
        bestFor: ['narrative tokens', 'AI agents'],
    },
    {
        id: 'flat-rwa',
        name: 'Flat RWA',
        tagline: 'Near-flat curve for assets with a fundamental anchor',
        description:
            'Price moves only ~1.6x from first buy to graduation ($48k to $75k mcap). Built for RWA wrappers, revenue-share tokens and baskets where reflexive 100x curves make no sense. Graduates into a compounding DAMM v2 pool.',
        kind: 'weights',
        startMcapUsd: 48_000,
        gradMcapUsd: 75_000,
        weights: ramp(4, 1),
        feeBps: 50,
        migratedFeeBps: 25,
        migratedCollectMode: 2,
        bestFor: ['RWA', 'yield / revenue-share', 'stock baskets'],
    },
    {
        id: 'long-curve',
        name: 'Long Curve',
        tagline: 'Two-segment curve for a long, deep discovery runway',
        description:
            'Two segments up to a $750k graduation, with only 20% of supply on the migrated pool, so the curve itself does the price discovery. For bigger projects that want weeks on the curve instead of minutes.',
        kind: 'twoSegments',
        startMcapUsd: 10_000,
        gradMcapUsd: 750_000,
        percentSupplyOnMigration: 20,
        feeBps: 100,
        migratedFeeBps: 50,
        migratedCollectMode: 0,
        bestFor: ['serious projects', 'DAOs'],
    },
]

export const getPreset = (id: string) => PRESETS.find((p) => p.id === id) ?? PRESETS[0]
