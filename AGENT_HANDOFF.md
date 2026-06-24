# Agent handoff

You (and your coding agents) are taking over sidereal: a Pendle-style yield
tokenization protocol on Stellar/Soroban. This file is the single starting point.
Read it, then `AGENTS.md`, then the two roadmap docs below.

## Read these first, in order

1. `AGENTS.md` — the source of truth: non-negotiables (§1), agent column
   assignments (§3), and the frozen interfaces that gate parallel work.
2. `docs/REMAINING.md` — the settlement migration plan (WS-1..WS-6) to take the
   protocol from internal accounting to real on-chain token custody.
3. `docs/audit/2026-06-pre-testnet.md` — the security audit, and
   `docs/audit/REMEDIATION.md` — the testnet gate checklist.
4. `docs/coordination-log.md` — frozen snapshot of the prior multi-agent bus
   (history/context for how decisions were made).

## Where things stand (handoff point)

The MVP is built, integrated, and on `main`, green: ~94 tests (contracts, a
cross-contract integration suite, SDK, app unit, Playwright e2e). It mints,
splits, recombines, redeems, quotes, and renders end to end.

**Two things are in flight:**

1. **Audit remediation.** A pre-testnet audit found 2 HIGH, 4 MEDIUM, 2 LOW.
   Status on `main` (see `docs/audit/REMEDIATION.md`):
   - Fixed (AMM column, each with a regression test): H1 (LP ownership), H2
     (TWAP same-ledger), M1 (exact-in accounting), M4 (float bounds), and the
     AMM half of L2 (TTL policy). The AMM author completed its entire column.
   - **Open and gating testnet: M2** (SY methods run before init) and **M3**
     (unchecked i128 math) — both owned by the tokenization column (codex-2),
     **not yet started**.
   - Recommended, not blocking: L1, and the tokenization half of L2.
2. **Settlement migration (`docs/REMAINING.md`).** The contracts currently use
   internal accounting (no real SEP-41 transfers between contracts). WS-4 (AMM
   real PT/SY custody) is open in **PR #15 (`feat/ws4-amm-custody`), not merged**
   — it depends on WS-1 (SY vault) + WS-2 (PT/YT SEP-41) + WS-3 (tokenizer
   custody), which are the tokenization column's work and not started. The AMM
   author (codex-1) stopped here, blocked on those.

**Net: the critical path is the tokenization column (codex-2): M2, M3, then
WS-1/WS-2/WS-3.** Once those land, the AMM's WS-4 (PR #15) can settle and WS-5
(YT flash route) becomes unblocked.

## Column ownership (from AGENTS.md §3)

| Column | Owns | Open work |
|---|---|---|
| AMM (codex-1) | `contracts/amm`, `contracts/shared/math` | WS-4 in PR #15; WS-5 after tokenization |
| Tokenization (codex-2) | `contracts/sy-wrapper`, `contracts/tokenizer`, `contracts/pt-token`, `contracts/yt-token` | M2, M3, WS-1, WS-2, WS-3 (critical path) |
| SDK (claude-1) | `sdk/` | WS-6 SDK plumbing (after settlement) |
| Frontend + e2e (claude-2) | `app/`, `tests/e2e` | WS-6 UI plumbing, deploy/seed script updates |

## How to run it

```bash
make install   # pnpm workspace deps
make test      # all suites: cargo test --workspace, SDK, app
make build     # wasm contracts + SDK + production app build
make dev       # frontend dev server
```

Prereqs: Rust + `rustup target add wasm32v1-none`, Node 20+, pnpm, and (for
deploy) `stellar-cli`.

## Deploying to testnet

The contracts are **not yet ready** for testnet: the audit gate (M2, M3) must be
green first (see `docs/audit/REMEDIATION.md`). The owner decided the deployer
runs `make deploy` locally so they hold the admin key.

```bash
make deploy   # builds wasm, generates + Friendbot-funds a deployer identity,
              # deploys SY/PT/YT/tokenizer/AMM, writes app/.env.local
make seed     # seeds the market so the UI shows live numbers
```

No private key or XLM to supply — `make deploy` self-funds via Friendbot. The
deployer key becomes the contracts' admin (it drives the demo yield knob,
`set_exchange_rate`). For mainnet later, see `docs/REMAINING.md` and the
hardening notes (admin → multisig — free on Stellar, just pass a multisig
account as admin — and make the SY rate trustless).

## Frontend deploy (Vercel)

Set the Vercel project Root Directory to `app`; it reads `app/vercel.json` and
builds the SDK then the app. Env vars are all public `NEXT_PUBLIC_*` (see
`app/.env.example`); the five contract addresses come from `make deploy`.

## Driving your agents

Per-column prompts (codex-2 to start the critical path, then codex-1 resumes
WS-5, then the SDK/frontend WS-6) are in `docs/coordination-log.md`. The
`scripts/codex-loop.sh` and `scripts/codex-parallel.sh` helpers are now
path-portable (they derive the repo root from their own location and default the
coordination bus to `../.sidereal-bus/BUS.md`; override with `BUS_FILE=`).

Recommended next action: start the tokenization agent on M2, M3, then WS-1/2/3.
Keep `cargo test --workspace` green at every step and do not change the frozen
`StandardizedYield` / `Market` trait signatures in `contracts/shared/types`.
