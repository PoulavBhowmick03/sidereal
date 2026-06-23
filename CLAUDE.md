# CLAUDE.md

The full instructions for working in this repo are in [`AGENTS.md`](./AGENTS.md). Read that first.

## Quick reference for Claude Code

- **Your agent assignment:** check §3 of `AGENTS.md`. Claude-1 owns the SDK, Claude-2 owns the frontend and end-to-end tests.
- **Non-negotiables:** §1 of `AGENTS.md`. Do not violate these. Internal TWAP only, PT+YT=SY invariant, code-first/deploy-second, no hardcoded keys, Apache-2.0 headers on every source file.
- **The interfaces that gate parallelism:** §3 of `AGENTS.md`. Do not write implementation code until both interface contracts are committed.
- **When stuck:** §11 of `AGENTS.md`. Check `ARCHITECTURE.md` first, then Pendle docs, then ask the human. Don't spin.

## Slash commands

Available custom commands in `.claude/commands/`:

- `/sprint-check` — runs through the sprint status checklist
- `/interface-freeze-check` — verifies the two gating interface schemas haven't drifted

## Tone

- No em dashes in committed prose (frontend copy, docs, commit messages). Use commas, parentheses, or sentence breaks.
- Plain prose in commits and PRs. No marketing voice.
- If a request conflicts with `AGENTS.md`, the request loses. Flag the conflict in your response and ask for clarification.