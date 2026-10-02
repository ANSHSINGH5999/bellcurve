import { Connection, PublicKey, type ConfirmedSignatureInfo } from '@solana/web3.js'
import type { PoolConfig, VirtualPool } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { dbcClient, LAUNCH_MEMO_PREFIX } from './dbc'

/**
 * Launch index without getProgramAccounts or getTransaction (free RPCs block the first and throttle the second):
 * every BellCurve pool tx sends 0 lamports to the platform wallet and carries the memo `bellcurve:v1:<pool>`,
 * and getSignaturesForAddress returns memos inline. Anyone can forge a memo, so each pool is verified on-chain:
 * it must be a DBC pool whose config pays the platform wallet.
 */
export type LaunchRef = { config: string; quoteMint: string; pool: string; baseMint: string; createdAt: number | null }

const MEMO_RE = new RegExp(`${LAUNCH_MEMO_PREFIX}([1-9A-HJ-NP-Za-km-z]{32,44})`)

/** Free RPCs answer bursts with 429: space calls out and back off before giving up. */
let lastCall = 0
async function paced<T>(f: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        const wait = lastCall + 250 - Date.now()
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        lastCall = Date.now()
        try {
            return await f()
        } catch (e) {
            if (attempt >= 3 || !String((e as Error).message).includes('429')) throw e
            await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt))
        }
    }
}

async function allSignatures(conn: Connection, address: PublicKey, maxPages = 10) {
    const out: ConfirmedSignatureInfo[] = []
    let before: string | undefined
    for (let i = 0; i < maxPages; i++) {
        const page = await paced(() => conn.getSignaturesForAddress(address, { before, limit: 1000 }))
        out.push(...page)
        if (page.length < 1000) break
        before = page[page.length - 1].signature
    }
    return out.filter((s) => !s.err)
}

// verified launches never change, so each pool is checked at most once per server instance
const verified = new Map<string, LaunchRef | null>()

export async function findLaunches(conn: Connection, platform: PublicKey): Promise<LaunchRef[]> {
    const client = dbcClient(conn)
    const launches: LaunchRef[] = []
    for (const s of await allSignatures(conn, platform)) {
        const pool = s.memo?.match(MEMO_RE)?.[1]
        if (!pool) continue
        if (!verified.has(pool)) {
            // a failed read is retried on the next request; only a definitive answer is cached
            let state: VirtualPool | null, config: PoolConfig | null
            try {
                state = await paced(() => client.state.getPool(pool))
                const cfgKey = state?.poolState.config
                config = cfgKey ? await paced(() => client.state.getPoolConfig(cfgKey)) : null
            } catch {
                continue
            }
            verified.set(
                pool,
                state && config && config.feeClaimer.equals(platform)
                    ? {
                          config: state.poolState.config.toBase58(),
                          quoteMint: config.quoteMint.toBase58(),
                          pool,
                          baseMint: state.poolState.baseMint.toBase58(),
                          createdAt: s.blockTime ?? null,
                      }
                    : null
            )
        }
        const ref = verified.get(pool)
        if (ref && !launches.some((l) => l.pool === pool)) launches.push(ref)
    }
    return launches.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}
