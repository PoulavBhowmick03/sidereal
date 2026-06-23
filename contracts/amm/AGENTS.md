# AGENTS.md - amm

This directory is owned by Codex-1.

AMM-specific invariants:

- PT must converge toward 1 SY as maturity approaches; never add pricing that ignores time-to-maturity.
- The pricing path and TWAP are internal. Do not read external oracles for PT pricing.
- YT routes stay flash-routed through the PT/SY pool. Do not introduce a separate YT pool.
- Property tests are mandatory once swap math is fully wired.
- Prefer Pendle's math model over ad hoc AMM heuristics, then adapt it to idiomatic Soroban Rust.
