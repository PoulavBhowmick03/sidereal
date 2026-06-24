# AGENTS.md - tokenizer

This directory is owned by Codex-2.

Tokenizer-specific invariants:

- Preserve `PT + YT = SY` on every split and recombine path.
- Reject split/mint flows at or after maturity.
- Keep holder-scoped state keyed by `(holder, maturity)`, not holder alone.
- Do not add pricing or oracle reads here; pricing belongs to the AMM.
- Do not hardcode keys or deployment addresses.
