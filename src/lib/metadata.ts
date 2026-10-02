import { Connection, PublicKey } from '@solana/web3.js'

const METAPLEX = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')

export type TokenMeta = { name: string; symbol: string; uri: string; image?: string; quote?: string; preset?: string }

/** Minimal Metaplex metadata parser (key u8, updateAuth 32, mint 32, then 3 borsh strings). */
export async function fetchTokenMeta(connection: Connection, mint: string): Promise<TokenMeta | null> {
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from('metadata'), METAPLEX.toBuffer(), new PublicKey(mint).toBuffer()], METAPLEX)
    const acc = await connection.getAccountInfo(pda)
    if (!acc) return null
    const d = acc.data
    let o = 1 + 32 + 32
    const str = () => {
        const len = d.readUInt32LE(o)
        o += 4
        const s = d.subarray(o, o + len).toString('utf8').replace(/\0/g, '').trim()
        o += len
        return s
    }
    const meta: TokenMeta = { name: str(), symbol: str(), uri: str() }
    try {
        const u = new URL(meta.uri)
        meta.image = u.searchParams.get('i') ?? undefined
        meta.quote = u.searchParams.get('q') ?? undefined
        meta.preset = u.searchParams.get('p') ?? undefined
        if (!meta.image) {
            const j = await fetch(meta.uri).then((r) => r.json())
            meta.image = j.image
        }
    } catch {}
    return meta
}
