import { PublicKey, VersionedTransaction } from '@solana/web3.js'

/** "Buy with SOL": most people don't hold xStocks, so route SOL -> xStock through Jupiter, then buy the curve with it. */
const JUP = 'https://lite-api.jup.ag/swap/v1'
export const WSOL = 'So11111111111111111111111111111111111111112'

export type JupQuote = { inAmount: string; outAmount: string; otherAmountThreshold: string; priceImpactPct: string; [k: string]: unknown }

export async function quoteSolToStock(stockMint: string, lamports: bigint, slippageBps = 100): Promise<JupQuote> {
    const res = await fetch(`${JUP}/quote?inputMint=${WSOL}&outputMint=${stockMint}&amount=${lamports}&slippageBps=${slippageBps}`)
    const json = await res.json()
    if (!res.ok || json.error) throw new Error(`No SOL route to this stock right now (${json.error ?? res.status})`)
    return json
}

export async function buildSolToStockTx(quote: JupQuote, user: PublicKey): Promise<VersionedTransaction> {
    const res = await fetch(`${JUP}/swap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            quoteResponse: quote,
            userPublicKey: user.toBase58(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: 'auto',
        }),
    })
    const json = await res.json()
    if (!res.ok || !json.swapTransaction) throw new Error(`Jupiter swap build failed (${json.error ?? res.status})`)
    return VersionedTransaction.deserialize(Uint8Array.from(atob(json.swapTransaction), (c) => c.charCodeAt(0)))
}
