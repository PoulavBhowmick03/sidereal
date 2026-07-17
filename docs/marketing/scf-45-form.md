# SCF #45 Build Award submission draft (Open Track)

Drafted 2026-07-17, updated 2026-07-18 to target the Open Track (not the
Integration Track). Round: SCF #45 (August 16, 2026). Every repo claim traces to
`deployments/mainnet.toml`, `docs/testing/mainnet-usage-2026-07-11.md`,
`docs/research/yield-tokenization-gap-analysis.md`, or `ARCHITECTURE.md`. House
rules carried over from the interest-form draft: no em dashes, no exclamation
marks, no invented numbers, mainnet and testnet stated plainly.

Budget drafted bottom-up at **$112,275** (hours x rates, itemized per deliverable).
See the note at the end for how to move it toward $120K.

Why Open Track, not Integration: the Integration Track is list-restricted (which
forced Reflector out) and requires most budget on integration cost, which made
the factory/router/multi-market work — the actual product — read as awkwardly
classified "connective tissue." The Open Track funds building something brand-new
on Stellar, allows any Stellar integration (Reflector included), and reviews via
panel plus a community vote. Sidereal's live v1 is proof of mechanism; this grant
funds the brand-new fixed-income venue built on top.

## Pre-submission checklist (do these before pasting anything)

1. **[HARD REQUIREMENT]** Write the architecture outline the submission criteria
   demand: a "complete architecture outline showing how your system works,"
   Stellar-specific, covering the Blend expansion, DeFindex adapter, Reflector
   feed, factory, router, authorization trees, and deployment topology. Suggested
   path `docs/plans/scf45-architecture.md`, published at a public URL.
   `ARCHITECTURE.md` documents v1 only and is not this document. (Offer stands to
   draft it.)
2. **[HARD REQUIREMENT]** Open-source plan: the criteria require smart-contract
   projects to state a clear open-source plan. Confirm and state the repo licence
   (see the [CONFIRM] in the budget block).
3. **[ELIGIBILITY]** Frame consistently as "brand-new venue built on Stellar," not
   as incorporating building blocks — that is the Integration Track's language and
   the wrong signal here. The live v1 is proof of mechanism; the grant builds the
   new multi-market, multi-asset venue.
4. Decide the canonical GitHub org/repo (PoulavBhowmick03/sidereal vs sidereal-tech
   split) and use it consistently in GitHub URL, architecture link, and provenance.
   (Verified today: canonical remote is `PoulavBhowmick03/sidereal`.)
5. Record the pitch video: under 3 minutes, 16:9, YouTube or Vimeo. The README
   walkthrough is ~93 seconds but was recorded on testnet before the mainnet
   deploy. Re-record against mainnet if time allows.
6. Everything must be self-contained: the criteria say "no external materials are
   considered." All evidence (contract IDs, log summary, numbers) must be inline
   in the submission, not only linked.
7. Community vote applies on the Open Track. Line up your audience (X, live users,
   Discord) to vote during the voting window — this is a real advantage you have
   over pure-infra applicants, so plan for it.
8. Thumbnail: 16:9 image. The star-chart landing visual cropped to 1920x1080.
9. Both team members need SCF accounts before you can add them to the submission.
10. Verify the live app before submitting in an incognito window. As of 2026-07-18
    a reviewer reported `/docs` returns 404 and `/redeem` redirects to
    `/portfolio` — fix or stop referencing those routes (the traction section no
    longer claims them).
11. By August 16 the current mainnet market (matures 2026-08-09) should have
    completed its full cycle including PT redemption. If redemption goes cleanly,
    add that transaction hash to Traction. It is the strongest single line here.
12. Dates below assume work starts 2026-09-01. Shift all three tranche dates by the
    actual award announcement date. Keep each tranche within 90 days of the prior
    payment (handbook rule).

---

## Submission Information

**Project:** Sidereal

**Round:** SCF #45 (August 16, 2026)

**Build Award Track:** Open Track

**Submission Title:**
Sidereal: a fixed-income venue on Stellar — multi-market yield tokenization on Blend and DeFindex

**Project Type:** [dropdown; pick the DeFi / Financial Protocols option]

**Project URL:** https://www.sidereal.tech/

