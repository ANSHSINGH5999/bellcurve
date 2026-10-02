import { describe, expect, it } from 'vitest'
import { validateConfigParameters } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { Keypair } from '@solana/web3.js'

const KP = Keypair.generate().publicKey
import { buildLaunchPlan, LaunchPlanError } from '../src/lib/curve'
import { PRESETS } from '../src/lib/presets'

// Representative prices (USD per raw whole xStock) spanning cheap → expensive stocks
const PRICES = { HOODx: 120, NVDAx: 231, TSLAx: 356, SPYx: 766, MSTRx: 1500 }

describe('StockCurve launch engine', () => {
    for (const preset of PRESETS) {
        for (const [sym, px] of Object.entries(PRICES)) {
            it(`${preset.id} × ${sym} builds a valid DBC config above the keeper floor`, () => {
                const plan = buildLaunchPlan({ preset, usdPerRawStock: px, stockDecimals: 8 })
                // Same validation the SDK runs before sending createConfig
                expect(() => validateConfigParameters({ ...plan.config, leftoverReceiver: KP } as never)).not.toThrow()
                expect(plan.thresholdUsd).toBeGreaterThanOrEqual(750)
                // USD-denominated targets survive the stock conversion
                expect(plan.startPriceUsd * 1e9).toBeCloseTo(preset.startMcapUsd, -2)
                expect(plan.points.length).toBeGreaterThan(5)
                // price is monotonic along the curve
                for (let i = 1; i < plan.points.length; i++) expect(plan.points[i].priceUsd).toBeGreaterThanOrEqual(plan.points[i - 1].priceUsd)
                // raised amount at the end ≈ threshold
                expect(plan.points.at(-1)!.raisedUsd).toBeCloseTo(plan.thresholdUsd, -1)
            })
        }
    }

    it('rejects launches whose graduation raise falls under the $750 keeper floor', () => {
        expect(() =>
            buildLaunchPlan({ preset: PRESETS[0], usdPerRawStock: 231, stockDecimals: 8, startMcapUsd: 500, gradMcapUsd: 1500 })
        ).toThrow(LaunchPlanError)
    })

    it('same USD plan needs fewer raw units of an expensive stock', () => {
        const cheap = buildLaunchPlan({ preset: PRESETS[0], usdPerRawStock: 120, stockDecimals: 8 })
        const pricey = buildLaunchPlan({ preset: PRESETS[0], usdPerRawStock: 1200, stockDecimals: 8 })
        expect(cheap.thresholdStock / pricey.thresholdStock).toBeCloseTo(10, 0)
        expect(cheap.thresholdUsd).toBeCloseTo(pricey.thresholdUsd, -2)
    })
})
