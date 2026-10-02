import { PublicKey } from '@solana/web3.js'
import { deriveTokenBadgeAddress } from '@meteora-ag/dynamic-bonding-curve-sdk'

/**
 * xStocks (Backed Finance) on Solana. All are Token-2022 mints with 8 decimals and
 * the ScaledUiAmount extension (dividends / splits are applied through a multiplier,
 * not by minting). Every mint below has a DBC TokenBadge on mainnet (verified on-chain),
 * so it can be used as a DBC quote token by passing the badge as a remaining account.
 */
export type StockQuote = {
    symbol: string
    name: string
    ticker: string // underlying equity ticker
    mint: string
    decimals: number
    color: string
}

export const XSTOCKS: StockQuote[] = [
    { symbol: 'SPYx', ticker: 'SPY', name: 'S&P 500', mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W', decimals: 8, color: '#3b82f6' },
    { symbol: 'QQQx', ticker: 'QQQ', name: 'Nasdaq 100', mint: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ', decimals: 8, color: '#6366f1' },
    { symbol: 'NVDAx', ticker: 'NVDA', name: 'NVIDIA', mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', decimals: 8, color: '#22c55e' },
    { symbol: 'TSLAx', ticker: 'TSLA', name: 'Tesla', mint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB', decimals: 8, color: '#ef4444' },
    { symbol: 'AAPLx', ticker: 'AAPL', name: 'Apple', mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp', decimals: 8, color: '#a3a3a3' },
    { symbol: 'GOOGLx', ticker: 'GOOGL', name: 'Alphabet', mint: 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN', decimals: 8, color: '#f59e0b' },
    { symbol: 'METAx', ticker: 'META', name: 'Meta', mint: 'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu', decimals: 8, color: '#0ea5e9' },
    { symbol: 'AMZNx', ticker: 'AMZN', name: 'Amazon', mint: 'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg', decimals: 8, color: '#f97316' },
    { symbol: 'MSTRx', ticker: 'MSTR', name: 'Strategy', mint: 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ', decimals: 8, color: '#fb923c' },
    { symbol: 'COINx', ticker: 'COIN', name: 'Coinbase', mint: 'Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu', decimals: 8, color: '#2563eb' },
    { symbol: 'CRCLx', ticker: 'CRCL', name: 'Circle', mint: 'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1', decimals: 8, color: '#14b8a6' },
    { symbol: 'HOODx', ticker: 'HOOD', name: 'Robinhood', mint: 'XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg', decimals: 8, color: '#84cc16' },
]

/** Devnet: xStocks don't exist, so `pnpm devnet:mock` mints a plain Token-2022 stand-in. */
export const DEVNET_MOCK_STOCK: StockQuote = {
    symbol: 'mNVDAx',
    ticker: 'NVDA',
    name: 'Mock NVIDIA (devnet)',
    mint: process.env.NEXT_PUBLIC_DEVNET_MOCK_STOCK_MINT ?? '',
    decimals: 8,
    color: '#22c55e',
}

export function getStock(symbolOrMint: string): StockQuote | undefined {
    const all = [...XSTOCKS, DEVNET_MOCK_STOCK]
    return all.find((s) => s.symbol === symbolOrMint || s.mint === symbolOrMint)
}

export function tokenBadgeFor(mint: string): PublicKey {
    return deriveTokenBadgeAddress(new PublicKey(mint))
}

/** Meteora migration keepers auto-graduate stock-quoted pools only if threshold >= $750. */
export const KEEPER_MIN_THRESHOLD_USD = 750
/** We add a buffer so a stock drawdown during the curve doesn't strand the pool below the keeper floor. */
export const SAFE_MIN_THRESHOLD_USD = 1_000
