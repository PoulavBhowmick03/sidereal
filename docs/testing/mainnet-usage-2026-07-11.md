# Live mainnet usage log — 2026-07-11

Real Stellar mainnet, real USDC, real fees. Actor: the deployer/admin key
(`GDQX3RT7YJYPKCB3Z2BG3EYBRBI62DWGGZYW54U6KLVRYVUYIUUVYRG3`), which already
holds a real position from the 2026-07-10 seeding: ~5 YT and ~49,999,013 of
50,000,013 total LP (effectively sole LP). Deployed contracts and the
deployment record are in `deployments/mainnet.toml`.

Starting balances: 3.6052529 XLM, 0.3135884 USDC.

Purpose: exercise the live production integration (www.sidereal.tech, now
repointed to mainnet) with real economic actions, using the existing position
plus whatever XLM/USDC remains, and verify the live site reflects real
on-chain state. No adversarial testing here — this is normal-user usage.

## Actions log

| # | Action | Amount | Tx | Result | Balances after |
|---|--------|--------|----|--------|-----------------|
| 1 | `claim_yield` on tokenizer, existing YT position (5 YT held since 2026-07-10 seeding) | claimed 1814 base SY (preview was 1800 — accrued between preview and submit, consistent with M1's documented point-in-time behavior) | landed attempt 1, fee ~0.029 XLM | SY balance 0 → 1814; YT unchanged (50000029) | 3.5760371 XLM |
| 2 | `swap_yt_for_sy` on AMM (flash route) | 1,000,000 YT in (~2% of holdings) | landed attempt 1, exactly at quote (3619), fee ~0.056 XLM | SY 1814 → 5433; YT 50000029 → 49000029 | 3.5195837 XLM |
| 3 | `remove_liquidity` (10% of LP) | 4,999,901 LP in | landed attempt 1 | got back 4,899,904 PT + 5,099,531 SY; LP 49999013 → 44999112 | 3.5195837 XLM (fee pending log) |
| 4 | `add_liquidity` (re-add, round trip) | 4,899,904 PT + 4,899,904 SY in | landed attempt 1 | minted 4,804,173 LP; LP → 49,803,285 (~0.4% below pre-round-trip, the pool's fee) | 3.5126517 XLM |
| 5 | `deposit` (SY wrapper) — dust wrap, all remaining USDC | 3,135,884 USDC in (0.3135884 USDC, the full remaining balance) | landed attempt 1 | minted 3,135,764 SY (120-unit rounding loss, floor-rounds toward the vault — same behavior documented at the original seed); USDC → 0.0000000 | 3.5082241 XLM |

| 6 | `recombine` on tokenizer | 191,812 PT + 191,812 YT in (min(PT,YT) held — recombine requires equal amounts) | landed attempt 1 | returned 191,804 SY (tiny rounding, rate slightly above 1.0 WAD, expected) | ~3.48 XLM |

**Summary: 6/6 real mainnet actions landed on the first attempt.** Total fee
cost across all six: well under 0.15 XLM (< $0.03 at current XLM price).
Covered: yield claim (with the documented point-in-time preview drift), the
flash-swap route (historically the highest-complexity path in the system), a
full LP remove+re-add round trip, dust-level wrap rounding, and recombine.
That's six of the seven core lifecycle actions exercised live with real money
(deposit, split[implicit from prior seeding], claim, swap, LP add/remove,
recombine) — only a fresh split and a post-maturity redeem remain untested on
this mainnet deployment, both gated on time/capital, not on anything found
broken. No USDC remains for a fresh wrap+split cycle from new capital — that's
the one thing genuinely gated on the user adding more funds.

## Production site verification (post-usage, real browser)

A subagent verified server-side/on-chain state (total_lp match, bundle IDs
correct, faucet/demo blocked, no stale testnet strings) but flagged it had no
JS-executing browser, so client-rendered pages were unverified. Closed that
gap directly with Playwright against the live URL:

- **`/pool` and `/trade` render correctly, no console/page errors**, Mainnet
  badge present, hydrated data loads.
- **Chased down an apparent APY mismatch — resolved as a false alarm.** A
  first pass (blind text regex) suggested the displayed APY (7.37%) didn't
  match a fresh chain read (5.71%). Precise DOM inspection found two
  *separately and correctly labeled* numbers: "Supply APR (variable)" =
  7.37% (Blend's own live variable rate, a different data point) and
  "Implied APY" = 5.71%, which matches the chain read (`spot_apy`/`implied_apy`
  = 571 bps) exactly. The site is accurate; my first check mis-attributed the
  wrong label.
- **Confirmed live: the implied rate moved 770→571 bps as a direct, legitimate
  consequence of my own actions** (selling YT into the pool via the flash
  swap shifted the PT:SY proportion from ~50/50 at seeding to PT 48.8M / SY
  50.8M, which lowers the curve's implied rate) — not a bug or stale data.
- **M2 (the already-documented "TWAP not gated" finding) now has live
  production evidence.** My swap reset the TWAP window
  (`twap_warming_up() == true`, confirmed on-chain), and at that moment
  `/pool` and `/trade` showed "Implied APY 5.71%" with zero warming-up
  indicator anywhere on either page — the same gap findings.md already
  documented (M2, trade/pool render ungated) but now demonstrated with real
  mainnet state rather than a testnet simulation. Still unfixed; this
  session fixed M1/M4/M5 but M2 was left as accepted/deferred.

**Overall verdict:** the mainnet redeploy is functioning correctly for a real
visitor — accurate live data, correct network detection, testnet surfaces
properly inert, no errors. The one known UI gap (M2) is real and now has
fresh production evidence if it's worth fixing.
