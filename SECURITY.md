# Security policy

This is testnet-only, pre-audit software. Do not deposit real funds.

## Reporting a vulnerability

Please report security issues privately. Do not open a public issue for a
vulnerability.

Use GitHub's private vulnerability reporting: go to the repository's **Security**
tab and choose **Report a vulnerability**. This opens a private advisory visible
only to the maintainers.

Include, where possible:

- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- affected contracts, SDK, or frontend paths.

We will acknowledge the report, work on a fix, and coordinate disclosure with
you. Per the project's build-in-public stance, sensitive findings stay in the
private advisory until a fix ships, not in public issues or discussions.

## Scope

In scope: the Soroban contracts under `contracts/`, the SDK under `sdk/`, and
the frontend under `app/`.

Out of scope: the testnet deployment itself, third-party dependencies (report
those upstream), and anything requiring a compromised user device or wallet.
