# Mainnet deployment parameters (verified)

Status: **parameter selection (Step 7)** — reviewed and verified against Blend's
source and live mainnet chain state on 2026-07-10. NOT a deployment. The real
manifest (`deployments/mainnet.toml`) is generated at deploy time by
`scripts/record-deploy-provenance.sh` from a clean committed revision.

This file records the verified inputs the mainnet deploy will consume (as env
vars to `scripts/deploy-testnet-resilient.sh` with `NETWORK=mainnet`, or the
mainnet deploy wrapper), plus the evidence for each so a reviewer can re-check.

## ⚠️ The V1/V2 pool trap (read this first)

Blend has **two live generations of pools on mainnet with different ABIs**, and
`blend-utils/mainnet.contracts.json` lists both under near-identical names:

| Name in Blend's registry | Address | Generation | Compatible with Sidereal? |
|---|---|---|---|
| `Fixed` | `CDVQVKOY2YSXS2IC7KN6MNASSHPAO7UN2UR2ON4OI2SKMFJNVAMDX6DP` | **V1** | ❌ NO |
| `FixedV2` | `CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD` | **V2** | ✅ YES |

Sidereal's `contracts/blend-adapter` is hard-wired to the **V2** pool interface
(it calls `get_reserve_list` and `get_reserve`, uses the unified `new_auction`,
and derives its rate from `reserve.data.b_rate` at 12-decimal `SCALAR_12`). The
V1 `Fixed` pool exposes `initialize`/`set_admin`/three separate auction fns and
**does not expose `get_reserve_list`/`get_reserve`** — pointing `initialize_blend`
at it would fail. The Blend web UI links deep into pool pages by the V1 address
in some paths, so it is easy to grab the wrong one. **Use `FixedV2`.**

(Alternative V2 pool with USDC also available: `YieldBloxV2`
`CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS` — not verified in
depth here; FixedV2 is the recommendation as the larger, more-utilized pool.)

## Verified parameter set