**Technical Architecture Document:**
[TODO: public link to `docs/plans/scf45-architecture.md` once written (see
checklist item 1). Interim: https://github.com/PoulavBhowmick03/sidereal/blob/main/ARCHITECTURE.md
The final doc must be a complete, Stellar-specific architecture outline covering
the Blend expansion, DeFindex adapter, Reflector feed, factory, router,
authorization trees, and deployment topology, plus the delta from today's v1.]

**GitHub URL:** https://github.com/PoulavBhowmick03/sidereal
[VERIFY against checklist item 3.]

**Video URL:** [TODO: YouTube link, under 3 min, 16:9. See checklist item 5.]

---

## Products & Services

Sidereal is yield tokenization live on Stellar mainnet. Five Soroban contracts
(SY wrapper, tokenizer, PT token, YT token, AMM) split a yield-bearing position
into a Principal Token that redeems for principal at maturity and a Yield Token
that claims the variable yield until then. Splitting and recombining conserve
value: PT plus YT reconstitute the wrapped position at any time. Buying PT at a
discount locks a fixed rate; holding YT is a view on
where the variable rate goes. PT, YT, and SY are SEP-41 tokens, so they compose
with Stellar wallets and other Soroban protocols out of the box. All trading
happens in one time-decaying AMM (Pendle V2's curve reimplemented in integer
fixed-point math, since Soroban's wasm target rejects float opcodes), with YT
routed through the same pool by a flash split/recombine inside the tokenizer.

Deployed 2026-07-10 from a clean commit with wasm hashes verified against
on-chain code (`deployments/mainnet.toml`). The current deployment is one curated
30-day USDC market: proof the mechanism works, but a single point on a curve.
This submission builds the three capabilities that turn that one market into a
continuous, multi-asset fixed-income venue on Stellar. Each consumes a Stellar
component (Blend, DeFindex, Reflector) as a yield source or price feed, but the
build is the market layer itself — the factory, the term structure, the router,
the collateral-grade PT feed — which does not exist on Stellar today.

**Capability 1: A tradeable yield curve on Blend USDC (deepens our live Blend
integration).**
Today one maturity trades against Blend. We ship a market factory and per-term
parameterization so several Blend-backed maturities trade at once. The spread
between them is a yield curve, and trading that spread is what makes Sidereal a
fixed-income market instead of a single bet.
How Stellar is used: the SY wrapper custodies deposits as a real Blend v2 supply
position and reads the exchange rate from its bToken position on chain, with no
admin rate setter. New terms are provisioned with scheduled TTL renewal so long
maturities survive state archival.

**Capability 2: One-click fixed rate and rollover (built on the Blend market via
the tokenizer).**
The sentence that sells the product, "lock X% fixed on your USDC," is three
separate actions today. We ship a router that does it in one transaction
(deposit, split, sell YT into the pool) and a guided rollover from a matured
market into its successor, so capital never sits idle between cycles.
How Stellar is used: the router composes the SY wrapper, tokenizer flash
split/recombine, and AMM in a single Soroban transaction with slippage bounds on
every leg. The YT flash route already in production proves this composition
pattern works.

**Capability 3: Fixed-rate markets on DeFindex strategies, and PT as collateral
across Stellar via Reflector.**
Two new integrations that together make PT demand structural. A new SY adapter
turns any curated DeFindex USDC vault into a tradeable fixed-income market, a
second independent yield source beyond Blend. A Reflector price feed then
publishes a trustworthy PT price so Stellar lending markets can accept PT as
collateral without reading our pool directly, the loop that turns PT from a
speculative token into a money-market asset.
How Stellar is used: the DeFindex adapter reads vault share price via
cross-contract calls under the same no-admin trust model as the Blend adapter;
Reflector feeds are consumed for adapter-rate integrity monitoring and, in
reverse, we publish PT/SY feeds through Reflector with a documented fair-price
and implied-rate read surface.

Supporting infrastructure these capabilities require: a market registry so the
SDK and app enumerate markets instead of one hardcoded address set, keeper
automation for the maturity-observation duties that rest on a human today, and an
analytics surface (implied vs realized APY, TVL, days to maturity) from the
observation data the contracts already record.

Final milestone is the mainnet launch of all three capabilities: the factory and
router live, at least two concurrent Blend maturities, the DeFindex-backed
market, and the Reflector PT feed consumable by a third-party contract, with wasm
hashes verified on chain as we did for v1.

---

## Traction Evidence

- Live on Stellar mainnet since 2026-07-10. Five Soroban contracts deployed from
  clean commit `67151f8`, wasm hashes read back from chain and verified equal to
  the built artifacts (`deployments/mainnet.toml` in the repo):
  - SY wrapper: `CCLFK26PU5GNMCUAGBBBGKVXE6GWYA2PB3RFTC7Y5HRVPPBRGWYUZKUU`
  - PT token: `CDZ2M6DWIVY6KFJSFEA5KWIDQUDEGFEDQ5XMJPITAVBYLNGFEYLBRMSX`
  - YT token: `CDJIC6JKQ7J5G3KUNRPFXQYNFWVTADCDFWHROSMCI36TVN2ATGIIYFRJ`
  - Tokenizer: `CBMB52N4XDAFRQRQ4MYGRPFUS3DDREWYY45VWWXEJSPITE5XH7DXEHBX`
  - AMM: `CDA4HVNGSQ52DCGRYQIE5JKSNWCFTH4FEANHPLWB2U32EXGP36DGZVJK`
  (stellar.expert links: https://stellar.expert/explorer/public/contract/<id>)
- Six core lifecycle actions exercised live on mainnet with real USDC against the
  Blend v2 FixedV2 USDC pool, all landing on the first attempt: yield claim, the
  YT flash-route swap (the system's highest-complexity path), a full LP
  remove-and-re-add round trip, a dust-level wrap, and recombine
  (`docs/testing/mainnet-usage-2026-07-11.md`, with per-action amounts, results,
  and fees; tx hashes resolvable from the contract IDs on stellar.expert). This
  is technical validation by the team acting as the initial LP, not external user
  traction. A fresh split from new capital and post-maturity redemption are the
  two remaining lifecycle actions, gated on time and capital rather than on any
  defect found.
- [ADD after 2026-08-09 if clean: maturity freeze and PT redemption transaction
  links, which would complete the first full market cycle on mainnet and are the
  single strongest line to add here.]
- Pre-launch validation on testnet: two persona-based test epochs (LP whale,
  yield trader across both flash routes, adversarial, token-mechanics, and a
  maturity-drill on a dedicated short market) surfaced and closed findings 1-14,
  documented in `findings.md`. A sustained multi-user concurrency epoch is queued
  but has not yet run (`findings.md`, epoch 3), so we do not claim concurrent-load
  coverage.
- Live app: https://www.sidereal.tech/ (mint, trade, pool, portfolio).
- 90-second end-to-end walkthrough video in the README (recorded on testnet
  before the mainnet deploy; mechanics unchanged).
- Public repo with CI, including a guard that rejects float opcodes in wasm
  builds and a 10,000-case economics property test. The contracts went through an
  internal audit, three remediation rounds, and live testnet validation,
  documented in `AUDIT.md` and `findings.md`; they have not had a third-party
  audit.

---

## Resubmission Feedback

[Leave blank if SCF sent no written feedback on the interest form. If they did,
answer it point by point here.]

---

## Ambassador Affiliation

[VERIFY - answer from actual involvement, e.g. Stellar Build Station Kolkata
2026. Do not overstate.]

**Thumbnail:** [TODO: 16:9, 1920x1080. Star-chart landing visual.]

**Team Members:** [Both founders need SCF accounts first.]

---

## Team Description

[Suggested edit of your existing text. Rewrite in your own voice before
submitting; verify the Colosseum track name.]

Team of two, full time.

Poulav Bhowmick, cofounder. Frontend, SDK, and integrations. Rust protocol
engineer; Ethereum Protocol Fellowship alum and ex-intern at Nethermind, with
open-source contributions across Reth, Lighthouse, Optimism's Kona, and libp2p.
Built the Sidereal app, SDK, and the Blend integration surface. Previously a 2x
founder: MidoFinance on Solana (Colosseum 2024 Green track winner
[VERIFY exact track name]) and StarkFinder on Starknet (1,000+ mainnet users,
300+ repo contributors). Grant winner from the Solana Foundation and Starknet
Foundation in 2024.
https://www.linkedin.com/in/poulavb | https://github.com/PoulavBhowmick03

Rahul Guha, cofounder. Smart contracts. Rust protocol engineer; Ethereum
Protocol Fellowship alum and ex-intern at Nethermind and Gnosis, with
contributions across Reth, Lodestar, libp2p, and Union Labs. Co-developed
Sidereal's five Soroban contracts, leading the fixed-point AMM curve and the
Blend adapter. Co-built StarkFinder, and built Blockrooms on Solana, a fully
onchain FPS game. Grant recipient from the Starknet Foundation.
https://www.linkedin.com/in/0xrguha | https://github.com/guha-rahul

Why this team on Stellar: Soroban contracts are Rust, and we are both Rust
protocol engineers. We shipped five of them to mainnet with on-chain hash
verification within four months of starting on Stellar.

---

## Deliverables & Budget

[Open Track form structure differs from the Integration Track: there is no
"which building blocks" field and no integration-list acknowledgment. Map the
content below onto the Open Track form's Products/Architecture/Deliverables
fields when you open it. The three-tranche, mainnet-final structure is the same.]

**Budget:** $112,275 in XLM
([VERIFY payout mechanics for the Open Track. The 10/20/30/40 split across
tranches #0-#3 and "professional user testing at #3" came from the Integration
Track form; the Build Award handbook describes three deliverable tranches with
the final being mainnet but did not spell out Open-Track percentages. If the
10/20/30/40 structure holds: #0 $11,227 on approval, #1 $22,455, #2 $33,683,
#3 $44,910 on mainnet launch. The per-deliverable budgets below are costs per
work tranche and sum to the total; they intentionally do not mirror the payout
percentages.])

No marketing costs are included. No audit costs are included; we understand
audit credits are provided with tranche #3 completion, and third-party audit
before scaling deposits is exactly the gap we want closed (the protocol is
currently unaudited and says so plainly in the README).

**Stellar integrations used (Open Track — not restricted to the Integration
List, but every one below is a real, named Stellar component):**
Blend v2 (expanded: live custody today, adding concurrent multi-maturity markets
via a factory), DeFindex (new: SY adapter over a curated USDC vault, a second
yield source), and Reflector (new: price feeds consumed for adapter-rate
integrity, and a published PT/SY feed so lending markets can price PT as
collateral). Stellar is load-bearing throughout, not a data-storage veneer:
SEP-41 tokens, the SAC pattern, Soroban cross-contract calls, and the wasm
float-opcode constraint all shape the design.

**Open-source plan:** all five existing contracts and every contract built under
this grant are open source in the public repo, and the SDK, the market registry,
and the integrator docs ship publicly so any Stellar team can build on the PT/YT
primitives. [CONFIRM the exact licence in the repo — the form should state it,
e.g. Apache-2.0 / MIT.]

Rates used throughout: lead contracts engineer $85/h (Rahul), integration and
frontend engineer $80/h (Poulav), contract QA support $50/h. QA/security-prep
hours are contracted to a part-time reviewer, not a third founder. Infra lines
cover RPC, indexer hosting, CI, and monitoring only.

---

### Tranche #1 Deliverables (the engine for a Blend yield curve, plus one-click fixed rate)

**D1. The multi-market engine behind the Blend yield curve (registry + factory)**
Capability shipped: turn our single hardcoded Blend market into an enumerable set
of markets, the precondition for trading a yield curve on Blend USDC. Registry
contract that lists live markets so the SDK and app read N markets instead of one
address set; factory that deploys a full PT/YT/SY/AMM series against a configured
adapter with per-term anchor parameterization
(formula in `docs/deploy/MAINNET_PARAMETERS.md`).
Completion: registry and factory deployed to testnet; two concurrent test
markets enumerable from the SDK; app market switcher functional; tests in CI.
Budget: $15,950
(contracts 110h x $85 = $9,350; SDK/frontend 70h x $80 = $5,600;
QA 20h x $50 = $1,000)

**D2. One-click fixed rate and rollover (router composing the Blend market)**
Capability shipped: "lock X% fixed on your USDC" in one transaction instead of
three, plus a guided rollover so capital never sits idle between cycles.
Single-transaction USDC to PT (deposit, split, sell YT through the pool) and
USDC to YT, plus a guided rollover flow from a matured market into its
successor. Includes adding `min_sy_out` to `recombine`, the known composability
prerequisite from our public findings ledger.
Completion: zap and rollover work end to end on testnet through the app;
slippage bounds enforced on every leg; router covered by integration tests
reconciling balances against the token contracts.
Budget: $16,050
(contracts 130h x $85 = $11,050; frontend 50h x $80 = $4,000;
QA 20h x $50 = $1,000)

**D3. Rate-integrity monitoring on Reflector feeds (Reflector integration, phase 1)**
Capability shipped: an independent, on-network reference for every market's
exchange rate, so a bad adapter read is caught instead of silently mispricing PT.
Consume Reflector feeds as an external cross-check on adapter exchange rates in
monitoring and analytics; agree the PT/SY feed spec with the Reflector team for
phase 2.
Completion: feed reads live in the analytics backend on testnet; alert fires on
divergence between adapter rate and reference beyond a threshold; feed spec
documented.
Budget: $5,400
(contracts 40h x $85 = $3,400; backend 25h x $80 = $2,000)

**Tranche #1 total: $37,400**
**Tranche #1 completion date: 23/10/2026**

---

### Tranche #2 Deliverables (the yield curve and a second yield source, live on testnet)

**D1. Fixed-rate markets on DeFindex strategies (DeFindex integration)**
Capability shipped: any curated DeFindex USDC vault becomes a tradeable
fixed-income market, a second independent yield source beyond Blend and a new
venue for DeFindex depositors to lock or trade their forward yield.
SY wrapper adapter over a curated DeFindex USDC vault: deposits custody as vault
shares via cross-contract calls, exchange rate read from the vault position,
same no-admin-rate-setter trust model as the Blend adapter. New market series
instantiated through the factory.
Completion: DeFindex-backed market live on testnet through the factory; full
lifecycle (deposit, split, trade, claim, recombine, redeem) passes the same
integration suite as the Blend market; adapter documented.
Budget: $15,450
(contracts 120h x $85 = $10,200; integration tests and UI 50h x $80 = $4,000;
QA 25h x $50 = $1,250)

**D2. The tradeable yield curve: concurrent Blend maturities (Blend integration, expanded)**
Capability shipped: multiple Blend USDC maturities trading side by side, so a
user can pick a term and a fixed rate off an actual curve. This is the feature
that makes Sidereal a fixed-income market rather than a single bet.
Second Blend USDC market at a different maturity running concurrently via the
factory, with per-term anchor parameters; term-structure UX in the app (maturity
selector, per-term implied APY).
Completion: two Blend maturities live simultaneously on testnet; both
enumerable from registry and tradeable in the app; TTL renewal ops runbook for
longer terms written and exercised.
Budget: $10,700
(contracts 60h x $85 = $5,100; frontend 70h x $80 = $5,600)

**D3. Autonomous market operations (keeper for maturity duties, supporting)**
Capability shipped: markets that run without a human at the maturity boundary,
the prerequisite for operating many markets at once instead of one.
Automate the duties that are manual today and documented as standing human
obligations in `docs/deploy/PROVENANCE.md`: pre-maturity `observe_rate`,
post-maturity `freeze_maturity_rate`, and LP TTL keepalive, across all
registered markets. `observe_rate` is already permissionless, so this is a
public keeper plus alerting, not a trust change.
Completion: keeper runs unattended against testnet markets through a full
maturity; missed-duty alerting to Discord; runbook published.
Budget: $6,100
(backend 65h x $80 = $5,200; infra $900)

**D4. The fixed-vs-floating decision screen (analytics surface, supporting)**
Capability shipped: the chart a user actually decides on, implied fixed rate
against realized floating APY over time. The fixed-vs-floating call is this
comparison, and today there is no screen for it.
Stats page from the observation and TWAP data the contracts already record:
underlying APY vs implied APY over time, TVL, pool composition, days to
maturity, per-wallet positions. Fixes the known display issue where implied APY
renders as confident during TWAP warm-up.
Completion: analytics live against testnet markets; indexer backfills from
deployment; warm-up states rendered honestly.
Budget: $6,450
(frontend 75h x $80 = $6,000; infra $450)

**Tranche #2 total: $38,700**
**Tranche #2 completion date: 04/12/2026**

---

### Tranche #3 Deliverables (mainnet launch and the collateral flywheel)

**D1. Mainnet launch of the full multi-market venue**
Capability shipped: everything above, live on mainnet with verified hashes,
turning the single v1 market into a continuous multi-asset fixed-income venue.
Deploy factory, registry, router, keeper targets, at least two concurrent Blend
markets and the DeFindex-backed market to mainnet from a clean tagged commit;
verify all wasm hashes against on-chain code and publish the manifest, as done
for v1 in `deployments/mainnet.toml`.
Completion: manifest with verified hashes public in the repo; markets live and
tradeable; first rollover from the v1 market pattern executed through the
router.
Budget: $10,650
(contracts 70h x $85 = $5,950; ops/frontend 45h x $80 = $3,600; infra $1,100)

**D2. PT as collateral across Stellar: publish PT feed via Reflector (phase 2) + integrator kit**
Capability shipped: a Stellar lending market can accept PT as collateral by
reading a Reflector-published PT price, without integrating our pool. This is the
loop that turns PT from a speculative token into a money-market asset and pulls
external demand into every Sidereal market.
PT/SY feeds listed with Reflector on mainnet; documented external oracle read
surface (fair PT price and implied rate, including defined behavior at and
after maturity); integrator documentation for listing PT as collateral, written
for Stellar lending teams.
Completion: feed live and consumable by a third-party contract on mainnet;
integrator docs published; read surface covered by tests at the maturity
boundary.
Budget: $8,650
(contracts 50h x $85 = $4,250; docs/SDK 55h x $80 = $4,400)

**D3. Admin hardening and protocol fixes from the public findings ledger**
Move the single-key admin (whose only power is the constrained reserve-index
migration) to a multisig; implement the pro-rata YT surplus accounting and the
stale-quote `remove_liquidity` UX fix from `findings.md`.
Completion: multisig admin live on mainnet; findings items closed with tests;
findings ledger updated publicly.
Budget: $8,900
(contracts 90h x $85 = $7,650; QA 25h x $50 = $1,250)

**D4. SDK v1, monitoring stack, and professional user testing support**
Versioned TypeScript SDK covering registry enumeration, router flows, and
oracle reads; production monitoring and alerting for keeper and markets; fixes
and support turnaround during the SCF professional user testing that
accompanies this tranche.
Completion: SDK published with docs and examples; monitoring dashboards live;
user-testing findings triaged and addressed or ticketed publicly.
Budget: $7,975
(SDK/frontend 80h x $80 = $6,400; infra $1,575)

**Tranche #3 total: $36,175**
**Tranche #3 completion date: 29/01/2027**

---

**Grand total: $112,275 in XLM**
(T1 $37,400 + T2 $38,700 + T3 $36,175. Hours: contracts 670h, integration and
frontend 585h split across the two founders, plus 90h contracted QA and infra
lines. The ~1,255 founder-hours over the roughly 22-week window average about 29
hours per founder per week, i.e. a substantial part-time commitment with the two
founders also running ops and the live v1 market, not a claim of full-time-only
work.)

## Note on the budget number

On the Open Track the budget is judged on whether the deliverables are feasible,
well-defined, well-scoped, and priced with a credible cost breakdown — not
against an integration-time table. This budget is built bottom-up: every line is
hours x a role rate on a named, measurable deliverable, which is the strongest
defense against an overscoping challenge and the format that comparable funded
Open/Build submissions used.

Bottom-up from hours it lands at $112,275, not $120K. If you want to reach $120K,
the honest knobs are: raise the contracts rate to $95/h (adds ~$6.7K), or add a
Soroswap routing leg so a user can enter and exit with the underlying asset in
one click (a real new capability and a real Stellar integration, ~40-60h). Do not
pad existing lines. Note the previous Integration-Track framing of this budget is
gone; there is no longer a "most budget must be on integration" constraint to
satisfy, so the factory, router, and multi-market work stand as core product
build rather than as classified "connective tissue."

## Legal Acknowledgements

Internal use only, not shown publicly. Read and check Acknowledge/Accept on
each statement in the form itself. If anything is unclear, email
legal@stellar.org with subject "SCF Legal Acknowledgements" before submitting.
