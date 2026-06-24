# AGENTS.md - pt-token

This directory is owned by Codex-2.

PT-specific invariants:

- PT redeems 1:1 into SY only at or after maturity.
- PT must never claim or represent floating yield; that belongs to YT.
- Keep the maturity explicit in config and storage so multi-maturity support stays additive later.
- Token transfer compatibility can evolve, but maturity semantics cannot.
