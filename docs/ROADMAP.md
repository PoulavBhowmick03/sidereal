# Roadmap: three-week execution plan

> **Superseded.** This was the pre-grant three-week plan. The AMM and YT
> flash-route auth work it tracks as pending is done — proven on testnet and
> now live on Stellar mainnet with real funds. See
> [`../README.md#current-status`](../README.md#current-status) and
> [`../findings.md`](../findings.md) for current status. Kept as project
> history.

Goal: land a credible real-settlement Sidereal core demo for Stellar Build
Station / Instaward review. The product is locked (yield tokenization on
Stellar). This plan is execution, not strategy.

## Week 1: Core settlement and CI

- [x] Reproduce and fix the CI failure (stale Playwright e2e specs after the
      WS-6 app-shell redesign).
- [ ] Merge the Tier 1 real-settlement core (PR #18) once CI is green.
- [x] Update README and docs to match the real-settlement code (remove the
      "internal accounting" limitation for the core lifecycle).
- [ ] Deploy Tier 1 locally / to testnet.
- [ ] Record the core lifecycle demo (deposit, split, claim, recombine, redeem).

## Week 2: Testnet hardening and SDK/frontend

- [ ] Testnet-deploy the core (SY, PT, YT, tokenizer) via
      `scripts/deploy-testnet.sh`.
- [ ] Confirm the SDK reads real PT/YT/SY balances from the token contracts.
- [ ] Confirm the frontend drives deposit, split, recombine, redeem, and claim.
- [ ] Add explorer links to the UI / demo for each transaction.
- [ ] Promote `app/e2e/flow.spec.ts` to a real run gated on
      `E2E_MARKET_DEPLOYED=1` against the seeded testnet deployment.
- [ ] Remove any remaining stale warnings from docs and UI for the core path.

## Week 3: AMM risk gate and submission package

- [ ] Verify the PT/SY AMM route on testnet without `mock_all_auths`.
- [ ] Prove or disable the YT flash route. Do not claim it works unless the real
      authorization tree is accepted on testnet.
- [ ] If unproven by the deadline, ship Tier 2 disabled / behind a clear
      experimental flag and keep the demo on the core lifecycle.
- [ ] Prepare the grant one-pager.
- [ ] Record the demo video.
- [ ] Final docs pass; assemble the Instaward / Build Station submission package.

## Tiering rule (applies all three weeks)

- Tier 1 (core, demo now): SY vault, PT/YT SEP-41 tokens, tokenizer
  split/recombine/redeem, YT yield claim, checked math, init gates.
- Tier 2 (gated): AMM custody, PT/SY swaps, YT flash route, TWAP, time decay,
  anything using `authorize_as_current_contract` or nested
  `InvokerContractAuthEntry`, anything proven only under `mock_all_auths`.

Never claim Tier 2 as production or grant ready until its auth is proven without
permissive mocks or on testnet.
