# SCF Build Interest Form draft (Sidereal)

Drafted 2026-07-04 for human review before submission. Every claim traces to the
repo at commit `5ddf9a1` or to `deployments/testnet.toml` (deployed 2026-07-03).
House rules: no em dashes, no exclamation marks, testnet stated plainly, no
invented numbers.

Before submitting, verify:

1. `https://sidereal-app.vercel.app` loads publicly with no Vercel auth wall.
   The 2026-06-27 SCF audit found the then-current deployment gated behind
   Vercel authentication. Do not submit the URL until you have opened it in an
   incognito window.
2. The stellar.expert transaction links below still resolve (they are from the
   audit's CLI-signed run; the deployment has been redone since).
3. Team description: fill in Rahul's background and both LinkedIn URLs. I only
   know your background and that Rahul is a collaborator.
4. Build Track and Submitter type are dropdowns whose options I cannot see.
   Pick them yourself. The audit's read was that the current package fits an
   Instaward or a small Build Award, not a large one.

---

## Project Description

Sidereal brings yield tokenization to Stellar. It splits a yield-bearing
position (today, a Blend v2 USDC lending position) into two tradable Soroban
tokens: a Principal Token (PT) that redeems for its principal at maturity, and
a Yield Token (YT) that claims all the variable yield generated until then.
PT plus YT always equals the wrapped position (SY), so holders can recombine at
any time. Buying PT at a discount locks in a fixed rate; holding YT is a
leveraged position on where the variable rate goes. This is the design Pendle
proved on EVM chains, adapted natively for Soroban. Stellar has the substrate
for a fixed-income market (Blend's USDC pool, Centrifuge's tokenized
treasuries, a growing RWA base) but no layer that lets institutions hedge that
yield or lets traders express views on its direction. Sidereal is that layer.
The objective for the next phase: prove the AMM authorization tree on testnet,
add a second yield source (Centrifuge's tokenized treasuries), complete an
audit, and ship to mainnet with curated pools.

## Current Traction

Early stage: a working testnet prototype, no mainnet users or TVL yet. Built
during the Stellar Build Station Kolkata 2026 sprint. What exists today:

- Live testnet deployment (2026-07-03) of all five Soroban contracts (SY
  wrapper, PT, YT, tokenizer, AMM), wired to Blend v2's testnet USDC pool. The
  wrapper custodies deposits as a real Blend supply position and derives its
  exchange rate from the bToken position on chain. Deployment manifest with
  on-chain wasm hash verification: `deployments/testnet.toml` in the repo.
- The core lifecycle (deposit, split, claim yield, recombine, redeem) settles
  real SEP-41 tokens, covered by integration tests that reconcile balances
  against the token contracts, plus a 10,000-case economics property test and
  a CI guard that rejects float opcodes in wasm builds.
- Public repo with CI: https://github.com/PoulavBhowmick03/sidereal
- Live app on testnet: https://sidereal-app.vercel.app
- 90-second end-to-end walkthrough video in the README, including adding
  liquidity against the live Blend v2 USDC pool.
- On-chain proof of the lifecycle (CLI-signed testnet transactions for
  deposit, split, claim, recombine) linked from `docs/SCF_AUDIT.md`.

## Website

https://sidereal-app.vercel.app

(Verify it is publicly accessible first; see checklist above.)

## Planned Stellar Integration

Sidereal is built on Stellar from the ground up, not ported. All five
contracts are Soroban contracts. PT, YT, and SY are SEP-41 tokens, so they
compose with Stellar wallets and other Soroban protocols out of the box. The
SY wrapper's live custody is Blend v2 plain supply on testnet: deposits are
supplied to the Blend USDC pool and the wrapper's exchange rate is read from
its bToken position rather than set by an admin. The AMM adapts Pendle V2's
time-decaying curve in integer fixed-point math because the Soroban VM rejects
float opcodes. The SY wrapper builds on OpenZeppelin's Stellar contracts Vault
extension. Planned next: proving the AMM and YT flash-route authorization tree
on testnet without permissive mocks, adding Centrifuge's tokenized treasuries
(deJTRSY, deJAAA) as a second yield source, and a mainnet launch with curated
pools after audit.

## Team Description

[FILL: team size and Rahul's background. Draft skeleton below.]

Two developers. Poulav Bhowmick: Rust engineer with an Ethereum
consensus-client background, Ethereum Protocol Fellowship alum, now building
on Soroban. [Rahul: background here.] LinkedIn: [Poulav URL], [Rahul URL].

## Build Track / Submitter type

Dropdowns, your call. Not drafted.
