'use client'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import '@solana/wallet-adapter-react-ui/styles.css'
import { RPC_URL } from '@/lib/env'

// Wallet Standard auto-detects Phantom, Solflare, Backpack, Jupiter etc. — no adapter list needed.
export default function Providers({ children }: { children: React.ReactNode }) {
    return (
        <ConnectionProvider endpoint={RPC_URL} config={{ commitment: 'confirmed' }}>
            <WalletProvider wallets={[]} autoConnect>
                <WalletModalProvider>{children}</WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    )
}
