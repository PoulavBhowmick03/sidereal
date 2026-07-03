# BLND emission passthrough: verdict and design

This document is the implementation plan for MVP blocker 1 in
[USER_FLOW.md](./USER_FLOW.md) section 9. Pendle's SY standard forwards the
underlying protocol's incentive tokens to the yield side alongside interest
(the Pendle FAQ lists COMP and AAVE incentives as part of LP and SY returns,
https://docs.pendle.finance/pendle-v2/FAQ). Our SY wrapper captures Blend
interest but has no emission claim path, so any BLND the position earned
would be dropped.

Status legend: ☑ done · ◐ in progress · ☐ not started

---

## 1. Phase 0 verdict: no supply-side BLND on this market

☑ Checked on 2026-07-03 against the live pool
(`CCEBVD...Q44HGF`) with the deployed simulation source account:

- `get_reserve(USDC)` reports `config.index = 3` for the market's reserve
  (`CAQCFV...VSRCJU`).
- Blend v2 addresses emissions by `reserve_token_index =
  reserve_index * 2 + res_type`, where res_type 0 is the liability (dToken)
  side and 1 is the supply (bToken) side (blend-contracts-v2, pool
  emissions module).
- Scanning `get_reserve_emissions` over token indexes 0 through 7:
  - index 6 (USDC liabilities, borrowers): active, `eps = 2271682720701`,
    expiration 1783301379.
  - index 7 (USDC supply, what the SY wrapper holds): **null**.
  - indexes 2 and 5 (other reserves) are active; all remaining slots null.

Conclusion: on this testnet pool, USDC suppliers earn no BLND. The wrapper
accrues nothing to pass through, and a claim path built now could never be
exercised against this market. The MVP treats passthrough as a documented
exclusion, and the blocker resolves to the design below, to be implemented
when a target pool (mainnet, or a self-administered test pool) emits to
suppliers.

## 2. MVP action (documentation only)

☑ Record the verdict here.
☑ Re-scope the blocker entry in [USER_FLOW.md](./USER_FLOW.md) section 9 to
  "documented exclusion, design ready" and link this file.
☑ Note the exclusion in [BLEND_INTEGRATION.md](./BLEND_INTEGRATION.md):
  SY yield on this market is interest only, because the pool emits no
  supply-side BLND for USDC.

## 3. Design for when emissions exist

The goal: YT holders receive the BLND the wrapper's Blend position earns,
pro rata and only until maturity, without touching the PT+YT=SY invariant
(BLND is a separate asset and is never folded into the SY exchange rate;
pricing it would require an external oracle, which the protocol forbids).

### 3a. Contracts

- **Wrapper/adapter claim path.** A permissionless `claim_emissions`
  entrypoint on the SY wrapper (via the blend adapter) that calls the
  pool's `claim(from, reserve_token_ids, to)` with the wrapper as both
  `from` and `to`, passing the supply-side token index. BLND lands in the
  wrapper and is forwarded to the tokenizer in the same call.
- **Tokenizer reward accounting.** Mirror the existing yield-index
  mechanism: a cumulative BLND-per-YT index bumped on every sweep, a
  per-holder snapshot, and a `claim_rewards(from)` entrypoint paying the
  difference (floored, like yield payouts). Accrual stops at maturity: the
  final sweep before or at maturity fixes the index, and later sweeps
  route nothing new to YT.
- **Open decisions to settle in review:** who pokes `claim_emissions`
  (piggyback on deposit and withdraw versus explicit keeper calls), and
  whether unclaimed BLND after maturity is sweepable to the treasury or
  left claimable indefinitely.
- **Interface gate.** New entrypoints are additive, but run
  `/interface-freeze-check` and flag the extension in coordination notes
  first; contracts are claude-1 ownership per AGENTS.md section 3.

### 3b. SDK

- `getClaimableRewards(holder)` read and a `buildClaimRewards` builder;
  optionally `buildClaimEmissions` for the permissionless poke.
- Unit tests against the mocked server plus a live fixture once a pool
  with supply emissions is available.

### 3c. App

- A "Claim BLND rewards" row on the portfolio page next to the existing
  yield claim, shown only when claimable rewards are nonzero.
- A footnote on the yield choice card that the variable side includes
  protocol emissions when the pool emits them.

### 3d. Testability without mainnet

The shared testnet pool's emission config is not ours to change
(`set_emissions_config` is admin-gated). If end-to-end proof is wanted
before mainnet, deploy a self-administered Blend pool fixture on testnet,
configure supply-side emissions for its reserve, and point a staging market
at it. That is the only path to a live regression test for the claim math;
otherwise coverage stays at contract unit tests plus the SDK mock.

## 4. Verification (when implemented)

- Contract tests: emission index accrual across sweeps, pro-rata claims
  for multiple YT holders, transfer-then-claim ordering, accrual stop at
  maturity, zero-emission no-ops.
- Live (fixture pool): supply, wait for eps accrual, sweep, claim from two
  holders, reconcile BLND balances against `get_user_emissions`.
- App: portfolio row appears with a nonzero claimable amount and pays out
  on signature.