| Parameter | Value | How verified |
|---|---|---|
| `BLEND_POOL` | `CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD` (FixedV2) | `--help` interface identical to the testnet V2 pool Sidereal is proven against |
| Underlying USDC SAC (`BLEND_USDC` / `UNDERLYING`) | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75` | on-chain `name` = `USDC:GA5ZSEJY…`; `symbol` = `USDC` |
| `UNDERLYING_ASSET` | `USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` | issuer is Circle's canonical mainnet USDC (matches the SAC's on-chain name) |
| Reserve index | `1` (auto-derived by `initialize_blend`) | `get_reserve_list` → USDC at position 1; `get_reserve(USDC).config.index` = 1 (cross-check passes) |
| Reserve decimals | `7` | `get_reserve(USDC).config.decimals` = 7 (matches the wrapper's required `DECIMALS`; it rejects any other) |
| `b_rate` scale | 12-decimal (`1130807175328` ≈ 1.131) | matches the `SCALAR_12` the adapter cites; rate-derivation math is unchanged from testnet |
| Pool status | `1` = Active | supply gated only at `status > 3` per `blend-contracts-v2` `pool.rs::require_action_allowed`; Sidereal supplies with plain `Supply` (action_type 0) |
| Pool liquidity | `supply_cap` $1B (7dp), ~$60M supplied, 80% util, reserve `enabled: true` | `get_config` + `get_reserve` reads; pool is live and accepting supply |

## Curve parameters (carried from testnet defaults — confirm before deploy)

| Parameter | Value | Note |
|---|---|---|
| `SCALAR_ROOT` | `2000000000000000000` (2.0 WAD) | testnet default, proven |
| `INITIAL_ANCHOR` | **`1006345613662022528` (1.0063 WAD)** — for a 30-day term | see below |
| `FEE_BPS` | `10` (0.10%) | testnet default |
| `TWAP_WINDOW` | `1800` (30 min) | testnet default |
| `MATURITY` | deploy time + 30 days | your decision (first cycle = one month) |

### Anchor review (done 2026-07-10; recomputed for 30-day term)

The AMM's initial implied APY, when the pool is seeded at 50/50 proportion, is
`initial_anchor^(365 / maturity_days) − 1` (from `get_ln_implied_rate` →
`ln(exchange_rate) · IMPLIED_RATE_TIME / t`, with `exchange_rate = anchor` at
proportion 0.5). **The anchor depends on the maturity**: a shorter term compounds
the anchor over fewer days, so the same anchor implies a much higher APY. At the
chosen **30-day** maturity:

| `initial_anchor` | implied APY @ 30d |
|---|---|
| 1.02 (the 90-day value) | **~27.2%** — far too high at 30d |
| **1.0063 (recommended)** | **~8.0%** |
| 1.0056 | ~7.0% |
| 1.0068 | ~8.6% |

FixedV2's live USDC supply APY is ~7–8.6% (Blend's three-slope IR model at ~80%
utilization; the README cites ~8.6% historically). **Set `INITIAL_ANCHOR =
1006345613662022528` (1.0063 WAD, ~8%) for the 30-day term.** The seeding LP
should still sanity-check against Blend's live displayed USDC APY at deploy time.
(Some uncertainty in the exact Blend APY; 1.0063 is a defensible center, not a
precise peg.)

## Admin / key custody — decision: SINGLE admin (for now)

Decision (2026-07-10): **single admin key**, no multisig for the initial deploy.

- **Admin address (mobile wallet): `GAERXC6F4SXHT2QGNAJXBR5UQAAQ3EEBIKOSZFK4474EZQ77ZNNMIKOL`** — verified live on mainnet (226 XLM). Secret stays on the user's phone; it never signs during deploy, only holds post-deploy admin rights.
- **Transient deploy signer: `GDQX3RT7YJYPKCB3Z2BG3EYBRBI62DWGGZYW54U6KLVRYVUYIUUVYRG3`** (CLI key `sidereal-mainnet-deployer`) — funded from the mobile wallet, signs the deploys, holds no admin power. Excess XLM swept back after deploy.

Risk posture — why this is tolerable here, and where it isn't:
- The admin's only post-deploy lever on the SY wrapper is `migrate_reserve_index`,
  and it is heavily constrained: it can only re-point to the SAME underlying at a
  new valid reserve index, cross-checked against the pool (it cannot aim the rate
  at a different/more valuable asset). The wrapper rejects `set_exchange_rate`
  under Blend custody, and no contract has an upgrade entrypoint. So a compromised
  admin key cannot drain funds or reprice the vault.
- Admin surface AUDITED across all five contracts (2026-07-10): the tokenizer,
  PT, YT, and AMM gate admin auth ONLY in `initialize` (one-time) — no
  post-deploy admin functions. There is no `set_admin`, `pause`, `set_fee`, or
  `upgrade` anywhere in the system. The SY wrapper's `set_exchange_rate` is dead
  under Blend custody. So `migrate_reserve_index` is confirmed the ONLY live
  post-deploy admin lever, and it can only re-point to the same USDC reserve at
  its pool-verified index — it cannot steal, reprice, mint, or brick. Single-key
  risk is therefore effectively negligible for fund safety.
- The deployer key signs the deploy txs and needs mainnet XLM for fees; it can be
  the same key as admin under this decision. Consider migrating admin to a
  multisig later once TVL justifies the operational overhead.

## The deploy invocation these feed (for reference — do NOT run yet)

```sh
NETWORK=mainnet \
NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015" \
YIELD_SOURCE=blend \
BLEND_POOL=CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD \
BLEND_USDC=CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75 \
BLEND_USDC_ASSET="USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" \
DEPLOY_IDENTITY=sidereal-mainnet-deployer \
  bash scripts/deploy-testnet-resilient.sh
```

(The script name says "testnet" but it is network-parameterized; a mainnet
deploy should go through the provenance path in `docs/deploy/PROVENANCE.md`:
clean tagged commit → reproducible build → deploy → read-back → record manifest.)

## Still open before this set is deploy-ready

1. **Multisig admin account** created and configured (above).
2. **`INITIAL_ANCHOR`** reviewed against FixedV2's live USDC APY (optional but recommended).
3. Everything in the roadmap ahead of deploy: professional audit, keeper +
   monitoring, testnet re-validation of `67151f8` against a V2 pool, provenance
   pipeline run. See `evaluation.md` and the mainnet roadmap.
