import BN from 'bn.js'
import { Connection, PublicKey } from '@solana/web3.js'
import { getMint } from '@solana/spl-token'
import { CpAmm, getCurrentPoint, getTokenProgram, SwapMode, type PoolState } from '@meteora-ag/cp-amm-sdk'
import { DAMM_V2_MIGRATION_FEE_ADDRESS, deriveDammV2PoolAddress } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { withPriorityFee, type PoolView } from './dbc'

/** After graduation the curve is closed; trading continues in the DAMM v2 pool DBC migrated into. */
export function successorPool(view: PoolView): PublicKey {
    // DBC migrates into the DAMM v2 config for its migrationFeeOption, with tokenA = base, tokenB = quote
    return deriveDammV2PoolAddress(DAMM_V2_MIGRATION_FEE_ADDRESS[view.config.migrationFeeOption], view.pool.poolState.baseMint, view.config.quoteMint)
}

export type DammQuote = { outputAmount: BN; minimumAmountOut: BN; amountLeft: BN; poolState: PoolState }

export async function quoteDammSwap(connection: Connection, pool: PublicKey, amountIn: BN, sell: boolean, slippageBps = 100): Promise<DammQuote> {
    const poolState = await new CpAmm(connection).fetchPoolState(pool)
    const [mintA, mintB, epoch, currentPoint] = await Promise.all([
        getMint(connection, poolState.tokenAMint, 'confirmed', getTokenProgram(poolState.tokenAFlag)),
        getMint(connection, poolState.tokenBMint, 'confirmed', getTokenProgram(poolState.tokenBFlag)),
        connection.getEpochInfo(),
        getCurrentPoint(connection, poolState.activationType),
    ])
    // xStocks are Token-2022: the quote needs { mint, currentEpoch } for transfer-fee math
    const info = (mint: typeof mintA) => ({ mint, currentEpoch: epoch.epoch })
    const q = new CpAmm(connection).getQuote2({
        inputTokenMint: sell ? poolState.tokenAMint : poolState.tokenBMint,
        slippage: slippageBps / 100,
        currentPoint,
        poolState,
        inputTokenInfo: info(sell ? mintA : mintB),
        outputTokenInfo: info(sell ? mintB : mintA),
        tokenADecimal: mintA.decimals,
        tokenBDecimal: mintB.decimals,
        hasReferral: false,
        swapMode: SwapMode.ExactIn,
        amountIn,
    })
    return { outputAmount: q.outputAmount, minimumAmountOut: q.minimumAmountOut!, amountLeft: new BN(0), poolState }
}

export async function buildDammSwapTx(connection: Connection, owner: PublicKey, pool: PublicKey, poolState: PoolState, amountIn: BN, minOut: BN, sell: boolean) {
    const tx = await new CpAmm(connection).swap2({
        payer: owner,
        pool,
        inputTokenMint: sell ? poolState.tokenAMint : poolState.tokenBMint,
        outputTokenMint: sell ? poolState.tokenBMint : poolState.tokenAMint,
        tokenAMint: poolState.tokenAMint,
        tokenBMint: poolState.tokenBMint,
        tokenAVault: poolState.tokenAVault,
        tokenBVault: poolState.tokenBVault,
        tokenAProgram: getTokenProgram(poolState.tokenAFlag),
        tokenBProgram: getTokenProgram(poolState.tokenBFlag),
        referralTokenAccount: null,
        poolState,
        swapMode: SwapMode.ExactIn,
        amountIn,
        minimumAmountOut: minOut,
    })
    const { blockhash } = await connection.getLatestBlockhash('confirmed')
    tx.recentBlockhash = blockhash
    tx.feePayer = owner
    return withPriorityFee(connection, tx)
}
