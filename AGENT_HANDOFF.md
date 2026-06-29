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

## Render demo runner account setup for Poulav

The `/demo` page should use a hosted Render Docker service for automation. Vercel
must proxy to Render. Vercel should not run the testnet commands itself.

Install and authenticate the Render CLI on Poulav's machine:

```bash
brew install render
render login
render whoami
render workspaces --output json
render workspace set <poulav-workspace-id>
render workspace current
```

Validate the checked-in Render Blueprint before creating or updating the service:

```bash
render blueprints validate ./render.yaml
```

Create or adopt the Render web service in Poulav's Render account:

1. Use the GitHub repo `https://github.com/PoulavBhowmick03/sidereal`.
2. Use branch `main`.
3. Use Docker with `Dockerfile` at repo root and build context `.`.
4. Service name should be `sidereal-demo-runner`.
5. Health check path should be `/api/health`.
6. Keep the service URL stable. The current expected URL shape is
   `https://sidereal-demo-runner.onrender.com`.

Set these Render environment variables:

```text
SIDEREAL_ENABLE_DEMO_API=1
DEPLOY_IDENTITY=sidereal-smoke
SETTLE_SECONDS=4
DEMO_RUNNER_TOKEN=<strong shared secret>
```

Generate the shared secret locally, save it in a password manager, then put the
same value in Render and Vercel:

```bash
openssl rand -base64 32
```

The runner container builds release Wasm, prebuilds
`sidereal-integration-tests --test auth_invariants`, builds the SDK and app, then
starts `pnpm --dir app exec next start` on Render's `$PORT`. On startup,
`scripts/render-demo-runner-start.sh` creates and friendbot-funds the
`sidereal-smoke` testnet identity if it does not already exist inside the
container.

Deploy and inspect with the CLI:

```bash
render services --output json
render deploys create <render-service-id> --commit main --wait --confirm --output text
render logs <render-service-id> --output text
```

Verify Render directly:

```bash
curl -sS https://sidereal-demo-runner.onrender.com/api/health
curl -i https://sidereal-demo-runner.onrender.com/api/demo
TOKEN="<same DEMO_RUNNER_TOKEN>"
curl -sS -H "authorization: Bearer $TOKEN" \
  https://sidereal-demo-runner.onrender.com/api/demo
```

Expected results:

1. `/api/health` returns `{"ok":true,"service":"sidereal-demo-runner"}`.
2. Direct `/api/demo` without the token returns `401`.
3. Direct `/api/demo` with the token returns runner status JSON.

Set these Vercel environment variables for the production frontend:

```text
DEMO_RUNNER_API_URL=https://sidereal-demo-runner.onrender.com
DEMO_RUNNER_TOKEN=<same DEMO_RUNNER_TOKEN as Render>
```

Do not set `SIDEREAL_ENABLE_DEMO_API=1` on Vercel. That flag is only for Render
or trusted local development. After setting Vercel env vars, redeploy the Vercel
app and verify:

```bash
curl -i https://sidereal-app.vercel.app/api/demo
```

That request should return `200` from Vercel because Vercel injects the bearer
token server-side when proxying to Render. If it returns `403` with "disabled in
production", Vercel is missing `DEMO_RUNNER_API_URL` or `DEMO_RUNNER_TOKEN`.

For local UI testing against Render, do not run the local Docker runner. Start
the app with the same proxy env vars:

```bash
DEMO_RUNNER_API_URL=https://sidereal-demo-runner.onrender.com \
DEMO_RUNNER_TOKEN="<same DEMO_RUNNER_TOKEN>" \
pnpm --dir app exec next dev -p 3109 -H 127.0.0.1
```

Then open `http://127.0.0.1:3109/demo`. The button should call Render through
the local Next API proxy.

## Driving your agents

Per-column prompts (codex-2 to start the critical path, then codex-1 resumes
WS-5, then the SDK/frontend WS-6) are in `docs/coordination-log.md`. The
`scripts/codex-loop.sh` and `scripts/codex-parallel.sh` helpers are now
path-portable (they derive the repo root from their own location and default the
coordination bus to `../.sidereal-bus/BUS.md`; override with `BUS_FILE=`).

Recommended next action: start the tokenization agent on M2, M3, then WS-1/2/3.
Keep `cargo test --workspace` green at every step and do not change the frozen
`StandardizedYield` / `Market` trait signatures in `contracts/shared/types`.
