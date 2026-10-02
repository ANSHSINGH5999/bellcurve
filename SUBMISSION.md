# BellCurve: win plan for the Meteora DBC track

**Prize pool:** 10k USDC, split 5k / 3k / 1.5k / 500 / … for 5 places. Separate discretionary infra grants go to AI/RWA DBC projects.
**Deadline:** 13 Oct 2026, 12:29 PM IST (06:59 UTC). Winners are announced 31 Oct.
**Competition:** 14 submissions as of 1 Oct.

## How the judges score, and how BellCurve answers

| Criterion | Our answer |
|---|---|
| Depth of Meteora integration | DBC end to end: custom xStock quote mint + TokenBadge, all three curve builders (market cap, 16-segment liquidity weights, two segments), exponential and linear fee schedulers, dynamic fee, min-fee creator first buy, `swap2` PartialFill, creator fee claims. Graduation into DAMM v2 with a custom fee, 60% permanently locked LP, and **Compounding Liquidity DAMM v2 pools** (Flat RWA preset). The whole lifecycle including `migrateToDammV2` is tested on cloned mainnet state. |
| Technical execution | USD → equity engine handling the ScaledUiAmount multiplier, keeper-floor guard, and issuer-pause detection. 29 unit tests run against the SDK's own validator, plus `pnpm fork:e2e`: every preset's full lifecycle (launch → trade → claim → graduate to DAMM v2) on cloned **mainnet** state. The launch index needs no getProgramAccounts, so it runs on a free RPC. |
| Originality & taste | Built to outlast the meme-stock meta. A token priced in shares has a natural benchmark, the stock itself, so BellCurve treats every launch as an **equity-relative asset**: the headline number is **alpha vs. the stock** (its return in share terms = outperformance vs. holding NVDA), and the **Flat RWA** curve (~1.6× price range, compounding DAMM v2 after graduation) fits revenue-share tokens, baskets and RWA wrappers rather than 100× memes. Stock-quoted DBC itself is the track's theme, so the edge is what's built on it: **alpha vs. the stock** (the token's return in share terms, i.e. outperformance vs. holding NVDA), **Buy with SOL** so non-holders can join, a dividend-correct USD → equity engine, and equity-native curve presets (Opening Bell, Flat RWA). |
| Impact potential | Every launch creates organic xStock demand and a new DAMM v2 xStock pair: a new asset class of tokens priced relative to equities. It's also infrastructure: **`/api/presets`** serves any preset × any xStock as a ready, live-priced, dividend-adjusted DBC `ConfigParameters` (plus the TokenBadge), so other launchpads and trading terminals can plug in stock-paired launches with one HTTP call. |
| Traction / volume | **This is the gap to close.** It has to be live on mainnet with real users (plan below). |

## Day-by-day plan (do these in order)

**Day 1 (today): get it running**
1. Push the repo to GitHub (public), then deploy on Vercel. The env vars are in `.env.example`.
2. Get a free Helius RPC key and set `NEXT_PUBLIC_RPC_URL`. Set `NEXT_PUBLIC_PLATFORM_FEE_CLAIMER` to a fresh wallet.
3. Run `pnpm devnet:e2e` with 2 devnet SOL. Save the printed tx signatures, which are your proof that it works.

**Day 2: first mainnet launch**
4. Buy roughly $20 of an xStock (e.g. NVDAx) on Jupiter. You need about 0.05 SOL for fees.
5. Launch one token yourself through the UI with the Opening Bell preset and a small first buy. Screenshot it.
6. If any mainnet tx fails, copy the exact error and ask in Meteora dev support (Discord / t.me/meteora_dev). They want builders to succeed.

**Days 3–8: real traction (no fake volume)**
7. Post a build-in-public thread on X tagging @MeteoraAG, @xStocksFi, @colosseum and @SuperteamIN.
8. Get 10–30 real people to try a launch or a buy: your college crypto/blockchain club, Superteam India Discord, Robofest friends.
9. Share each live token link. Real wallets plus real volume, even small, beat any polished slide.

**Days 9–10: submission**
10. Record a 2–3 minute demo video using the script below.
11. Submit on Superteam Earn. Also check whether the Colosseum main hackathon requires its own registration for sidetracks; the listing says it's a sidetrack of that hackathon.

## Demo video script (2.5 min)

1. **0:00 Hook.** "Every launchpad prices tokens in SOL. BellCurve prices them in NVIDIA."
2. **0:15 Problem.** Narrative and RWA tokens are bets relative to equities, but they're quoted in SOL. Creators farm their own token.
3. **0:35 Launch flow.** Pick NVDAx, pick a preset, and show the live curve and the keeper-floor check. Point out that the dividend multiplier is applied.
4. **1:15 On-chain.** Show the two txs on Solscan: a config with quote = NVDAx plus TokenBadge, then the pool plus the unsnipeable first buy.
5. **1:40 Trade + earn.** Buy, sell, then the creator claims fees *in NVDAx*.
6. **2:05 Presets page.** Show the JSON export and explain that any launchpad can use these configs.
7. **2:20 Traction + ask.** Show the number of launches, wallets and volume, then the roadmap.

## Submission text (paste and edit)

**Title:** BellCurve: token launches priced in equities

**One-liner:** A Meteora DBC launchpad where every bonding curve is quoted in a tokenized stock (SPYx, NVDAx, TSLAx…), so buyers pay in stock, creators earn stock, and every graduation seeds a DAMM v2 xStock pool.

**What it does:** BellCurve creates a dedicated DBC config per launch with an xStock as the quote mint, passing the mint's DBC TokenBadge. A USD → equity curve engine converts market-cap targets into raw stock units using live Jupiter prices and each xStock's ScaledUiAmount dividend multiplier. It enforces Meteora's $750 keeper floor so every curve auto-graduates to DAMM v2. Five presets ship with it, covering the flat, exponential and long curves the track asks for: an exponential anti-snipe "Opening Bell", a near-flat "Flat RWA" curve that graduates into a compounding-liquidity DAMM v2 pool, and a two-segment "Long Curve". Each one is served by a public API (`/api/presets?id=flat-rwa&stock=NVDAx`) as a ready, live-priced DBC config that other launchpads can use directly. Anyone can buy with plain SOL (Jupiter routes SOL → xStock, then the curve buy, in one wallet approval), and the token page shows each token's return vs. just holding the stock. Creators' first buys land in the creation tx, fees are paid in stock, and 60% of graduated LP is permanently locked. Buys use DBC's PartialFill swap mode, so the graduating buy can never revert. The full lifecycle (launch → trade → claim → migrate to DAMM v2) is tested for all five presets against real mainnet program and NVDAx state.

**Links:**
- GitHub: https://github.com/ANSHSINGH5999/bellcurve
- Live app: https://bellcurve-launch.vercel.app
- Demo video: TODO
- Example mainnet token: TODO (after the first real NVDAx launch)
- Proof: README "Proof" section (devnet tx signatures) and `pnpm fork:e2e`, which runs every preset on cloned mainnet state (real DBC + DAMM v2 programs, real NVDAx mint and TokenBadges) from launch through creator fee claim to graduation into DAMM v2.

## Rules to stay safe

- Don't wash-trade or use multiple wallets to fake volume. It shows up on-chain and gets you disqualified.
- Don't promise returns when promoting tokens. Present the platform, not "gains".
- xStocks are not available to US persons. Keep the footer disclaimer.
