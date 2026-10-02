'use client'
import Link from 'next/link'
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
                <WalletMultiButton />
            </div>
        </header>
    )
}
