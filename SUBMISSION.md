# BellCurve: win plan for the Meteora DBC track

**Prize pool:** 20k USDC across 5 places (10k / 5k / 3k / 1.5k / 500, per the listing). Separate discretionary infra grants go to AI/RWA DBC builders.
**Deadline:** 13 Oct 2026, 12:29 PM IST (06:59 UTC). Winners are announced 31 Oct.
**Competition:** 60+ public repos in this track and Stocklana (2 Oct). Launch studios and stock-quoted launchpads are crowded; **none of the DBC launchpads we reviewed use DLMM**, which the listing explicitly asks for.

## How the judges score, and how BellCurve answers

| Criterion | Our answer |
|---|---|
| Depth of Meteora integration | **All three Meteora liquidity products in one flow**, which the listing asks for and none of the 60+ DBC entries we reviewed do: DBC (xStock quote mint + TokenBadge, all three curve builders, fee schedulers, min-fee first buy, `swap2` PartialFill, creator fees) → DAMM v2 (graduation with locked LP, **compounding-liquidity** pools for Flat RWA, in-app trading of the successor pool) → **DLMM Conviction Pools** (commitments as limit orders). Every stage is tested on cloned mainnet state. |
| Technical execution | USD → equity engine handling the ScaledUiAmount multiplier, keeper-floor guard, and issuer-pause detection. 29 unit tests run against the SDK's own validator, plus `pnpm fork:e2e`: every preset's full lifecycle (launch → trade → claim → graduate to DAMM v2) on cloned **mainnet** state. The launch index needs no getProgramAccounts, so it runs on a free RPC. |
| Originality & taste | Built for what lasts after the meme-stock meta: **trust**. 98.9% of DBC graduations are uncontested (Litmus data), so a graduation proves nothing. Conviction Pools turn holder intent into public, enforceable DLMM limit orders ("I only sell above 3×", "I buy the dip to −30%") and score each launch on committed supply. Priced in shares, so every token also shows its **alpha vs. the stock**. |
| Impact potential | A trust primitive any launchpad can adopt: the Conviction Pool is just a DLMM pair + limit orders, and the preset API (`/api/presets`) already serves live-priced, dividend-adjusted DBC configs to other launchpads and terminals. It also gives thin new markets real depth at stated prices, Meteora's "price discovery for thinly traded names". |
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

1. **0:00 Hook.** "98.9% of Meteora DBC graduations were uncontested: no real competing buyers. A graduation proves nothing. BellCurve makes conviction verifiable."
2. **0:15 Launch.** Pick NVDAx, pick a preset, show the live curve in USD and in shares, and the keeper-floor check. Launch (2 txs) with a creator first buy.
3. **0:45 Trade.** Buy with plain SOL (Jupiter → NVDAx → curve, one approval). Show "alpha vs. NVDA".
4. **1:05 Conviction.** Open the Conviction Pool (DLMM). Creator commits a sell wall at 2×–5×; a second wallet commits support. Show the Conviction Score and the depth ladder, then the limit orders on Solscan.
5. **1:40 Graduation.** Show `pnpm fork:e2e`: every preset graduates into DAMM v2 and keeps trading in-app; the wall fills on a DLMM buy and the creator withdraws proceeds. Mention the reversed-pair test.
6. **2:05 For builders.** `/api/presets?id=flat-rwa&stock=NVDAx`: a live, dividend-adjusted DBC config any launchpad can use.
7. **2:20 Traction + ask.** Launches, wallets, committed supply on mainnet. Roadmap.

## Submission text (paste and edit)

**Title:** BellCurve: conviction you can verify, on Meteora's full stack

**One-liner:** Stock-quoted token launches on Meteora DBC that graduate into DAMM v2, with a DLMM Conviction Pool where holders publicly commit, as limit orders, to sell only above a price or to buy the dip.

**What it does:** 98.9% of DBC graduations are uncontested, so a graduation says nothing about real demand. BellCurve launches tokens on a DBC curve quoted in a tokenized stock (NVDAx, SPYx…), using a USD→stock engine that applies each xStock's ScaledUiAmount dividend multiplier and enforces Meteora's $750 keeper floor so curves auto-graduate. Graduation goes into DAMM v2 with 60% of LP permanently locked (compounding-liquidity pools for the Flat RWA preset), and the app keeps trading the successor pool in-app. Next to every launch sits a **Conviction Pool** on DLMM: holders commit sell walls ("only above 3×") and support ("buy to −30%") as DLMM limit orders, and the token page leads with the share of supply committed above market plus a live depth ladder. Anyone can buy with plain SOL via Jupiter. Five equity-native presets (flat, exponential anti-snipe, long) are served live by a public API for other launchpads. The whole flow, including the Conviction Pool and a reversed-pair edge case, is tested on cloned mainnet state with the real DBC, DAMM v2 and DLMM programs and NVDAx TokenBadges.

**Links:**
- GitHub: https://github.com/ANSHSINGH5999/bellcurve
- Live app: https://bellcurve-launch.vercel.app
- Problem data: Litmus, https://github.com/omreor/litmus (98.9% of DBC graduations uncontested)
- Demo video: TODO
- Example mainnet token: TODO (after the first real NVDAx launch)
- Proof: README "Proof" section (devnet tx signatures) and `pnpm fork:e2e`, which runs every preset on cloned mainnet state (real DBC + DAMM v2 programs, real NVDAx mint and TokenBadges) from launch through creator fee claim to graduation into DAMM v2.

## Rules to stay safe

- Don't wash-trade or use multiple wallets to fake volume. It shows up on-chain and gets you disqualified.
- Don't promise returns when promoting tokens. Present the platform, not "gains".
- xStocks are not available to US persons. Keep the footer disclaimer.
