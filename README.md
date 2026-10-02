# BellCurve — conviction you can verify

**The first launchpad built on Meteora's whole stack: DBC → DAMM v2 → DLMM.** Tokens launch on a Dynamic Bonding Curve quoted in a tokenized stock (NVDAx, SPYx, TSLAx…), graduate into DAMM v2, and every launch gets a **Conviction Pool** on DLMM where holders publicly commit, on-chain, to how they will trade.

> Submission for *Best use of Meteora's Dynamic Bonding Curve*, Colosseum Crypto World's Fair sidetrack.
> **Mainnet:** https://bellcurve-launch.vercel.app · **Try it free (devnet):** https://bellcurve-devnet.vercel.app

### Try it free in 5 minutes (devnet, test tokens with no value)

1. Switch your wallet to devnet (Phantom: Settings → Developer Settings → Testnet Mode → Solana Devnet) and open https://bellcurve-devnet.vercel.app.
2. Press **Get test funds**: 0.3 test SOL + 20 mNVDAx (a mock 8-decimal Token-2022 NVDAx).
3. **Launch** with the **Devnet Demo** curve (graduates at ~5 mNVDAx), then open the token's **Conviction Pool** and commit a sell wall.
4. Buy the rest of the curve, press **Graduate to DAMM v2**, and keep trading in the graduated pool.

The whole run costs ~0.19 test SOL (measured with a fresh wallet funded only by the faucet). The biggest item is one-time DLMM bin-array rent (0.0714 SOL), which the app shows before you sign.

## The problem: graduations don't mean demand

