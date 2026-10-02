import { NextResponse } from 'next/server'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import { CLUSTER, RPC_URL } from '@/lib/env'
import { DEVNET_MOCK_STOCK } from '@/lib/stocks'

export const revalidate = 0

const SOL_DROP = 0.3 * LAMPORTS_PER_SOL
const STOCK_DROP = BigInt(20) * BigInt(10 ** DEVNET_MOCK_STOCK.decimals)
const COOLDOWN_MS = 10 * 60_000
const recent = new Map<string, number>() // best effort per instance; devnet funds have no value

/** Devnet only: test SOL + 20 mock stock so anyone (judges included) can try the full flow for free. */
export async function POST(req: Request) {
    const secret = process.env.DEVNET_FAUCET_SECRET
    if (CLUSTER !== 'devnet' || !secret || !DEVNET_MOCK_STOCK.mint) return NextResponse.json({ error: 'faucet is only available on the devnet demo' }, { status: 404 })
    let wallet: PublicKey
    try {
        wallet = new PublicKey((await req.json()).wallet)
    } catch {
        return NextResponse.json({ error: 'invalid wallet' }, { status: 400 })
    }
    const key = wallet.toBase58()
    if (Date.now() - (recent.get(key) ?? 0) < COOLDOWN_MS) return NextResponse.json({ error: 'already funded recently, try again in 10 minutes' }, { status: 429 })
    recent.set(key, Date.now())

    const faucet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)))
    const mint = new PublicKey(DEVNET_MOCK_STOCK.mint)
    const ata = getAssociatedTokenAddressSync(mint, wallet, false, TOKEN_2022_PROGRAM_ID)
    const conn = new Connection(process.env.RPC_URL ?? RPC_URL, 'confirmed')
    try {
        const tx = new Transaction().add(
            SystemProgram.transfer({ fromPubkey: faucet.publicKey, toPubkey: wallet, lamports: SOL_DROP }),
            createAssociatedTokenAccountIdempotentInstruction(faucet.publicKey, ata, wallet, mint, TOKEN_2022_PROGRAM_ID),
            createMintToInstruction(mint, ata, faucet.publicKey, STOCK_DROP, [], TOKEN_2022_PROGRAM_ID)
        )
        tx.feePayer = faucet.publicKey
        tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash
        tx.sign(faucet)
        const sig = await conn.sendRawTransaction(tx.serialize())
        const { value } = await conn.confirmTransaction(sig, 'confirmed')
        if (value.err) throw new Error(JSON.stringify(value.err))
        return NextResponse.json({ sig, sol: SOL_DROP / LAMPORTS_PER_SOL, stock: 20, symbol: DEVNET_MOCK_STOCK.symbol })
    } catch (e) {
        recent.delete(key)
        return NextResponse.json({ error: `faucet failed: ${(e as Error).message}` }, { status: 502 })
    }
}
