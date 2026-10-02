import type { Metadata } from 'next'
import './globals.css'
import Providers from '@/components/Providers'
import Header from '@/components/Header'

export const metadata: Metadata = {
    title: 'BellCurve — launch tokens paired with tokenized stocks',
    description:
        'A Meteora DBC launchpad where every token is quoted in an xStock (SPYx, NVDAx, TSLAx…). Creators earn equity, curves graduate to DAMM v2.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body className="min-h-screen" suppressHydrationWarning>
                <Providers>
                    <Header />
                    <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
                    <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-muted">
                        Built on Meteora Dynamic Bonding Curve + DAMM v2. xStocks are issued by Backed; not available to US persons. Not
                        investment advice.
                    </footer>
                </Providers>
            </body>
        </html>
    )
}
