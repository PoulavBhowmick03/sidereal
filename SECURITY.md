# Security policy

Sidereal is live on Stellar mainnet but has not had a professional
third-party audit. The contracts are immutable (no upgrade path), so a
defect would be permanent. The mainnet deployment currently holds small,
deliberately limited funds; do not treat it as audited or risk-free. See the
[README's current-status section](./README.md#current-status) for what has
and hasn't been verified.

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

Out of scope: third-party dependencies (report those upstream, e.g. Blend or
Soroban SDK issues) and anything requiring a compromised user device or
wallet. A vulnerability affecting the live mainnet deployment is very much
in scope — report it privately, not as a public issue.
