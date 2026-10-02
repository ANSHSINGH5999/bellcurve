import { Connection, PublicKey, type ConfirmedSignatureInfo, type VersionedTransactionResponse } from '@solana/web3.js'
import { DynamicBondingCurveIdl, DYNAMIC_BONDING_CURVE_PROGRAM_ID } from '@meteora-ag/dynamic-bonding-curve-sdk'

/**
 * Launch index without getProgramAccounts (which most free RPCs block):
 * create_config lists the platform wallet as `fee_claimer`, so the platform wallet's signature history
 * contains every BellCurve config. Each config's oldest transactions contain its pool initialization.
 */
export type LaunchRef = { config: string; quoteMint: string; pool: string; baseMint: string; createdAt: number | null }

const disc = (name: string) => Buffer.from(DynamicBondingCurveIdl.instructions.find((i) => i.name === name)!.discriminator)
const CREATE_CONFIG = disc('create_config')
const INIT_POOL = [disc('initialize_virtual_pool_with_token2022'), disc('initialize_virtual_pool_with_spl_token')]

async function allSignatures(conn: Connection, address: PublicKey, maxPages = 10) {
    const out: ConfirmedSignatureInfo[] = []
    let before: string | undefined
    for (let i = 0; i < maxPages; i++) {
        const page = await conn.getSignaturesForAddress(address, { before, limit: 1000 })
        out.push(...page)
        if (page.length < 1000) break
        before = page[page.length - 1].signature
    }
    return out.filter((s) => !s.err)
}

/** DBC instructions in a tx as [accountKeys, data], with lookup-table keys resolved. */
function dbcInstructions(tx: VersionedTransactionResponse) {
    const msg = tx.transaction.message
    const keys = msg.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses }).keySegments().flat()
    return msg.compiledInstructions
        .filter((ix) => keys[ix.programIdIndex].equals(DYNAMIC_BONDING_CURVE_PROGRAM_ID))
        .map((ix) => ({ accounts: ix.accountKeyIndexes.map((i) => keys[i]), data: Buffer.from(ix.data) }))
}

const getTx = (conn: Connection, sig: string) => conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })

// launches are immutable once found, so cache per server instance: each tx is fetched at most once
const configsBySig = new Map<string, { config: PublicKey; quoteMint: PublicKey }[]>()
const launchByConfig = new Map<string, LaunchRef>()

export async function findLaunches(conn: Connection, platform: PublicKey): Promise<LaunchRef[]> {
    // sequential on purpose: free RPCs rate-limit bursts of getTransaction
    const configs: { config: PublicKey; quoteMint: PublicKey }[] = []
    for (const s of await allSignatures(conn, platform)) {
        let found = configsBySig.get(s.signature)
        if (!found) {
            const tx = await getTx(conn, s.signature)
            if (!tx) continue
            found = dbcInstructions(tx)
                // create_config accounts: config, fee_claimer, leftover_receiver, quote_mint, payer, ...
                .filter((ix) => ix.data.subarray(0, 8).equals(CREATE_CONFIG) && ix.accounts[1].equals(platform))
                .map((ix) => ({ config: ix.accounts[0], quoteMint: ix.accounts[3] }))
            configsBySig.set(s.signature, found)
        }
        configs.push(...found)
    }

    const launches: LaunchRef[] = []
    for (const { config, quoteMint } of configs) {
        const cached = launchByConfig.get(config.toBase58())
        if (cached) {
            launches.push(cached)
            continue
        }
        // pool init is the 2nd tx ever to touch the config; signatures come newest-first
        const sigs = (await allSignatures(conn, config)).slice(-3).reverse()
        search: for (const s of sigs) {
            const tx = await getTx(conn, s.signature)
            for (const ix of tx ? dbcInstructions(tx) : []) {
                // initialize_virtual_pool_*: config, pool_authority, creator, base_mint, quote_mint, pool, ...
                if (INIT_POOL.some((d) => ix.data.subarray(0, 8).equals(d)) && ix.accounts[0].equals(config)) {
                    const ref = {
                        config: config.toBase58(),
                        quoteMint: quoteMint.toBase58(),
                        pool: ix.accounts[5].toBase58(),
                        baseMint: ix.accounts[3].toBase58(),
                        createdAt: s.blockTime ?? null,
                    }
                    launchByConfig.set(ref.config, ref)
                    launches.push(ref)
                    break search
                }
            }
        }
    }
    return launches.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}
