# Agent handoff: state, audit, and next steps

Written 2026-07-03 at `main` commit `b52a533` for the next agent (Poulav) to
continue the MVP work. Read [AGENTS.md](../AGENTS.md) first; it is binding
(commit format and trailers, no em dashes in committed prose, no unsourced
numbers, PT+YT=SY invariant, internal TWAP only, SDK never signs, Apache-2.0
SPDX header on every source file). Do not commit or push without the user's
explicit go-ahead; they gate both.

## 1. Where the project is

Sidereal is a Pendle-style yield tokenization protocol on Stellar testnet:
a Blend-backed SY wrapper, a tokenizer splitting SY into PT and YT, and a
time-decay PT/SY AMM with flash-routed YT trades. The end-to-end user
journey is documented in [FLOW.md](./FLOW.md); the working tracker is
[USER_FLOW.md](./USER_FLOW.md) section 9; per-topic plans are
[LP_PAGE.md](./LP_PAGE.md) and [BLND_EMISSIONS.md](./BLND_EMISSIONS.md).

Everything is committed and pushed; the tree is clean. Both remotes
(`origin` = PoulavBhowmick03/sidereal, `rahul` = guha-rahul/sidereal) are
in sync with local `main`.

## 2. Audit of the recent work (2026-07-03)

All gates pass at `b52a533`:

- `contracts/amm` `cargo test` green, including the new post-maturity
  tests: `remove_liquidity` succeeds pro rata after maturity while
  `add_liquidity` and all four swap routes still reject with
  `MarketMatured`.
- SDK: 61 unit tests pass, typecheck clean. The new `getLpPosition` read
  mirrors the contract payout math (floor), and `getMarket` now also reads
  `total_lp` and `config` (for `feeBps`).
- App: typecheck clean, lint clean, 56 unit tests pass. The pool page
  guards the two cases the contract rejects (amount over the holder's LP,
  removing the entire pool) and keeps remove enabled after maturity while
  disabling add.
- Live read (`node scripts/live-blend-rates.mjs`) works against the market
  currently configured in `app/.env.local`.

Audit findings to be aware of:

1. **Deployment state mismatch, the top open item.** `app/.env.local`
   points at `blend-usdc-10m` (market `CCIERY...XKKO`), a short-maturity
   verification deployment that is already matured
   (`secondsToMaturity = 0`). `deployments/testnet.toml` still records the
   long-dated demo market `blend-usdc-q3` (AMM `CC6JHY...EHEJ`, maturity
   1790724044) which runs the old AMM wasm. The committed app cannot run
   against that old market: `getMarket` now requires the `total_lp` and
   `config` entrypoints, which the old wasm does not export. A fresh
   deploy, seed, and env re-point is required before the demo works again.
2. **Internal tracker copy ships to users.** The mint page header renders
   a "Blocker 3: Funded manual run" panel with internal references
   (USER_FLOW section 9, REMAINING 3b, the sidereal-smoke identity), and
   `e2e/smoke.spec.ts` asserts it. Fine as a temporary crew aid; remove it
   and its e2e assertion once the funded run is done, or move it to /demo.
3. **e2e suites were not re-run in this audit** (unit-level gates only).
   Run `scripts/check-frontend-testnet.sh` after the redeploy; note it
   exports `app/.env.local` into the test process, which the blend-gated
   tests need.

## 3. Next steps, in order

1. **Redeploy and re-seed the demo market** (closes the LP_PAGE.md 3a
   tick):
   - `scripts/deploy-testnet.sh` (or the resilient variant) with
     `YIELD_SOURCE=blend`, identity `sidereal-deployer` or
     `sidereal-smoke`; the deployer must hold the Blend testnet USDC
     reserve asset (`USDC:GATALT...5V56`).
   - Seed via `scripts/seed-demo.sh` (see USER_FLOW.md section 4 for the
     exact invocation used last time).
   - Confirm `deployments/testnet.toml` and `app/.env.local` were updated
     by the scripts and point at the same, long-dated market.
   - Verify: `node scripts/live-blend-rates.mjs` shows nonzero reserves,
     nonzero `impliedApyBps`, `twapWarmingUp: false`, and a future
     maturity; then `bash scripts/check-frontend-testnet.sh`.
2. **Funded manual run (MVP blocker 3, needs the user at a browser).**
   Testnet wallet with the Blend USDC trustline, funded from the
   `sidereal-smoke` identity's reserve balance (Circle faucet USDC is a
   different issuer and will not work). Walk the /demo checklist: supply
   on Blend, tokenize on /mint with the "Lock fixed rate" mode (four
   signatures), then add and remove a small LP position on /pool in the
   same session (LP_PAGE.md section 5). Record transaction hashes in
   USER_FLOW.md section 9 and REMAINING.md 3b, tick the boxes, and remove
   the mint-page blocker panel (finding 2 above).
3. **Docs ticks.** LP_PAGE.md 3a redeploy and 3d docs items; FLOW.md gains
   a stage note for LP once the funded run proves it.
4. **Parking lot (post-MVP, do not start without the user).** BLND
   emission passthrough is a documented exclusion with a ready design
   (BLND_EMISSIONS.md section 3; the live pool emits no supply-side BLND
   for USDC, re-check with `node scripts/check-blnd-emissions.mjs`).
   Larger Pendle-parity items (multiple maturities, rollover, limit
   orders, zaps, rate-history charts and the indexer they need) are
   consciously out of MVP scope.

## 4. Operational cheat sheet

- Diagnostics (both need a built SDK: `pnpm --filter @sidereal/sdk build`):
  `node scripts/live-blend-rates.mjs`,
  `node scripts/check-blnd-emissions.mjs`.
- Gates: `cargo test` per contract crate;
  `pnpm --filter @sidereal/sdk test`; in `app/`: `pnpm typecheck`,
  `pnpm lint`, `pnpm test`; live e2e via
  `bash scripts/check-frontend-testnet.sh`.
- stellar CLI 27 dropped `keys generate --global`; the deploy scripts
  already fall back, do not "fix" that.
- `app/.env.local` is gitignored and regenerated by deploys; never hand
  it secrets. No private keys anywhere in the repo, ever.
- Blend testnet addresses and the interest and auth model are in
  [BLEND_INTEGRATION.md](./BLEND_INTEGRATION.md). Blend rate math in the
  SDK is sourced from blend-contracts-v2; keep numbers sourced.
- The user prefers work left uncommitted for review, one logical change
  per commit when asked to commit, and repo scripts over scratch files.
