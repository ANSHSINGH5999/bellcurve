# BellCurve — token launches priced in equities

**A Meteora Dynamic Bonding Curve launchpad where every curve is quoted in a tokenized stock (xStocks: SPYx, NVDAx, TSLAx, …).**
Buyers pay in stock. Creators earn stock. Every graduated pool adds equity liquidity to Meteora DAMM v2.

> Submission for *Best use of Meteora's Dynamic Bonding Curve* — Colosseum Crypto World's Fair sidetrack.

## Why this matters

Launchpads today price everything in SOL or USDC. That leaves out a whole class of assets: tokens whose value is naturally measured **against a stock**:

- **Ticker-themed and narrative tokens** ("the Robotaxi token") trade as a bet *relative to* TSLA. Pricing them in TSLAx makes that bet explicit.
- **RWA wrappers, baskets and revenue-share tokens** have a fundamental anchor. A near-flat curve in SPYx fits them far better than a 100x meme curve in SOL.
- **Creators accumulate equity.** Fees are collected in the quote asset, so a creator's income is SPYx/NVDAx, not their own token. That's a healthier incentive than selling into their own community.
- **xStocks gain organic demand and liquidity.** Every launch buys stock on the way in, and every graduation seeds a DAMM v2 pool paired with an xStock.

## What's built

| Area | Detail |
|---|---|
| Stock-quoted DBC configs | One config per launch with `quoteMint = xStock`. All 12 supported xStocks were verified on mainnet to have a **DBC TokenBadge**, which is passed as a remaining account. |
| USD → equity curve engine | `src/lib/curve.ts` converts USD market-cap targets into raw stock units using the Jupiter price × the xStock **ScaledUiAmount multiplier**, so dividends don't silently reprice the curve. |
| Keeper-floor guard | Meteora keepers auto-migrate stock-quoted pools only when `migration_quote_threshold ≥ $750` equivalent. The engine rejects plans below the floor and warns near it. |
| 5 curve presets | Fair Discovery · Opening Bell (exponential anti-snipe fee, 50%→1% over 3 min) · Earnings Run (16-segment liquidity weights 1→12x) · Flat RWA (≈1.6x price range, compounding DAMM v2 after graduation) · Long Curve (two segments, $750k graduation). |
| Preset export | `/presets` exports any preset as ready-to-use `ConfigParameters` JSON for other launchpads (a DBC config preset marketplace). |
| Unsnipeable creator buy | `createConfigAndPoolWithFirstBuy` with `enableFirstSwapWithMinFee`: the creator's first buy lands in the pool-creation tx. |
| Issuer-pause awareness | Reads the xStock `PausableConfig`. If the issuer pauses the mint, launch and trade are disabled in the UI instead of failing on-chain. |
| Safe graduation | 60% of graduated LP is permanently locked (partner 50 + creator 10), and token authority is immutable. |
| Trading + fee claim | Buy and sell on the curve with SDK quotes and slippage protection. Buys use DBC's `PartialFill` swap mode, so an oversized final buy fills exactly to graduation and the unused stock stays in the buyer's wallet. Creators claim fees in stock from the token page. |
| Buy with SOL | Most people don't hold xStocks. The trade panel routes SOL → xStock through Jupiter, then buys the curve with Jupiter's *guaranteed minimum* output: two txs, one wallet approval, and the curve buy can never be short of funds. |
| Alpha vs. the stock | The curve is priced in shares, so the token's change in stock terms since launch is exactly its outperformance vs. holding the stock. The token page shows it as the headline number. |
| Launch index on any RPC | `create_config` lists the platform wallet as `fee_claimer`, so `/api/launches` finds every launch from that wallet's signature history (edge-cached). No getProgramAccounts, which free RPCs block. |
| Fails loudly | `confirmTransaction` resolves even for failed txs; every launch, trade and claim goes through `confirmOrThrow`, so the UI never reports a failed tx as success. |
| Tests | 27 vitest cases: every preset × 5 price regimes passes the SDK's own `validateConfigParameters`, stays above the keeper floor, has a monotonic price, and raises ≈ the threshold. |

## Architecture

```
 Creator / trader wallet (Phantom, Wallet Standard)
        │ signs
        ▼
 Next.js app ── /api/prices ──► Jupiter Price v3 (xStock USD)
   │  launch wizard                │
   │  token page                   └─ × ScaledUiAmount multiplier (read from the Token-2022 mint)
   │                                   = USD per raw stock unit
   ▼
 src/lib/curve.ts  USD market-cap targets → raw-xStock DBC ConfigParameters (+ $750 keeper-floor guard)
   ▼
 src/lib/dbc.ts    tx 1: createConfig (quote = xStock, + DBC TokenBadge)
                   tx 2: createPool + creator first buy (min-fee first swap)
                   swap2 PartialFill · claimCreatorTradingFee
   ▼
 Meteora DBC program (dbcij3…) ── curve fills to migrationQuoteThreshold ──► Meteora keeper
                                                                               ▼
                                                     Meteora DAMM v2 pool (token / xStock), 60% LP locked
```


