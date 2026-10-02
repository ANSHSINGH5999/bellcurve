'use client'
import { useEffect, useState } from 'react'
import { useConnection } from '@solana/wallet-adapter-react'
import { readScaledMultiplier } from './price'

export function useUsdPrices(mints: string[], refreshMs = 20_000) {
    const [prices, setPrices] = useState<Record<string, number>>({})
    const key = mints.join(',')
    useEffect(() => {
        if (!key) return
        let alive = true
        const load = () =>
            fetch(`/api/prices?ids=${key}`)
                .then((r) => r.json())
                .then((j) => alive && !j.error && setPrices(j))
                .catch(() => {})
        load()
        const t = setInterval(load, refreshMs)
        return () => {
            alive = false
            clearInterval(t)
        }
    }, [key, refreshMs])
    return prices
}

/** Live USD price per *raw* stock unit (Jupiter UI price × ScaledUiAmount multiplier) */
export function useStockQuote(mint: string | undefined) {
    const { connection } = useConnection()
    const prices = useUsdPrices(mint ? [mint] : [])
    const [scaled, setScaled] = useState({ multiplier: 1, paused: false })
    useEffect(() => {
        if (!mint) return
        readScaledMultiplier(connection, mint).then(setScaled)
    }, [connection, mint])
    const usdPerUi = mint ? prices[mint] : undefined
    return {
        usdPerUi,
        multiplier: scaled.multiplier,
        paused: scaled.paused,
        usdPerRaw: usdPerUi ? usdPerUi * scaled.multiplier : undefined,
    }
}

export const fmtUsd = (n: number | undefined, d = 2) =>
    n === undefined || !isFinite(n)
        ? '—'
        : n >= 1e6
          ? `$${(n / 1e6).toFixed(2)}M`
          : n >= 1e3
            ? `$${(n / 1e3).toFixed(1)}k`
            : n < 0.01
              ? `$${n.toPrecision(3)}`
              : `$${n.toFixed(d)}`
