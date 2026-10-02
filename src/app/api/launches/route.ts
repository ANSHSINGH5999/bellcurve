import { NextResponse } from 'next/server'
import { Connection } from '@solana/web3.js'
import { PLATFORM_FEE_CLAIMER } from '@/lib/dbc'
import { RPC_URL } from '@/lib/env'
import { findLaunches, type LaunchRef } from '@/lib/launches'

// if the RPC is throttling us, serving the last good list beats an empty page
let lastGood: LaunchRef[] | null = null

export const revalidate = 0

// Indexes launches from the platform wallet's signature history (no getProgramAccounts), cached at the edge.
export async function GET() {
    try {
        const launches = await findLaunches(new Connection(process.env.RPC_URL ?? RPC_URL, 'confirmed'), PLATFORM_FEE_CLAIMER)
        lastGood = launches
        return NextResponse.json(launches, { headers: { 'cache-control': 's-maxage=30, stale-while-revalidate=300' } })
    } catch (e) {
        if (lastGood) return NextResponse.json(lastGood, { headers: { 'cache-control': 's-maxage=10', 'x-stale': '1' } })
        return NextResponse.json({ error: String(e) }, { status: 502 })
    }
}