src/lib/stocks.ts    xStock registry (verified mints), TokenBadge PDAs, keeper floor
src/lib/price.ts     Jupiter Price v3 + ScaledUiAmount multiplier + PausableConfig
src/lib/presets.ts   USD-denominated curve presets
src/lib/curve.ts     USD → stock curve engine + exact curve simulation (SDK math)
src/lib/dbc.ts       launch tx builder (config + pool + first buy), swap2 PartialFill, listing
src/lib/zap.ts       Buy with SOL: Jupiter SOL → xStock route
src/lib/launches.ts  launch index from the platform wallet's signature history (no getProgramAccounts)
src/app/launch       launch wizard with live curve preview
src/app/t/[mint]     token page: progress, chart, trade, creator fee claim
src/app/presets      preset gallery + JSON export
scripts/devnet-e2e   mock stock → launch → buy → sell on devnet
scripts/fork-e2e     mainnet-state fork: all presets, launch → trade → claim → graduate to DAMM v2
```

## Run

```bash
pnpm install
cp .env.example .env.local   # set RPC (Helius etc.), platform wallet, site URL
pnpm test                    # curve engine tests
pnpm dev
```

### Mainnet-fork end-to-end (zero cost, the strongest test)

```bash
pnpm fork:e2e
```

This boots `solana-test-validator` with **mainnet state** cloned in: the real DBC and DAMM v2 programs, the real NVDAx mint, and NVDAx's real DBC and DAMM v2 TokenBadges. The NVDAx mint authority is patched only on the local copy, so the test can mint itself NVDAx. Then, for **every preset**, it runs launch + first buy → buy → sell → creator fee claim → over-buy that fills the curve (PartialFill) → `migrateToDammV2`, and asserts the DAMM v2 pool exists. It runs the same `src/lib/dbc.ts` code as the UI.

```
✓ fair-discovery  launch+first buy, buy, sell, claim 0.0058 NVDAx fees, fill (134.12 NVDAx unspent), migrate -> DAMM v2
✓ opening-bell    launch+first buy, buy, sell, claim 0.2340 NVDAx fees, fill (41.84 NVDAx unspent), migrate -> DAMM v2
✓ earnings-run    launch+first buy, buy, sell, claim 0.0077 NVDAx fees, fill (240.91 NVDAx unspent), migrate -> DAMM v2
✓ flat-rwa        launch+first buy, buy, sell, claim 0.0029 NVDAx fees, fill (277.62 NVDAx unspent), migrate -> DAMM v2
✓ long-curve      launch+first buy, buy, sell, claim 0.0058 NVDAx fees, fill (1273.92 NVDAx unspent), migrate -> DAMM v2
```

Launch tx sizes are 694–1142 bytes for createConfig and 1005 bytes for createPool+first buy, all under the 1232-byte limit.

### Devnet end-to-end

```bash
solana airdrop 2 --url devnet
pnpm devnet:e2e              # creates a mock 8-dec Token-2022 "stock", launches, buys, sells
# then set NEXT_PUBLIC_CLUSTER=devnet and NEXT_PUBLIC_DEVNET_MOCK_STOCK_MINT=<printed mint>
```

## Proof (devnet, `pnpm devnet:e2e`, Opening Bell preset)

Quote token: mock 8-decimal Token-2022 stand-in for NVDAx, [`CqtBbGGG…`](https://solscan.io/account/CqtBbGGGdCsLX3qcVjmh8rUUYJKhg1ZMLT8eYif5MQ4E?cluster=devnet) (xStocks don't exist on devnet).

| Step | Account | Tx |
|---|---|---|
| 1. createConfig (quote = mock stock, curve from the USD → stock engine) | [`5wQdLUET…`](https://solscan.io/account/5wQdLUETbSM4DXNgLNbhoPYQpxQhYZu2z7KkxjhJXE4K?cluster=devnet) | [`2WppkdNq…`](https://solscan.io/tx/2WppkdNqAPy81Nkcx35zyEwDHPrknEZFSZ7A7PXye5EC14k4QD7ofBqzBPEqqTKzW9CACnbmQj3f8bEgv93BNDfN?cluster=devnet) |
| 2. createPool + creator first buy (1 stock, min-fee first swap) | base mint [`2bmiYveV…`](https://solscan.io/account/2bmiYveVGFNb3m7XeeKoXzcKabcz1zUT9p2WXY2iKe8o?cluster=devnet) | [`4eRVZwzV…`](https://solscan.io/tx/4eRVZwzVSq3yW5ictcZtuqhkn8TXQTaYcVHCeU8bXPTyMyj7czww8dN8pdCRsws3xGrbm7kgMMS27gYmmFTd9WHP?cluster=devnet) |
| 3. Buy 5 stock on the curve | | [`2K4puXZn…`](https://solscan.io/tx/2K4puXZnwgMQGLfWDLViCCiqCybtNrvZyRUASBxHWx1CQC2YoHTwe74AeEKBjxECrT7ty23yN891Ddut3wbHABb?cluster=devnet) |
| 4. Sell half back | | [`3Nw49zhx…`](https://solscan.io/tx/3Nw49zhxAZCTU94ZtN7XJjk49m6i5RGyds4ivpeXHjthybNBLQUy5FvVUQwWV8JusyTrTHUiX7YnLoPCJ8AAS3Zd?cluster=devnet) |

After the run the pool held 2.206 mock-stock in quote reserve, and the creator had accrued 1.212 mock-stock in fees. Fees are paid in the stock, and step 3 landed inside the Opening Bell anti-snipe window, so it paid the high early fee.

## Roadmap

- Alpha-vs-stock history chart (today the token page shows it since launch).
- Sell to SOL (reverse of Buy with SOL).
- Basket quotes (e.g. a Mag-7 basket token as quote).
- Market-cap-based DAMM v2 fee scheduler after graduation.
- Referral fees paid in stock.

Not investment advice. xStocks are not available to US persons. Check eligibility in your jurisdiction.
