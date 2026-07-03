# LP page: letting users provide AMM liquidity

This document is the implementation plan for MVP blocker 2 in
[USER_FLOW.md](./USER_FLOW.md) section 9: the fixed rate only exists because
the AMM has depth, and today only `scripts/seed-demo.sh` (run by the
operators) can provide it. Users need a pool page to add and remove
liquidity so the pricing leg of the protocol sustains itself.

Status legend: ☑ done · ◐ in progress · ☐ not started

---

## 1. What already exists

The plumbing is nearly complete; this work is mostly frontend plus one SDK
read and one contract behavior fix.

- **AMM entrypoints** (`contracts/amm/src/lib.rs`):
  - `add_liquidity(from, pt_in, sy_in) -> lp_out` (line 314; internals at
    line 450). On a seeded pool it mints `min(lp_by_pt, lp_by_sy)` and pulls
    only the proportional `pt_used` and `sy_used`; the excess of an
    imbalanced input is never transferred. The first-seed path (integer
    sqrt, minimum-liquidity burn) exists but the deployed market is already
    seeded, so the page targets the proportional path.
  - `remove_liquidity(from, lp_in) -> (pt, sy)` (line 318): pro-rata payout,
    rejects removing the holder's excess and removing the entire pool.
  - Reads: `lp_balance(holder)` (line 203) and `total_lp()` (line 193).
- **SDK builders**: `buildAddLiquidity({ marketId, from, ptIn, syIn })` and
  `buildRemoveLiquidity({ marketId, from, lpIn })` in `sdk/src/client.ts`,
  with arg types in `sdk/src/types.ts`.
- **Market reads**: `getMarket` already returns `totalPt`, `totalSy`,
  `impliedApyBps`, and maturity, enough for pool stats and share math.
- **Operational parity**: `scripts/seed-demo.sh` performs the same deposit,
  split, add-liquidity sequence the page will guide users through.

## 2. Contract finding that gates the page

☑ **LPs are locked in at maturity.** `remove_liquidity` called
`require_live` (line 655), which panics with `MarketMatured` once
`timestamp >= maturity`. Trading correctly stops at maturity, but liquidity
removal must not: LP holders would be stranded with unredeemable pool
shares. Pendle's model is the benchmark here: at expiry an LP position is
just PT plus SY, both individually redeemable, so withdrawal stays open.

Fix landed locally: `remove_liquidity` no longer applies the maturity gate,
while `add_liquidity` and all four swap routes still reject at maturity.
Contract tests cover post-maturity remove paying pro-rata PT and SY plus the
closed add/swap paths. The frozen interfaces are untouched.

## 3. Work plan

### 3a. Contract fix (blocking, small)

☑ Remove the maturity gate from `remove_liquidity` only, per section 2.
☑ Contract tests: post-maturity remove succeeds pro rata; post-maturity
  add and all four swap routes still revert with `MarketMatured`.
☐ Redeploy to testnet via the existing deploy script and re-seed; update
  `deployments/testnet.toml` (new wasm hash) and `app/.env.local`.

### 3b. SDK read (small)

☑ `getLpPosition(holder, marketId)`: parallel simulations of
  `lp_balance(holder)` and `total_lp()`, returning
  `{ lpBalance, totalLp, shareBps, ptValue, syValue }`, where the value
  fields are the pro-rata claim on `totalPt`/`totalSy` from `getMarket`
  math (same rounding as the contract: down on payouts).
☑ Unit tests against the mocked server cover the read and pro-rata math.
  A live regression remains part of the redeploy/funded verification pass.

### 3c. App page (the bulk)

☑ New route `app/app/(app)/pool/page.tsx` plus a "Pool" tab in
  `components/AppTabs.tsx`, following the mint page's layout grammar
  (form column plus stats rail).
- **Stats rail**: PT and SY reserves, total LP, fee bps, implied APY,
  maturity badge; reuses `YieldSourceCard` patterns and `useMarket`.
- **Position card**: the holder's LP balance, pool share, and its current
  pro-rata PT/SY value, from the new `getLpPosition` read, refreshed on
  transaction completion like `usePosition`.
- **Add liquidity form**: PT and SY amount fields with balance maxes
  (`getTokenBalance` on both tokens). Preview mirrors the contract's min
  ratio: show `lp_out`, the actual `pt_used`/`sy_used`, and which side is
  the limiting one, so imbalanced inputs are explained rather than
  surprising ("only the proportional amounts are pulled"). One signature
  via the existing `submit` flow.
- **Remove liquidity form**: LP amount with max, preview of pro-rata PT
  and SY out. One signature. Post-maturity the page keeps remove enabled
  and disables add, mirroring the contract after 3a.
- **Sourcing note on the page**: PT comes from splitting on mint;
  cross-link the mint page's deposit-plus-split mode.
☑ Preview math lives in a pure module (`app/lib/lpPreview.ts`) so it unit
  tests without a DOM, per the repo's established pattern
  (`app/lib/yieldChoice.ts`, `app/lib/tokenizeSteps.ts`).

### 3d. Tests and docs

☑ Unit: `app/tests/lpPreview.test.ts` covering the min-ratio preview,
  rounding direction, limiting-side detection, and degenerate states
  (empty pool, zero inputs).
☑ e2e: pool page renders with stats and both forms, actions gate on wallet
  connection ("Connect wallet to add liquidity"), nav reaches the tab.
  Follows `e2e/smoke.spec.ts` conventions; no wallet required.
☑ `scripts/live-blend-rates.mjs`: print `total_lp` alongside the existing
  market state so seeding and user LP activity are visible in diagnostics.
◐ Docs: tick blocker 2 in [USER_FLOW.md](./USER_FLOW.md) section 9, add a
  stage note to [FLOW.md](./FLOW.md) (LP as the third thing a user can do
  with PT plus SY), and record the redeploy in
  [BLEND_INTEGRATION.md](./BLEND_INTEGRATION.md) if the wasm hash changes.

## 4. Order and commits

1. `fix(amm): allow liquidity removal after maturity` (contract + tests).
2. Redeploy and re-seed testnet (operational; state files updated).
3. `feat(sdk): read LP positions` (read + tests).
4. `feat(app): pool page for adding and removing liquidity` (page, nav,
   preview module, unit and e2e tests).
5. Docs tick in a final small commit.

Each commit lands with the standard gates green: contract tests, SDK unit
tests, app typecheck, lint, unit tests, and the live e2e suites. Nothing is
committed without the user's explicit go-ahead.

## 5. Verification

- Contract: `cargo test` in `contracts/amm` including the new
  post-maturity remove tests.
- Live: after redeploy and re-seed, `scripts/live-blend-rates.mjs` shows
  the seeded reserves and nonzero `total_lp`; an add-liquidity transaction
  from a funded test identity increases `total_lp` and the position read
  reflects it; a remove returns pro-rata PT and SY.
- App: pool page shows live reserves without a wallet; with the funded
  browser wallet (MVP blocker 3's session), add then remove a small LP
  position end to end.
