# AGENTS.md - yt-token

This directory is owned by Codex-2.

YT-specific invariants:

- YT checkpoints are keyed by `(holder, maturity)`, never holder alone.
- Claiming yield uses exchange-rate deltas; it does not auto-compound.
- YT becomes economically worthless after maturity, but unclaimed pre-maturity yield accounting must remain recoverable.
- Do not let checkpoint math move backward on a lower exchange rate.
