'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import dynamic from 'next/dynamic'
import { CLUSTER } from '@/lib/env'

const WalletMultiButton = dynamic(() => import('@solana/wallet-adapter-react-ui').then((m) => m.WalletMultiButton), { ssr: false })

export default function Header() {
    return (
        <header className="border-b border-line">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
                <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
                    <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-sm text-black">BC</span>
                    BellCurve
                    {CLUSTER === 'devnet' && <span className="tag">devnet</span>}
                </Link>
                <nav className="hidden gap-5 text-sm text-muted sm:flex">
                    <Link href="/" className="hover:text-text">Launches</Link>
                    <Link href="/launch" className="hover:text-text">Launch</Link>
                    <Link href="/presets" className="hover:text-text">Curve presets</Link>
                </nav>
                <div className="flex items-center gap-2">
                    {CLUSTER === 'devnet' && <FaucetButton />}
                    <WalletMultiButton />
                </div>
            </div>
        </header>
    )
}

/** Devnet demo: free test SOL + mock stock, so anyone can try launch → trade → Conviction → graduation. */
function FaucetButton() {
    const { publicKey } = useWallet()
    const [msg, setMsg] = useState('')
    async function drip() {
        if (!publicKey) return setMsg('Connect a wallet (set to devnet) first')
        setMsg('Sending…')
        const r = await fetch('/api/faucet', { method: 'POST', body: JSON.stringify({ wallet: publicKey.toBase58() }) }).then((x) => x.json()).catch(() => ({ error: 'network error' }))
        setMsg(r.error ? `❌ ${r.error}` : `✅ +${r.sol} SOL, +${r.stock} ${r.symbol}`)
    }
    return (
        <div className="flex items-center gap-2">
            {msg && <span className="hidden text-xs text-muted md:inline">{msg}</span>}
            <button className="btn btn-ghost" onClick={drip}>
                Get test funds
            </button>
        </div>
    )
}
