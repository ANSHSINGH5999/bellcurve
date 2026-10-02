export const CLUSTER = (process.env.NEXT_PUBLIC_CLUSTER ?? 'mainnet-beta') as 'mainnet-beta' | 'devnet'
export const RPC_URL =
    process.env.NEXT_PUBLIC_RPC_URL ?? (CLUSTER === 'devnet' ? 'https://api.devnet.solana.com' : 'https://solana-rpc.publicnode.com')
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
export const explorer = (addr: string, kind: 'address' | 'tx' = 'address') =>
    `https://solscan.io/${kind === 'tx' ? 'tx' : 'account'}/${addr}${CLUSTER === 'devnet' ? '?cluster=devnet' : ''}`
