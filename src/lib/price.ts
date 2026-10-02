import { Connection, PublicKey } from '@solana/web3.js'
import { getMint, getPausableConfig, getScaledUiAmountConfig, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'

const JUP_PRICE = 'https://lite-api.jup.ag/price/v3'

export type StockPrice = {
    /** USD per 1 UI token (what wallets display) */
    usdPerUi: number
    /** ScaledUiAmount multiplier currently in force (UI = raw * multiplier) */
    multiplier: number
    /** USD per 1 *raw* whole token — this is what the DBC curve actually prices against */
    usdPerRaw: number
    paused: boolean
}

export async function fetchUsdPrices(mints: string[]): Promise<Record<string, number>> {
    if (!mints.length) return {}
    const res = await fetch(`${JUP_PRICE}?ids=${mints.join(',')}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`price api ${res.status}`)
    const json = (await res.json()) as Record<string, { usdPrice?: number } | null>
    const out: Record<string, number> = {}
    for (const m of mints) {
        const p = json[m]?.usdPrice
        if (typeof p === 'number' && p > 0) out[m] = p
    }
    return out
}

/**
 * xStocks pay dividends by bumping a ScaledUiAmount multiplier instead of minting.
 * The bonding curve works on raw amounts, so a launch that targets "$50k graduation"
 * must convert USD -> raw stock units with the multiplier, or it drifts after every dividend.
 */
export async function readScaledMultiplier(connection: Connection, mint: string): Promise<{ multiplier: number; paused: boolean }> {
    try {
        const info = await getMint(connection, new PublicKey(mint), 'confirmed', TOKEN_2022_PROGRAM_ID)
        const cfg = getScaledUiAmountConfig(info)
        let multiplier = 1
        if (cfg) {
            const now = Math.floor(Date.now() / 1000)
            multiplier = now >= Number(cfg.newMultiplierEffectiveTimestamp) ? cfg.newMultiplier : cfg.multiplier
        }
        // PausableConfig: if the issuer pauses the mint, curve swaps will fail; surface it in UI.
        const paused = getPausableConfig(info)?.paused ?? false
        return { multiplier, paused }
    } catch {
        return { multiplier: 1, paused: false }
    }
}

export async function getStockPrice(connection: Connection, mint: string, fallbackUsd?: number): Promise<StockPrice> {
    const [prices, scaled] = await Promise.all([
        fetchUsdPrices([mint]).catch(() => ({}) as Record<string, number>),
        readScaledMultiplier(connection, mint),
    ])
    const usdPerUi = prices[mint] ?? fallbackUsd ?? 0
    return { usdPerUi, multiplier: scaled.multiplier, usdPerRaw: usdPerUi * scaled.multiplier, paused: scaled.paused }
}
