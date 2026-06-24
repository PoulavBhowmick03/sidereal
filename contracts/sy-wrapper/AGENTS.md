# AGENTS.md - sy-wrapper

This directory is owned by Codex-2.

SY-wrapper-specific invariants:

- SY wraps one underlying and exposes the shared `StandardizedYield` interface.
- `exchange_rate` is the source of truth for yield accrual; balances do not auto-rebase.
- Deposit and redeem flows must preserve holder accounting so accrued yield stays attributable.
- No pricing logic or maturity logic belongs here beyond share accounting.
