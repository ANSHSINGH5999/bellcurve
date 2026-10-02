# StockCurve — token launches priced in equities

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
| Trading + fee claim | Buy and sell on the curve with SDK quotes and slippage protection. Creators claim fees in stock from the token page. |
| Tests | 27 vitest cases: every preset × 5 price regimes passes the SDK's own `validateConfigParameters`, stays above the keeper floor, has a monotonic price, and raises ≈ the threshold. |

## Architecture

```
src/lib/stocks.ts    xStock registry (verified mints), TokenBadge PDAs, keeper floor
src/lib/price.ts     Jupiter Price v3 + ScaledUiAmount multiplier + PausableConfig
src/lib/presets.ts   USD-denominated curve presets
src/lib/curve.ts     USD → stock curve engine + exact curve simulation (SDK math)
src/lib/dbc.ts       launch tx builder (config + pool + first buy), swap, listing
src/app/launch       launch wizard with live curve preview
src/app/t/[mint]     token page: progress, chart, trade, creator fee claim
src/app/presets      preset gallery + JSON export
scripts/devnet-e2e   mock stock → launch → buy → sell on devnet
```

## Run

```bash
pnpm install
cp .env.example .env.local   # set RPC (Helius etc.), platform wallet, site URL
pnpm test                    # curve engine tests
pnpm dev
```

### Devnet end-to-end

```bash
solana airdrop 2 --url devnet
pnpm devnet:e2e              # creates a mock 8-dec Token-2022 "stock", launches, buys, sells
# then set NEXT_PUBLIC_CLUSTER=devnet and NEXT_PUBLIC_DEVNET_MOCK_STOCK_MINT=<printed mint>
```

## Roadmap

- Stock-relative charts (token / underlying performance, "alpha vs NVDA").
- Basket quotes (e.g. a Mag-7 basket token as quote).
- Market-cap-based DAMM v2 fee scheduler after graduation.
- Referral fees paid in stock.

Not investment advice. xStocks are not available to US persons. Check eligibility in your jurisdiction.
