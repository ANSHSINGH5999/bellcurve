import BN from 'bn.js'
import {
    ActivationType,
    BaseFeeMode,
    buildCurveWithLiquidityWeights,
    buildCurveWithMarketCap,
    buildCurveWithTwoSegments,
    CollectFeeMode,
    type ConfigParameters,
    DammV2DynamicFeeMode,
    getDeltaAmountBaseUnsigned,
    getDeltaAmountQuoteUnsigned,
    getPriceFromSqrtPrice,
    MigratedCollectFeeMode,
    MigrationFeeOption,
    MigrationOption,
    Rounding,
    TokenAuthorityOption,
    TokenDecimal,
    TokenType,
    type BuildCurveBaseParams,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import type { CurvePreset } from './presets'
import { KEEPER_MIN_THRESHOLD_USD, SAFE_MIN_THRESHOLD_USD } from './stocks'

export const TOTAL_SUPPLY = 1_000_000_000
export const BASE_DECIMALS = TokenDecimal.SIX

export type LaunchInputs = {
    preset: CurvePreset
    /** USD per 1 raw whole xStock (price × ScaledUiAmount multiplier) */
    usdPerRawStock: number
    stockDecimals: number
    /** overrides */
    startMcapUsd?: number
    gradMcapUsd?: number
    /** share of trading fees routed to the creator (rest to platform/partner) */
    creatorFeeSharePct?: number
}

export type CurvePoint = { pctSold: number; priceUsd: number; priceStock: number; mcapUsd: number; raisedUsd: number }

export type LaunchPlan = {
    config: ConfigParameters
    thresholdStock: number
    thresholdUsd: number
    startPriceStock: number
    startPriceUsd: number
    gradPriceStock: number
    gradPriceUsd: number
    points: CurvePoint[]
    warnings: string[]
}

export class LaunchPlanError extends Error {}

/** USD target -> raw stock units. This is the whole trick: the curve is denominated in equity. */
export const usdToStock = (usd: number, usdPerRawStock: number) => usd / usdPerRawStock

function baseParams(p: CurvePreset, stockDecimals: number, creatorFeeSharePct: number): BuildCurveBaseParams {
    const anti = p.antiSnipe
    return {
        token: {
            tokenType: TokenType.SPLToken,
            tokenBaseDecimal: BASE_DECIMALS,
            tokenQuoteDecimal: stockDecimals,
            tokenAuthorityOption: TokenAuthorityOption.Immutable,
            totalTokenSupply: TOTAL_SUPPLY,
            leftover: 1_000, // absorbs u128 rounding in the curve builders (precision-loss buffer)
        },
        fee: {
            baseFeeParams: {
                baseFeeMode: anti?.exponential ? BaseFeeMode.FeeSchedulerExponential : BaseFeeMode.FeeSchedulerLinear,
                feeSchedulerParam: anti
                    ? { startingFeeBps: anti.startFeeBps, endingFeeBps: p.feeBps, numberOfPeriod: anti.periods, totalDuration: anti.seconds }
                    : { startingFeeBps: p.feeBps, endingFeeBps: p.feeBps, numberOfPeriod: 0, totalDuration: 0 },
            },
            dynamicFeeEnabled: true,
            // fees are always taken in the quote token => creators accrue *stock*, not their own memecoin
            collectFeeMode: CollectFeeMode.QuoteToken,
            creatorTradingFeePercentage: creatorFeeSharePct,
            poolCreationFee: 0,
            enableFirstSwapWithMinFee: true,
        },
        migration: {
            migrationOption: MigrationOption.MET_DAMM_V2,
            migrationFeeOption: MigrationFeeOption.Customizable,
            migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
            migratedPoolFee: {
                collectFeeMode: p.migratedCollectMode === 2 ? MigratedCollectFeeMode.Compounding : MigratedCollectFeeMode.QuoteToken,
                dynamicFee: DammV2DynamicFeeMode.Enabled,
                poolFeeBps: p.migratedFeeBps,
                compoundingFeeBps: p.migratedCollectMode === 2 ? 5_000 : 0,
            },
        },
        // 60% of graduated LP permanently locked (platform 50 + creator 10) — no LP rug possible
        liquidityDistribution: {
            partnerLiquidityPercentage: 0,
            partnerPermanentLockedLiquidityPercentage: 50,
            creatorLiquidityPercentage: 40,
            creatorPermanentLockedLiquidityPercentage: 10,
        },
        lockedVesting: {
            totalLockedVestingAmount: 0,
            numberOfVestingPeriod: 0,
            cliffUnlockAmount: 0,
            totalVestingDuration: 0,
            cliffDurationFromMigrationTime: 0,
        },
        activationType: ActivationType.Timestamp,
    }
}

export function buildLaunchPlan(input: LaunchInputs): LaunchPlan {
    const { preset, usdPerRawStock, stockDecimals } = input
    if (!(usdPerRawStock > 0)) throw new LaunchPlanError('Stock price unavailable')
    const startUsd = input.startMcapUsd ?? preset.startMcapUsd
    const gradUsd = input.gradMcapUsd ?? preset.gradMcapUsd
    if (gradUsd <= startUsd * 1.05) throw new LaunchPlanError('Graduation market cap must be meaningfully above the start')

    const base = baseParams(preset, stockDecimals, input.creatorFeeSharePct ?? 50)
    const initialMarketCap = usdToStock(startUsd, usdPerRawStock)
    const migrationMarketCap = usdToStock(gradUsd, usdPerRawStock)

    let config: ConfigParameters
    switch (preset.kind) {
        case 'weights':
            config = buildCurveWithLiquidityWeights({ ...base, initialMarketCap, migrationMarketCap, liquidityWeights: preset.weights! })
            break
        case 'twoSegments':
            config = buildCurveWithTwoSegments({
                ...base,
                initialMarketCap,
                migrationMarketCap,
                percentageSupplyOnMigration: preset.percentSupplyOnMigration ?? 20,
            })
            break
        default:
            config = buildCurveWithMarketCap({ ...base, initialMarketCap, migrationMarketCap })
    }

    const qScale = 10 ** stockDecimals
    const thresholdStock = Number(config.migrationQuoteThreshold.toString()) / qScale
    const thresholdUsd = thresholdStock * usdPerRawStock

    if (thresholdUsd < KEEPER_MIN_THRESHOLD_USD)
        throw new LaunchPlanError(
            `Graduation raise is $${thresholdUsd.toFixed(0)} — below Meteora's $${KEEPER_MIN_THRESHOLD_USD} keeper floor for stock-quoted pools. Raise the graduation market cap.`
        )
    const warnings: string[] = []
    if (thresholdUsd < SAFE_MIN_THRESHOLD_USD)
        warnings.push('Graduation raise is close to the $750 keeper floor; a stock drawdown could delay auto-migration.')

    const startPriceStock = getPriceFromSqrtPrice(config.sqrtStartPrice, BASE_DECIMALS, stockDecimals).toNumber()
    const points = simulateCurve(config, stockDecimals, usdPerRawStock)
    const last = points[points.length - 1]
    return {
        config,
        thresholdStock,
        thresholdUsd,
        startPriceStock,
        startPriceUsd: startPriceStock * usdPerRawStock,
        gradPriceStock: last.priceStock,
        gradPriceUsd: last.priceUsd,
        points,
        warnings,
    }
}

/**
 * Walk the piecewise constant-product curve exactly as the program does
 * (same SDK math), sampling price vs. % of supply sold until the migration threshold.
 */
export function simulateCurve(config: ConfigParameters, stockDecimals: number, usdPerRawStock: number, samples?: number): CurvePoint[] {
    const samplesPerSeg = samples ?? (config.curve.filter((c) => !new BN(c.liquidity.toString()).isZero()).length <= 2 ? 48 : 8)
    const bScale = 10 ** BASE_DECIMALS
    const qScale = 10 ** stockDecimals
    const threshold = new BN(config.migrationQuoteThreshold.toString())
    const supply = TOTAL_SUPPLY
    const pts: CurvePoint[] = []
    let lower = new BN(config.sqrtStartPrice.toString())
    let baseSold = new BN(0)
    let quoteIn = new BN(0)
    const push = (sqrt: BN) => {
        const priceStock = getPriceFromSqrtPrice(sqrt, BASE_DECIMALS, stockDecimals).toNumber()
        const sold = Number(baseSold.toString()) / bScale
        pts.push({
            pctSold: (sold / supply) * 100,
            priceStock,
            priceUsd: priceStock * usdPerRawStock,
            mcapUsd: priceStock * usdPerRawStock * supply,
            raisedUsd: (Number(quoteIn.toString()) / qScale) * usdPerRawStock,
        })
    }
    push(lower)
    for (const seg of config.curve) {
        const upper = new BN(seg.sqrtPrice.toString())
        const liq = new BN(seg.liquidity.toString())
        if (liq.isZero() || upper.lte(lower)) continue
        const step = upper.sub(lower).divn(samplesPerSeg)
        if (step.isZero()) continue
        for (let i = 1; i <= samplesPerSeg; i++) {
            const hi = i === samplesPerSeg ? upper : lower.add(step.muln(i))
            const lo = i === 1 ? lower : lower.add(step.muln(i - 1))
            const dq = getDeltaAmountQuoteUnsigned(lo, hi, liq, Rounding.Up)
            const db = getDeltaAmountBaseUnsigned(lo, hi, liq, Rounding.Down)
            if (quoteIn.add(dq).gt(threshold)) {
                // final partial step: stop at threshold (approximate within one sample)
                quoteIn = threshold
                baseSold = baseSold.add(db)
                push(hi)
                return pts
            }
            quoteIn = quoteIn.add(dq)
            baseSold = baseSold.add(db)
            push(hi)
        }
        lower = upper
    }
    return pts
}
