# CuanSwap — Ammora on GIWA Sepolia Testnet

Minimal demo exchange + launchpad built with the **Ammora SDK 0.3.9** (auto-route · V4 · concentrated graduation) for the **Ammora Season 2 builder mission**.

Test ETH only — **$0 value, no mainnet**.

- Docs: https://ammora-docs.vercel.app/guides/partner-quickstart + https://ammora-docs.vercel.app/guides/launchpad
- SDK: `@ammora-protocol/sdk@0.3.9` (+ `viem`)
- Chain: GIWA Sepolia **91342** · slot `v4-auto-route-20260917`
- RPC: https://sepolia-rpc.giwa.io · Explorer: https://sepolia-explorer.giwa.io

## What it does

1. **Wallet** — Connect MetaMask / Rabby; the app adds/switches to GIWA Sepolia 91342. Shows ETH + WETH balances and a Wrap ETH → WETH action. Public pages work with no wallet connected.
2. **Swap** — Live quote via `AmmoraRouteClient.quoteExactIn` (read-only, no wallet needed), price + slippage (50 bps default). Swap execution builds the transaction and asks **your own wallet** to sign it — nothing is auto-sent, nothing is signed by the app. Two verified pairs ship as defaults (WETH ↔ ATT on the bonding curve, WETH ↔ LODOS on the graduated concentrated pool); any pool/model can be pasted for a custom route.
3. **Launchpad** — Lists Configs read from chain; read a Config by ID; create-token preview (Config → `createLaunch` calldata, **does NOT broadcast** — a separate explicit button sends it via your wallet); graduation progress for any curve (quote reserve ÷ migration threshold, status, Config).
4. **Token discovery** — Recent launches from `LaunchCreated` events (last 100,000 blocks), with each token's name / symbol / decimals read from chain.

## Safety rules (built in)

- **Config #6 is BLOCKED** for new launches (graduation bug — it can sell all base inventory and fail migration; it is also disabled on-chain). The app refuses it in the create flow and marks its rows.
- **The app never sends a transaction, never holds a private key or seed phrase.** Every send is built here and confirmed by the user in their own wallet (MetaMask/Rabby).
- **No secrets in the repo.** No `.env`, no keys.

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm run start    # serve the production build (default :3000)
```

Verify the live RPC paths without a browser:

```bash
npx tsx verify-live.mts
```

## Verified live against the GIWA Sepolia RPC (2026-11-19)

- Chain status: chainId 91342, head ~41,747,262, finalized head resolves.
- Quotes (via the app's own `getRouteQuote`): 0.01 WETH → **999,979.798 ATT** (dbc curve, Config #56, active) and 0.01 WETH → **142,265.951 LODOS** (concentrated pool, migrated, price impact 151 bps).
- Configs: 62 exist; #1–5, #7–10 enabled, **#6 enabled=false**; quote token WETH `0x4200…0006` on all.
- Curve state: ATT curve status 1 (active), Config #56, threshold 0.01 WETH.
- Create-launch preview: builds valid `createLaunch` calldata for Config #7 (516 bytes, value 0, 9 decimals) — no broadcast.
- DBC swap plan: builds the swap tx + WETH approval requirement — no send.
- Discovery: 15 launches in the last 100,000 blocks.
- Production build passes (`next build`, TypeScript strict) and the homepage renders (verified headless).

Known environment note: this VM's headless Chromium cannot tunnel through the egress proxy (`ERR_TUNNEL_CONNECTION_FAILED`), so in-browser RPC calls fail here. The same code paths verified live in Node (which uses the proxy correctly) and work in any normal browser / on Vercel. The public RPC also rate-limits bursts (429) — the app paces reads (600 ms) and retries quotes up to 3× with backoff.

## Still needed for deploy

- **Deploy** the production build (e.g. Vercel: `vercel --prod`, or any static Node host). No env vars needed — RPC/chain are constants.
- **Post it on X** (from @zkfomo or @CuanAgent) and **submit the website link** on https://ammora.org/waitlist#mission for review.
- **On-chain steps** (optional, for a real demo token): creating a token needs the Creator wallet (Adil's `0x8d73…69fC`, which holds GIWA Sepolia test ETH) to sign `createLaunch` in MetaMask — gas only, testnet.