According to [Litmus](https://github.com/omreor/litmus), **98.9% of DBC graduations since April 2025 were "uncontested"**: no independent buyers competed to fill the curve (it was filled by its creator or one bundle, completed in its creation slot, had a trivial threshold, or sat on an auto-completing template). A graduation badge, a holder count and a chart all look the same whether demand is real or manufactured. Buyers have no way to see what holders will actually do next.

## The primitive: Conviction Pools

Next to every launch, BellCurve opens a Meteora **DLMM** pool (token / xStock) where commitments are **DLMM limit orders**:

- **Sell wall**: "I'll only sell my tokens between 2× and 5× today's price." The order sits above market and fills only as buyers push the price up.
- **Support**: "I'll buy any dip to −30%." Stock sits below market and fills only if the price falls there.

Every commitment is public, priced in shares of the stock, and anyone can audit it. The token page leads with a **Conviction Score**: the share of supply committed to sell only above market, plus a live depth ladder of walls vs support. Limit orders (not plain liquidity) mean a filled wall stays filled, so a commitment can't silently revert. Holders keep custody and can withdraw unfilled amounts any time; filled walls pay out in the stock.

It also answers Meteora's ask for **price discovery in thin markets**: a brand-new token gets real depth at stated prices from day one, not just a curve.

## The full flow

| Stage | Meteora product | What BellCurve does |
|---|---|---|
| Launch | **DBC** | Per-launch config with an xStock quote mint + TokenBadge, USD→stock curve engine (dividend multiplier aware), 5 presets incl. Flat RWA and Opening Bell anti-snipe, min-fee creator first buy |
| Trade | **DBC** `swap2` PartialFill, Jupiter | Buy with the stock or with plain SOL; the graduating buy can't revert |
| Graduate | **DAMM v2** | Keeper-floor guard so curves auto-migrate; 60% LP permanently locked; Flat RWA graduates into a **compounding-liquidity** DAMM v2 pool; the app finds the successor pool and keeps trading it in-app |
| Commit | **DLMM** | Conviction Pool: sell walls and support as limit orders, Conviction Score, depth ladder, withdraw |

## Why stock-quoted

A token priced in shares has a natural benchmark, the stock itself. BellCurve shows every token's **alpha vs. the stock** (its return in share terms = outperformance vs. just holding NVDA). Creators earn trading fees in equity instead of dumping their own token, and every launch and graduation adds organic xStock liquidity.

## What's built

| Area | Detail |
|---|---|
| Stock-quoted DBC configs | One config per launch with `quoteMint = xStock`. All 12 supported xStocks were verified on mainnet to have a **DBC TokenBadge**, which is passed as a remaining account. |
| USD → equity curve engine | `src/lib/curve.ts` converts USD market-cap targets into raw stock units using the Jupiter price × the xStock **ScaledUiAmount multiplier**, so dividends don't silently reprice the curve. |
| Keeper-floor guard | Meteora keepers auto-migrate stock-quoted pools only when `migration_quote_threshold ≥ $750` equivalent. The engine rejects plans below the floor and warns near it. |
| 5 curve presets | Fair Discovery · Opening Bell (exponential anti-snipe fee, 50%→1% over 3 min) · Earnings Run (16-segment liquidity weights 1→12x) · Flat RWA (≈1.6x price range, compounding DAMM v2 after graduation) · Long Curve (two segments, $750k graduation). |
| Preset API (developer tooling) | `GET /api/presets?id=<preset>&stock=<symbol>` returns a ready DBC `ConfigParameters` for any preset × any xStock, priced live (Jupiter × ScaledUiAmount multiplier) with the keeper floor enforced, plus the TokenBadge to pass. BN fields are decimal strings, and a test revives them and runs the SDK validator. CORS is open, so trading terminals and other launchpads can call it directly. `GET /api/presets` lists presets and stocks. `/presets` has the same as copy-to-clipboard. |
| Unsnipeable creator buy | `createConfigAndPoolWithFirstBuy` with `enableFirstSwapWithMinFee`: the creator's first buy lands in the pool-creation tx. |
| Issuer-pause awareness | Reads the xStock `PausableConfig`. If the issuer pauses the mint, launch and trade are disabled in the UI instead of failing on-chain. |
| Safe graduation | 60% of graduated LP is permanently locked (partner 50 + creator 10), and token authority is immutable. |
| Trading + fee claim | Buy and sell on the curve with SDK quotes and slippage protection. Buys use DBC's `PartialFill` swap mode, so an oversized final buy fills exactly to graduation and the unused stock stays in the buyer's wallet. Creators claim fees in stock from the token page. |
| Conviction Pools (DLMM) | `src/lib/conviction.ts`: one customizable DLMM pair per launch (1% bins), commitments as DLMM limit orders spread over up to 12 non-adjacent bins so any range (e.g. 2×–5×) fits one tx, ladder + Conviction Score, withdraw returns proceeds + unfilled. Orientation-agnostic: there is exactly one customizable pair per mint pair and anyone could create it first, even with the mints reversed; the fork test covers that case. `src/components/ConvictionPanel.tsx` renders the score, a depth chart and the commit/withdraw flows. |
| Trading after graduation | `src/lib/damm.ts` derives the successor DAMM v2 pool (`DAMM_V2_MIGRATION_FEE_ADDRESS[migrationFeeOption]`, base, quote), quotes with Token-2022 mint info for transfer-fee math, and swaps via `swap2`; the trade panel switches venue automatically, so the page doesn't break at graduation. |
| Priority fees | Every tx BellCurve builds gets a compute-unit price (recent median, clamped) and a simulated compute limit, so it lands on a busy mainnet. Worst case ≈ 0.0004 SOL per tx. |
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
                                                       (src/lib/damm.ts: successor pool, in-app swaps)

 src/lib/conviction.ts  Meteora DLMM pair (token / xStock), 1% bins
                        sell walls (asks) + support (bids) as limit orders → Conviction Score + depth ladder
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
scripts/fork-e2e     mainnet-state fork: all presets launch → trade → claim → graduate → trade DAMM v2; Conviction Pools on DLMM
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

This boots `solana-test-validator` with **mainnet state** cloned in: the real DBC, DAMM v2 and DLMM programs, the real NVDAx mint, and NVDAx's real DBC, DAMM v2 and DLMM TokenBadges. The NVDAx mint authority is patched only on the local copy, so the test can mint itself NVDAx. It runs the same `src/lib` code as the UI:

- for **every preset**: launch + first buy → buy → sell → creator fee claim → over-buy that fills the curve (PartialFill) → `migrateToDammV2` → find the successor DAMM v2 pool and **buy + sell in it**;
- **Conviction Pool**: open the DLMM pool at the curve price; the creator commits a sell wall over 1.02×–3×, a second wallet commits 5 NVDAx of support; a DLMM buy fills part of the wall; the creator withdraws proceeds + unfilled tokens; the ladder is checked at each step;
- **reversed pair**: someone else creates the DLMM pair first with the mints swapped; a wall at 1.5×–4× must still land above market at the right prices;
- the launch index must find every launch without getProgramAccounts.

```
✓ fair-discovery  launch+first buy, buy, sell, claim 0.0058 NVDAx fees, fill (134.12 NVDAx unspent), migrate -> DAMM v2, in-app buy+sell on DAMM v2
✓ opening-bell    launch+first buy, buy, sell, claim 0.2340 NVDAx fees, fill (41.84 NVDAx unspent), migrate -> DAMM v2, in-app buy+sell on DAMM v2
✓ earnings-run    launch+first buy, buy, sell, claim 0.0077 NVDAx fees, fill (240.91 NVDAx unspent), migrate -> DAMM v2, in-app buy+sell on DAMM v2
✓ flat-rwa        launch+first buy, buy, sell, claim 0.0029 NVDAx fees, fill (277.62 NVDAx unspent), migrate -> DAMM v2, in-app buy+sell on DAMM v2
✓ long-curve      launch+first buy, buy, sell, claim 0.0058 NVDAx fees, fill (1273.92 NVDAx unspent), migrate -> DAMM v2, in-app buy+sell on DAMM v2
✓ conviction pool    wall 37445424 tokens (3.745% of supply) + support 5 NVDAx by a 2nd wallet; DLMM buy filled 24963616 tokens; creator withdrew 0.9552 NVDAx of sale proceeds + unfilled tokens
✓ reversed pair      wall of 37445424 tokens lands above market at 1.5x–4x across non-adjacent bins even with quote as DLMM token X
✓ launch index found all 7 launches without getProgramAccounts
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
- Conviction Score on the launch list and in the preset API, so terminals can rank launches by committed supply.
- Creator auto-wall: optionally place the creator's first-buy tokens into a sell wall at launch, in the same flow.
- Basket quotes (e.g. a Mag-7 basket token as quote).
- Market-cap-based DAMM v2 fee scheduler after graduation.
- Referral fees paid in stock.

Not investment advice. xStocks are not available to US persons. Check eligibility in your jurisdiction.
