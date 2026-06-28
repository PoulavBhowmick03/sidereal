# Sidereal SCF Readiness Audit

Audit date: 2026-06-27. Audited revision: `939233510b376bd174632d829d6770bf446dd4e7` on `main`. Testnet source revision: `cdf9b3e9fb6c6a7eba9db16071c67be19955b413`.

## Section 1: Executive verdict

Sidereal is not submittable to SCF today. The repository contains substantially more real protocol work than the prior audit found: the tokenizer now transfers real SEP-41 assets, YT claims transfer SY, the core accounting defects were repaired, integer AMM math is committed, and five application contracts on testnet match local release artifacts built from committed source. The submission still fails the first reviewer test. The hosted frontend redirects to Vercel authentication, the AMM has zero liquidity, the frontend has no claim or SY unwrap action, the live mock exchange rate creates more aggregate SY redemption liability than the vault holds, and the only full browser journey is skipped. A reviewer cannot use the product promised by the README.

The current package is below Instaward quality and far below Build Award quality. If submitted unchanged, estimated odds are below 10 percent for a Build Award and 20 to 30 percent for an Instaward. Those are audit estimates, not SCF statistics. After a public, source-linked Tier 1 demo and honest documentation, Sidereal could make a defensible Instaward application or a small Build Award request in the $25K to $45K range. A large Build Award above $75K is not credible without a real Stellar yield integration, public usage evidence, and a proven AMM path. The official SCF program currently describes Build Awards as grants up to $150K, while Instawards are the smaller accelerated local route ([SCF awards](https://communityfund.stellar.org/awards), [SCF overview](https://communityfund.stellar.org/)).

An honest Instaward package is about 6 to 8 single-developer engineering-days away. A credible small Build Award package is about 14 to 18 engineering-days away if one real yield-source integration fits within 5 to 8 days. The three-week target is possible only if the team treats the Tier 1 lifecycle as the submission product, gates or cuts YT flash trading, and runs public proof work in parallel with contract work.

| Dimension | Score | Evidence-based justification |
|---|---:|---|
| 1. Does it work today? | 3/10 | Core contracts exist on testnet, but the public URL is gated, claim and unwrap are absent from the UI, and every AMM route is unusable with zero reserves. |
| 2. Is the demo real? | 4/10 | Settlement and a CLI lifecycle through recombine are real, but there is no accessible browser demo, no final redemption trace, and the live mock rate is not backed by yield. |
| 3. Are protocol economics correct? | 4/10 | PT/YT conservation and YT payout logic are repaired, but the live SY vault is undercollateralized at its configured rate and AMM validation does not execute the Wasm artifact. |
| 4. Is the codebase reviewable? | 5/10 | Audit and progress records are useful, but README, architecture, settlement, demo, remaining-work, and provenance documents disagree with code or live state. |
| 5. Is it differentiated? | 5/10 | One PT/SY pool, YT flash routing, and internal rate discovery are specific, but no live result yet distinguishes the implementation from a Pendle adaptation. |
| 6. Is it composable? | 2/10 | It uses Stellar contracts and wallet tooling, but has no Blend, DeFindex, Aquarius, anchor, or OpenZeppelin vault integration. |
| 7. Is team traction credible? | 3/10 | The sprint has 133 commits and green CI, but no PR reviews, issues, discussions, stars, forks, or verifiable partner activity. |
| 8. Is the SCF narrative defensible? | 5/10 | Fixed-income infrastructure is a plausible funded lane, but the present pitch outruns its mock yield source and inaccessible demo. |
| 9. Is scope honest? | 5/10 | The README labels the mock source and experimental AMM, but also claims UI flows and redemption behavior that are not shipped. |
| 10. Is security posture appropriate? | 5/10 | Checked math, TTL handling, auth pinning, and a disclosure policy exist, but strict flash auth is ignored and admin custody is undocumented. |
| **Total** | **41/100** | **Technically credible prototype, not yet a reviewer-verifiable product.** |

## Section 2: What works (be brief, this is not the focus)

- The prior audit's central PT/YT economics defect is fixed. `contracts/tokenizer/src/lib.rs:179-290` transfers real SY, mints equal PT/YT face value, caps principal redemption, and pays YT claims in SY. `contracts/yt-token/src/lib.rs:113-154` computes and consumes holder accrual checkpoints.
- The integer AMM path is committed. `contracts/amm/src/lib.rs:1217-1332` implements fixed-point logarithm and exponential operations without floating-point opcodes. CI compiles every contract to Wasm and runs `scripts/check-wasm-floats.sh` in `.github/workflows/ci.yml:31-45`.
- Testnet provenance is recoverable and good for the current primary deployment. All five deployed contract hashes match the hashes in `deployments/testnet.toml:8-22` and the local release artifacts. No contract or Cargo source changed between source revision `cdf9b3e` and audited HEAD. Successful testnet transactions record deposit, split, rate bump, claim, and recombine at `deployments/testnet.toml:31-42`. This resolves the prior audit's uncommitted-AMM-artifact finding for the new deployment, although the manifest remains untracked.
- The local validation baseline is green: 79 Rust tests passed, 1 strict-auth test was ignored, 33 SDK tests passed, 16 frontend unit tests passed, and 14 browser smoke tests passed with 2 full-flow variants skipped.
- The core contracts move real Stellar assets. `contracts/sy-wrapper/src/lib.rs:309-383` transfers underlying on deposit and redemption. `contracts/tokenizer/src/lib.rs:179-290` escrows and transfers SY rather than maintaining a fake balance ledger.
- Security intent is visible. `SECURITY.md:1-30` provides a disclosure path. Tokenizer nested auth is argument-pinned in `contracts/tokenizer/src/lib.rs:432-469`. Checked arithmetic and explicit insolvency checks are used in core payout paths.
- Public history shows concentrated execution rather than an abandoned prototype. The repository recorded 133 commits across five calendar days, with current CI green.

## Section 3: What doesn't work (the meat)

### Finding 3.1: No complete user journey is available

- **Dimension**: 1. Does it work today?
- **Current score**: 3/10
- **What's wrong**: The production Vercel deployment at `sidereal-8efr13309-poulavbhowmick03s-projects.vercel.app` returns a redirect to Vercel authentication, so an SCF reviewer cannot open it. Locally, the app reads the live contracts, but a fresh no-wallet session shows static marketing rather than live market state. Wallet-connected balance rendering was not verifiable because the public app is gated and the browser test has no injected signer. `app/components/AppTabs.tsx:8-12` exposes only Mint, Trade, and Redeem. There is no claim action, and `app/components/PositionCard.tsx:17-32` only displays claimable yield. There is no SY-to-underlying action. `app/e2e/flow.spec.ts:5-20` skips the only nominal full flow unless `E2E_MARKET_DEPLOYED=1`, and it still contains a wallet-modal TODO. CI does not set that variable in `.github/workflows/ci.yml:79-96`.
- **What "fundable" looks like**: One public URL. One funded testnet wallet. A reviewer can deposit, split, observe a backed rate increase, claim, recombine, and unwrap SY. Each confirmed action links to Stellar Expert or Stellar Lab. The AMM is either demonstrably usable or clearly hidden and labeled as the next milestone.
- **Why this matters for SCF**: A reviewer has 30 minutes. A login wall or missing action ends the review before contract quality matters.
- **Work required**: Make the deployment public, add claim and unwrap actions, correct transaction previews, deploy a short-maturity demo market, and record a real-wallet explorer-linked trace. Estimate 3 to 4 engineering-days.

Current live-flow status:

| Flow | Status on testnet now | Evidence |
|---|---|---|
| Deposit underlying and mint SY | Works through the CLI signer | Successful transaction [`d903...3abc`](https://stellar.expert/explorer/testnet/tx/d9037736aae1e26e83dd9a6fdee4564f93fde387fb8af05c4d544fad6a8d3abc) invokes `deposit`. The public browser path is not verified. |
| Split SY into PT and YT | Works through the CLI signer | Successful transaction [`b5fc...f4e`](https://stellar.expert/explorer/testnet/tx/b5fcd398e32edb153b7ea630436a29ed1d5adc938bfd0a397a25909b952e4f4e) invokes `split`. |
| Claim yield | Contract transaction works, product action absent | Successful transaction [`e93b...97f2`](https://stellar.expert/explorer/testnet/tx/e93b198f63428926ed49fd159a0027b5fac668b778fe3074d04c0f8897cb97f2) invokes `claim_yield`. The frontend exposes no claim button. |
| Recombine PT and YT | Works through the CLI signer | Successful transaction [`5b03...aaa5`](https://stellar.expert/explorer/testnet/tx/5b03c01f821e6eb34985a6ea7f69fb554637459d6632096d0c2ed5517a5caaa5) invokes `recombine`. Current PT and YT supplies are zero. |
| Redeem PT at maturity | Not demonstrated | The primary market matures around 2026-09-25. A short-market split is linked at `deployments/testnet.toml:44-51`, but no redemption transaction is recorded and the listed PT address does not resolve on testnet. The UI returns SY, not final underlying. |
| Swap PT for SY | Fails now | AMM PT and SY reserves are zero. Live quote returns `MarketNotSeeded`. |
| Swap SY for PT | Fails now | AMM PT and SY reserves are zero. |
| Swap SY for YT | Fails now and auth is unproven | Pool is empty. Strict nested auth coverage is ignored. |
| Swap YT for SY | Fails now and auth is unproven | Pool is empty. Strict nested auth coverage is ignored. |
| Add liquidity | Not attempted through the product | Contract and SDK path exist. No liquidity UI or explorer proof exists. |
| Remove liquidity | Not attempted through the product | Contract and SDK path exist. No LP supply exists. |

### Finding 3.2: The demo is chain-backed but not economically real

- **Dimension**: 2. Is the demo real?
- **Current score**: 4/10
- **What's wrong**: Contract actions use real SEP-41 transfers, which is a material improvement over fake accounting. Successful CLI-signed transactions prove deposit, split, rate bump, claim, and recombine. The yield source is still an admin-set number in `contracts/sy-wrapper/src/lib.rs:88-101`. The deployed rate is 1.1, total SY supply is `100,000,000`, and the vault holds `100,000,000` underlying units. Aggregate redemption liability is therefore `110,000,000` underlying units. The demo rate has created an unfunded liability of `10,000,000` base units. The UI supplies no explorer links. The manifest has no PT maturity-redemption or final SY unwrap transaction, and its short-market PT address at `deployments/testnet.toml:46-51` does not resolve. `app/components/DeploymentBanner.tsx:13-24` treats configured addresses as proof of deployment without checking contract health.
- **What "fundable" looks like**: For a mock-source demo, every rate increase is paired with an actual transfer of underlying into the wrapper before claims or redemption. The UI labels the source as simulated. Balances shown in the UI are read from chain, actions link to confirmed transactions, and the public demo has a resettable funded market.
- **Why this matters for SCF**: A reviewer who calculates the liability will conclude that the visual yield is fabricated and the vault cannot honor all users. That resembles the fake-demo failure mode the submission must avoid.
- **Work required**: Add a backed-yield seeding step, publish the full flow with explorer links, surface RPC errors instead of converting every failure to "no market" in `app/lib/sdk.ts:19-32`, and add deployment health checks. Estimate 1 to 1.5 engineering-days, excluding a real external integration.

### Finding 3.3: Core token economics are repaired, system economics are not proven

- **Dimension**: 3. Is the protocol economics actually correct?
- **Current score**: 4/10
- **What's wrong**: The prior defect where PT captured yield and YT paid nothing is resolved in `contracts/tokenizer/src/lib.rs:237-290`. The remaining problem is one layer lower. `contracts/sy-wrapper/src/lib.rs:88-101` lets the admin raise redemption liability without depositing the corresponding underlying. The tokenizer's `check_solvency` at `contracts/tokenizer/src/lib.rs:398-419` protects principal PT claims, not aggregate wrapper solvency. The 10,000-case AMM property test at `contracts/amm/src/lib.rs:2097-2172` uses a small in-memory split/recombine model and native contract clients. The 10,000-step economics trace at `tests/integration/tests/economics.rs:439-556` is one deterministic LCG trace, not 10,000 independent randomized traces. Both run the integer implementation natively, not the compiled Wasm. There is no remaining native `f64` pricing path in the audited source. No test compares the fixed-point `ln` and `exp` results against a high-precision reference even though `ARCHITECTURE.md:298-303` says that validation exists.

Validation record at audited HEAD:

| Suite | Result | What it actually proves |
|---|---:|---|
| Rust workspace | 79 passed, 1 ignored | Native contract logic and integration harnesses. Contract fixtures use permissive auth mocks. |
| AMM proptest | 10,000 cases passed | Native integer AMM actions plus a small in-memory PT/YT position model. Not Wasm execution. |
| Economics trace | 10,000 steps passed | One deterministic native trace with real test-contract balances under `mock_all_auths`. |
| Strict flash auth | 1 ignored | The exact user-only nested auth tree remains unproven. |
| SDK | 33 passed | Encoding, builders, and client behavior against mocked RPC and Stellar SDK objects. |
| Frontend unit/build | 16 passed, build passed | Component and application behavior without a wallet or live transaction. |
| Playwright | 14 passed, 2 skipped | Local smoke navigation. Both full-flow variants are skipped. |
- **What "fundable" looks like**: The submission can remain testnet-only, but the demo vault must be solvent at every rate. The integer pricing path must have reference-vector, monotonicity, maturity-boundary, and conservation tests. At least one test harness must execute the compiled Wasm or test the exact exported artifact used on testnet.
- **Why this matters for SCF**: Yield tokenization is an accounting product. A reviewer will not separate a correct tokenizer from an insolvent wrapper. The first failed full redemption invalidates the economic claim.
- **Work required**: Enforce or operationally guarantee backing before rate increases, add vault-wide solvency assertions, add precision and boundary vectors, and add a Wasm-level scenario. Estimate 2 to 3 engineering-days for mock-source correctness. A real yield adapter is separate.

### Finding 3.4: The documentation tells multiple incompatible stories

- **Dimension**: 4. Is the codebase reviewable?
- **Current score**: 5/10
- **What's wrong**: `README.md:16` correctly says the rate is mocked, but `README.md:46-47` says claim is built in the frontend when no claim action exists. `README.md:50` calls one deterministic 10,000-step trace a property test. `README.md:52` and `README.md:168-170` say testnet deployment is pending even though a verified deployment exists. `README.md:159` says maturity redemption returns underlying, while the tokenizer returns SY and the UI does not unwrap it. `ARCHITECTURE.md:23-45` presents an OpenZeppelin vault and Blend source that are absent from dependencies and code. `ARCHITECTURE.md:237-239` describes a `zap_out_at_maturity` path that does not exist. `ARCHITECTURE.md:298-303` claims Blend rate reads, reference precision checks, and comprehensive auth-revert tests that do not exist. `docs/SETTLEMENT.md:40-60` still describes the old claim and redemption model. `docs/PROVENANCE.md:24-58` documents only the superseded deployment with an uncommitted AMM artifact. `docs/REMAINING.md:100-112` leaves the entire testnet checklist unchecked.
- **What "fundable" looks like**: README is a verified current-state index. Architecture clearly labels target design versus implementation. Settlement describes asset units and both redemption steps. Provenance identifies every live contract, source revision, artifact hash, initialization transaction, admin address, maturity, and known limitation.
- **Why this matters for SCF**: Conflicting documents force a reviewer to assume the strongest claims are marketing rather than mistakes. Reviewability directly affects trust in a security-sensitive protocol.
- **Work required**: Perform one truth pass across README, ARCHITECTURE, SETTLEMENT, DEMO, REMAINING, SDK README, and PROVENANCE. Estimate 0.75 to 1 engineering-day.

### Finding 3.5: Differentiation is designed, not demonstrated

- **Dimension**: 5. Is it differentiated from prior funded work?
- **Current score**: 5/10
- **What's wrong**: The strongest design distinction is one PT/SY liquidity pool that derives YT routes through atomic composition, plus an internal time-sensitive implied-rate history. That is concrete in `contracts/amm/src/lib.rs`, not merely a slogan. It is not demonstrated on testnet. The repository does not quantify why this structure is useful for Stellar's liquidity profile, compare capital needs with two-pool designs, or show a composable consumer of the TWAP. The landing page at `app/app/(marketing)/page.tsx:8-38` reduces the proposition to fixed yield and yield trading, which reads as "Pendle on Stellar." The official SCF #43 round also contains a $90K "Decentralized Yield Derivatives Engine" submission that failed panel review, evidence that the category alone is not differentiating ([SCF #43 round](https://communityfund.stellar.org/awards/reciQ16Y1ztmnmE3N)).
- **What "fundable" looks like**: The submission shows one Stellar-specific result: a real yield-bearing Stellar asset split into transferable fixed and variable claims, or a measured single-pool demo proving useful liquidity behavior under Soroban constraints. It explains overlap and non-overlap with XCCY, lending markets, and vault aggregators in one factual table.
- **Why this matters for SCF**: Without a live result, reviewers can classify Sidereal as a derivative port and fund an integration closer to existing Stellar usage instead.
- **Work required**: Write a competitor and ecosystem comparison, expose one quantitative single-pool result, and connect it to a live integration or public testnet trace. Estimate 1 day for evidence and framing, after the demo works.

### Finding 3.6: No existing Stellar yield or liquidity primitive is integrated

- **Dimension**: 6. Is it composable with the Stellar ecosystem?
- **Current score**: 2/10
- **What's wrong**: The underlying is a locally deployed Stellar Asset Contract, not Blend USDC, a Blend pool position, or a DeFindex vault share. The rate is set by the wrapper admin. There is no OpenZeppelin `stellar-tokens` dependency despite the architecture claim. No contract calls Blend, DeFindex, Aquarius, RedStone, or an anchor. Wallet and Soroban RPC integration prove platform use, not ecosystem composability.
- **What "fundable" looks like**: For a small Build Award, one testnet integration deposits into or wraps a real yield-bearing Stellar primitive, reads value from that primitive, and demonstrates claim and redemption. For an Instaward, a mock source is acceptable only when labeled as a prototype and the external adapter is the funded milestone with a named interface and partner validation.
- **Why this matters for SCF**: The fund is designed to grow Stellar usage. A sealed-box tokenizer does not yet route TVL, extend an existing protocol, or create credible demand for ecosystem assets.
- **Work required**: Choose one first integration. A DeFindex share adapter is estimated at 5 to 8 engineering-days. A direct Blend adapter is estimated at 8 to 12 days because it adds lending-pool semantics and operational risk. These estimates require confirmation after reading the selected protocol's current interfaces.

### Finding 3.7: Development velocity is visible, external traction is not

- **Dimension**: 7. Is the team's traction credible?
- **Current score**: 3/10
- **What's wrong**: The [public repository](https://github.com/PoulavBhowmick03/sidereal) was created on 2026-06-23 and has 133 commits over five days. About 75 percent of commit subjects match conventional-commit prefixes. Current CI is green. The repository has 21 PRs, but GitHub reports no reviews on them. It has zero issues, zero discussions, zero stars, and zero forks. Recent traffic shows 29 views from 4 unique visitors. README claims Build Station Kolkata context at `README.md:199`, but the repository provides no verifiable event, forum, partner, or user evidence.
- **What "fundable" looks like**: A small project does not need large user numbers. It needs credible external contact: reviewed PRs, public design questions, a Build Station artifact, feedback from one ecosystem protocol team, and a few independent testnet users with transaction evidence.
- **Why this matters for SCF**: A five-day code burst with no review or public engagement looks grant-driven. Reviewers cannot infer that the team can recruit integrators or maintain the protocol after an award.
- **Work required**: Publish a technical update, move real design questions into issues or discussions, obtain one external code or protocol review, run a testnet session with independent users, and document partner conversations without inventing endorsements. Human effort 2 to 3 days spread across the sprint. Contract work can continue in parallel.

### Finding 3.8: The fundable lane exists, but the current evidence is too thin

- **Dimension**: 8. Is the SCF narrative defensible?
- **Current score**: 5/10
- **What's wrong**: Yield tokenization can fit DeFi infrastructure and RWA yield management. The architecture gives a plausible reason for fixed and variable claims. The current product does not yet touch an RWA or external yield source, so the RWA language is prospective. The frontend metadata at `app/app/layout.tsx:7-11` says users can trade yield on Stellar, but the deployed pool is empty. The official SCF awards page currently shows the latest listed round, #44, ended and in panel review with a June 14, 2026 deadline. The actual next submission deadline is not established in this repository ([SCF awards](https://communityfund.stellar.org/awards)).
- **What "fundable" looks like**: Frame Sidereal as testnet fixed-income infrastructure for tokenized yield-bearing Stellar assets. Claim only the deployed Tier 1 lifecycle. Request funds for one named ecosystem integration and for gated PT/SY market work. Do not present YT flash trading as shipped until strict auth and live settlement are proven.
- **Why this matters for SCF**: A coherent lane lets reviewers evaluate a milestone. An RWA claim without an RWA asset or partner reads as keyword matching.
- **Work required**: Select the first integration and award route, rewrite the pitch around current evidence, obtain deadline and chapter guidance, and align milestones with single-developer throughput. Estimate 0.5 day after the human decisions are made.

### Finding 3.9: Honest caveats coexist with claims a reviewer can disprove

- **Dimension**: 9. Is the scope honest?
- **Current score**: 5/10
- **What's wrong**: `README.md:16` honestly identifies a mock rate, and `README.md:46-50` labels the AMM experimental. Those caveats are undermined by specific false claims: frontend claim support at `README.md:46-47`, direct underlying redemption at `README.md:159`, a pending deployment at `README.md:168-170`, Blend and OpenZeppelin behavior in `ARCHITECTURE.md:23-45`, and a working maturity demo in `docs/DEMO.md:70-76`. The trade UI advertises all four routes at `app/app/(app)/trade/page.tsx:16-22` although every route fails on the empty live pool. The mint preview at `app/app/(app)/mint/page.tsx:24-35` displays PT/YT equal to SY shares, which is wrong when the exchange rate differs from 1.0.
- **What "fundable" looks like**: Every present-tense claim has a test, live transaction, or directly inspectable UI path. Target architecture is marked "planned." Experimental routes are disabled or hidden in the reviewer demo. Amount previews use the same unit conversions as contracts.
- **Why this matters for SCF**: These are easy discrepancies to catch. A reviewer who finds two will distrust the statements that are correct.
- **Work required**: Correct public text and previews, hide unavailable routes, and add a claim-to-evidence checklist for submission claims. Estimate 0.5 to 0.75 day.

### Finding 3.10: Security controls are incomplete at the exact high-risk boundary

- **Dimension**: 10. Is the security posture appropriate for the funding stage?
- **Current score**: 5/10
- **What's wrong**: `SECURITY.md` exists, checked math is widespread, storage TTLs are extended, and tokenizer auth entries pin contract, function, and arguments. The unresolved risk is the flash route. `tests/integration/tests/auth_invariants.rs:142-181` ignores the strict-auth test. The YT journey explicitly uses `mock_all_auths_allowing_non_root_auth` in `tests/integration/tests/journey.rs:233-267`. All contract unit fixtures use `mock_all_auths`, including `contracts/amm/src/lib.rs:1413-1419`. The AMM source itself documents the auth caveat at `contracts/amm/src/lib.rs:962-1006`. Admin custody, rotation, incident pause behavior, and the authority to set the exchange rate are not documented. The deployer appears to be a local `sidereal-deployer` identity. `SECURITY.md:29` excludes the live testnet deployment from its supported scope. Contracts emit no protocol events, which weakens monitoring and transaction-level review.
- **What "fundable" looks like**: Tier 1 auth passes without permissive mocks and through a real wallet. PT/SY pool auth is proven before it is shown. YT flash routes remain gated until their nested authorization tree passes. A deployment security note identifies admin powers, address, custody model, testnet limitations, and mainnet path. Critical state changes emit events.
- **Why this matters for SCF**: SCF does not require a pre-award audit, but it expects the team to identify the real risk surface. Ignoring the one test at the flash-auth boundary is a direct negative signal.
- **Work required**: Prove Tier 1 and PT/SY auth, retain the flash gate, document admin custody, include testnet in the disclosure scope, and add core lifecycle events. Estimate 1.5 to 2.5 engineering-days. YT flash repair, if needed, is additional.

## Section 4: The submission narrative

Sidereal is a Soroban prototype for converting a yield-bearing Stellar asset into two transferable claims: Principal Tokens for a fixed face-value claim at maturity and Yield Tokens for variable appreciation before maturity. The current implementation wraps a test Stellar asset as Standardized Yield, splits and recombines PT and YT in asset-value units, and enforces settlement with real SEP-41 transfers. The present rate source is admin-controlled and simulated. It is not a Blend or DeFindex integration.

The committed contracts, source-matched testnet deployment, and successful CLI-signed deposit, split, rate-bump, claim, and recombine transactions prove most of the Tier 1 accounting path. At audit time, 79 Rust tests, 33 SDK tests, 16 frontend tests, and 14 browser smoke tests pass. One strict flash-auth test is ignored and two full browser-flow variants are skipped. PT maturity redemption and final SY unwrap are not evidenced on testnet. The current public frontend is not accessible without Vercel authentication, claim and unwrap are not exposed in the UI, and the AMM is unseeded. Sidereal should therefore be described as a deployed contract prototype with a partially integrated application, not as a working yield market.

The proposed funding milestone is to connect the wrapper to one named Stellar yield source, publish a real-wallet Tier 1 journey with explorer-linked transactions, and prove PT/SY liquidity operations under strict authorization. YT flash routing and internal TWAP remain gated follow-on work until the nested auth tree and integer pricing path are demonstrated against the deployed Wasm artifact. The requested tranche should fund this narrow integration and verification milestone, not mainnet launch, multiple maturities, or a production-ready claim.

This narrative is honest but thin for a Build Award today. It becomes defensible once the public Tier 1 demo exists. It becomes competitive for a small Build Award only when the named yield-source integration has code, partner feedback, or a precise first milestone.

## Section 5: Remaining work, ordered by impact-per-effort

1. **Task**: Commit the verified `deployments/testnet.toml`, correct or remove the non-resolving short-market PT address, replace the stale provenance record, and expose the existing lifecycle links. **Why it matters**: Moves Dimensions 2, 4, and 9 by about 1 point each because the strongest current proof is absent from GitHub. **Effort**: 0.25 day. **Dependencies**: None. **Ownership**: Codex.
2. **Task**: Make the hosted frontend publicly accessible and put the stable URL at the top of README. **Why it matters**: Moves Dimensions 1 and 2 by 1 to 2 points. It removes the fastest reviewer failure. **Effort**: 0.25 day. **Dependencies**: None. **Ownership**: Human for Vercel policy, Claude Code for README.
3. **Task**: Run a truth pass over README, ARCHITECTURE, SETTLEMENT, DEMO, REMAINING, PROVENANCE, SDK README, and frontend metadata. Remove false Blend, OpenZeppelin, claim UI, underlying redemption, `zap_out`, reference-test, and pending-deployment claims. **Why it matters**: Moves Dimensions 4 and 9 by 2 to 3 points and Dimension 8 by 1 point. **Effort**: 0.75 to 1 day. **Dependencies**: Item 1 establishes deployment truth. **Ownership**: Claude Code.
4. **Task**: Correct the UI's asset-unit math and disable unavailable actions. PT/YT preview must use face value rather than SY share count. Hide all AMM routes while reserves are zero. **Why it matters**: Moves Dimensions 1, 2, and 9 by about 1 point. It prevents a visible false quote. **Effort**: 0.5 day. **Dependencies**: None. **Ownership**: Claude Code.
5. **Task**: Add frontend and SDK support for claim yield and SY-to-underlying redemption. Make maturity redemption visibly two-step or atomically compose both steps. **Why it matters**: Moves Dimensions 1 and 2 by 2 points and closes the largest Tier 1 UI gap. **Effort**: 1 to 1.5 days. **Dependencies**: Item 4 for correct units. **Ownership**: Claude Code.
6. **Task**: Complete and verify the short-maturity Tier 1 demo. Reuse the existing CLI lifecycle evidence where valid, then record PT redemption and SY unwrap with a real wallet. Add explorer links and before/after balances. **Why it matters**: Moves Dimensions 1 and 2 by 2 to 3 points, Dimension 3 by 1 point, and Dimension 9 by 1 point. **Effort**: 1 to 1.5 days. **Dependencies**: Items 1, 2, 4, and 5. **Ownership**: Claude Code for the flow and UI, human for wallet signing and public evidence.
7. **Task**: Make the simulated yield solvent. Require backing to be deposited before an exchange-rate increase, or make the demo harness transfer the exact liability increase and assert vault-wide solvency. **Why it matters**: Moves Dimensions 2 and 3 by 2 points. Without it, the demo is economically false. **Effort**: 0.5 to 1 day. **Dependencies**: Must precede the rate increase in Item 6. **Ownership**: Claude Code for contracts, Codex for regression scaffolding.
8. **Task**: Prove Tier 1 authorization without `mock_all_auths`, including wallet deposit, tokenizer split, claim, recombine, PT redemption, and wrapper redemption. **Why it matters**: Moves Dimensions 1, 2, and 10 by 1 point. **Effort**: 1 day. **Dependencies**: Item 6 can supply the live path. **Ownership**: Codex for test scaffolding, Claude Code for any contract correction.
9. **Task**: Make a human scope decision: submit Tier 1 only, or give PT/SY AMM proof a hard two-day gate. Hide YT routes by default. **Why it matters**: Moves Dimensions 8 and 9 by 1 to 2 points by making the submission internally consistent. **Effort**: 0.1 day. **Dependencies**: Current evidence is sufficient. **Ownership**: Human decision.
10. **Task**: If the AMM stays in the demo, seed a dedicated market and execute add liquidity, PT-for-SY, SY-for-PT, and remove liquidity with a real wallet. Publish reserve and transaction evidence. **Why it matters**: Moves Dimensions 1 and 2 by 1 to 2 points and Dimension 5 by 1 point. **Effort**: 1.5 to 2 days. **Dependencies**: Item 9 and strict PT/SY auth proof. **Ownership**: Claude Code for contracts and deployment, human for wallet evidence.
11. **Task**: Select and implement one first yield-source adapter. Prefer the interface that can be verified on testnet within the sprint. **Why it matters**: Moves Dimension 6 by about 3 points, Dimension 3 by 2 points, and Dimensions 5 and 8 by 1 to 2 points. This is the largest Build Award differentiator. **Effort**: Estimated 5 to 8 days for DeFindex, 8 to 12 days for direct Blend. **Dependencies**: Human selects the target and confirms current protocol interfaces or partner access. **Ownership**: Claude Code for contracts, human for protocol coordination.
12. **Task**: Add fixed-point reference vectors, monotonicity and maturity-boundary cases, vault-wide conservation checks, and one test that executes the deployed Wasm path. Correct the "10K property test" claim. **Why it matters**: Moves Dimension 3 by 2 points and Dimension 4 by 1 point. **Effort**: 1.5 to 2 days. **Dependencies**: Stable economics and rate-source semantics. **Ownership**: Codex.
13. **Task**: Add contract events for deposit, redeem, split, recombine, claim, liquidity, and swaps. Link event evidence from the demo. **Why it matters**: Moves Dimensions 2 and 10 by about 1 point and makes reviewer verification cheaper. **Effort**: 1 day. **Dependencies**: Event schema should follow the settled Tier 1 interface. **Ownership**: Codex for scaffolding, Claude Code for contract review.
14. **Task**: Document admin powers, signer custody, rate authority, rotation expectations, incident response, and the mainnet upgrade posture. Include the testnet deployment in `SECURITY.md` scope. **Why it matters**: Moves Dimension 10 by 1 to 2 points at low cost. **Effort**: 0.5 day. **Dependencies**: Human must state who controls the key. **Ownership**: Human decision, Claude Code documentation.
15. **Task**: Replace the skipped browser flow with a repeatable live-testnet job or a separately scheduled signed demo check. Fail when RPC reads or contract state are unavailable. **Why it matters**: Moves Dimensions 1 and 2 by 1 point and prevents demo drift. **Effort**: 1 to 2 days. **Dependencies**: Public funded demo market and safe test signer policy. **Ownership**: Codex.
16. **Task**: Build external traction evidence through reviewed PRs, public technical issues, one ecosystem-protocol review, and independent testnet users. **Why it matters**: Moves Dimension 7 by 2 to 3 points and strengthens Dimension 8. **Effort**: 2 to 3 human-days distributed across three weeks. **Dependencies**: A public usable demo. **Ownership**: Human.
17. **Task**: Attempt YT flash routes only after PT/SY routes are proven. Remove the ignore and prove the exact nested auth tree on testnet. **Why it matters**: Moves Dimensions 1, 3, 5, and 10 by 1 point each only if it works. **Effort**: 2 to 3 days, with high variance. **Dependencies**: Items 9, 10, and 12. **Ownership**: Claude Code.

## Section 6: What to cut

- Cut YT flash trading from the submission demo unless the strict-auth test and both live routes pass by the end of the AMM two-day gate. It is the highest-risk path and currently adds negative evidence.
- Cut the claim that the AMM is part of the shipped MVP if the pool remains empty. A working Tier 1 lifecycle is a stronger Instaward submission than an empty four-route trade screen.
- Cut direct Blend integration from the pre-submission critical path if the current interfaces cannot be understood and exercised within two days. Use DeFindex first if its vault share provides a narrower adapter. Keep Blend as a named later adapter, not a vague integration claim.
- Cut multiple maturities, multiple underlyings, governance, fees, limit orders, cross-chain work, mainnet, and audit preparation. They do not close a current reviewer blocker.
- Cut upgradeability infrastructure before submission. Document the immutable testnet posture and deploy fresh contracts if needed. Upgrade design has security cost and does not move the current fundability score enough.
- Cut `zap_out_at_maturity` unless the team needs it to complete the selected UI journey. A clear two-step PT-to-SY-to-underlying flow is acceptable and easier to audit.
- Cut the internal TWAP as an external safety claim. Keep observations for display and testing. No integration currently consumes it, and it has not been validated as a manipulation-resistant oracle.
- Cut broad frontend polish, animation, analytics dashboards, and secondary market statistics until the public Tier 1 actions and explorer links work.
- Cut the 90 percent coverage chase as a submission blocker. Add coverage reporting if inexpensive, but live economic and authorization evidence has much higher impact. Do not continue claiming a coverage threshold that CI does not measure.
- Cut waiting for the current September maturity. Use a dedicated short-maturity deployment. Testnet cannot be presented as an interactive maturity demo when users must wait months.

## Section 7: SCF-specific risks

1. **Critical: A reviewer cannot access the hosted product.** The Vercel deployment requires authentication. This can end the review immediately.
2. **Critical: The live simulated rate is undercollateralized.** The wrapper owes 1.1 underlying per SY share while holding only 1.0 per issued share. A full redemption cannot settle.
3. **Critical: Public claims are directly falsifiable.** Claim UI, final underlying redemption, live Blend behavior, OpenZeppelin vault use, and testnet-pending status conflict with source or deployment state.
4. **High: The AMM screen advertises routes that all fail.** Zero reserves make every live quote return `MarketNotSeeded`. YT routes also lack strict-auth proof.
5. **High: Current good provenance is not public repository evidence and contains one bad short-market reference.** `deployments/testnet.toml` is untracked, its listed short-market PT address does not resolve, and `docs/PROVENANCE.md` still presents the superseded non-reproducible deployment.
6. **High: The project can be perceived as a derivative implementation.** "Pendle on Stellar" is not enough. The official SCF #43 round lists another yield-derivatives engine that failed panel review, and XCCY overlaps the fixed-rate lane ([SCF #43 round](https://communityfund.stellar.org/awards/reciQ16Y1ztmnmE3N)).
7. **High: The submission context supplied for XCCY is not current award evidence.** The official #43 page currently marks XCCY as `Test Transaction` and explicitly says it has not yet been awarded. Sidereal should not cite it as a funded precedent without rechecking status.
8. **High: No ecosystem integration supports the TVL-growth claim.** The underlying is a test asset and the rate is an admin input. Blend, DeFindex, and RWA language are roadmap statements.
9. **Medium: Strict authorization is missing where composability is most complex.** One auth-invariant test is ignored, and the flash journey uses permissive non-root mocks.
10. **Medium: The repository has velocity but no review trail.** Fast merges without reviews, public design discussion, or independent users weaken the team-execution case.
11. **Medium: No current SCF deadline is established.** The latest official round shown publicly has ended. Planning against "roughly one month" without a verified route or deadline risks building the wrong application package.
12. **Medium: Admin-key risk is invisible.** A local deployer identity controls rate and initialization authority, but custody and incident handling are undocumented.

## Section 8: Three-week realistic path

### Week 1: Make Tier 1 publicly true

Commit deployment provenance. Open the Vercel deployment. Correct every public claim and amount preview. Add claim and SY unwrap actions. Back every simulated rate increase with underlying. Deploy a short-maturity market and publish a real-wallet trace through deposit, split, claim, recombine, PT redemption, and final unwrap. Prove Tier 1 auth without permissive mocks. Hide the AMM unless it is seeded.

Expected score movement: Dimension 1 from 3 to 6, Dimension 2 from 4 to 7, Dimension 3 from 4 to 6, Dimension 4 from 5 to 8, Dimension 9 from 5 to 9, and Dimension 10 from 5 to 6.

### Week 2: Earn the ecosystem claim

The contract developer implements one selected yield-source adapter. Choose DeFindex if its share interface produces a verifiable integration faster. Choose Blend only if the team has confirmed the exact testnet asset, pool interface, and accounting semantics. Codex adds precision, conservation, and Wasm-path tests in parallel. The human publishes the demo, requests protocol-team feedback, and recruits independent testnet users.

If no adapter is executing on testnet by the middle of Week 2, stop calling this a Build-ready application. Prepare an Instaward submission whose funded milestone is the adapter. Do not consume Week 3 on an unfinished integration plus an unfinished AMM.

Expected score movement with a live adapter: Dimension 3 from 6 to 7, Dimension 5 from 5 to 6, Dimension 6 from 2 to 7, and Dimension 8 from 5 to 7. Without an adapter, Dimension 6 remains at 3 and the viable route is Instaward.

### Week 3: Gate the market, package the submission

Give PT/SY liquidity and swaps two contract-developer days. Require strict auth, seeded reserves, add/remove liquidity, both PT routes, explorer links, and repeatable tests. If any gate fails, cut the market from the shipped claim and retain it as the next milestone. Attempt YT flash routing only after that gate passes and only if at least two days remain. Spend the rest of the week on the demo video, application evidence, admin/security note, public design feedback, and exact tranche milestones.

With a public Tier 1 demo, real yield adapter, and proven PT/SY routes, the expected final score is about 65 to 72 out of 100. That supports a credible small Build Award application, not a large award. With a public Tier 1 demo but no adapter, the expected score is about 57 to 62. Submit for an Instaward or wait. Do not submit the current four-route product claim with an empty pool.

## Section 9: Comparison to recent funded submissions

### Eara RWA Regulated Engine, SCF #40, $90K

Eara's awarded submission reported an existing product with about EUR 5 million tokenized, EUR 16 million in transactions, EUR 300,000 revenue, and a licensed partner managing EUR 500 million. Its Stellar work was a funded expansion of demonstrated business activity, not the first proof of the product ([Eara submission](https://communityfund.stellar.org/dashboard/submissions/recwAK74KKbrRmjzn)). Sidereal is materially behind that funding state. It has stronger inspectable Soroban code than a slide-only proposal would have, but no users, revenue, partner, or real asset integration. A $90K comparison is not defensible today.

### Stellar Attestation Service, SCF #32, $83.1K

The awarded SAS application described an existing public attestation design, prior SCF participation, 11 RFP calls, and two prospective co-builders. Its milestones converted established ecosystem discovery into implementation ([SAS submission](https://communityfund.stellar.org/submissions/recIHN98Ja7MMb4DX)). Sidereal has more protocol code at submission-preparation time, but much less external validation. The lesson is not to add more code first. It is to show reviewed ecosystem demand for the exact integration being funded.

### Soroban Payout and Token Suite, SCF #42, $45K

This project received $45K for a narrow two-person token issuance, sale, redemption, and compliance framework ([project page](https://communityfund.stellar.org/project/soroban-payout-token-suite-fav)). That award size is a better upper calibration for Sidereal after the Tier 1 demo works. The scope is legible and transaction-oriented. Sidereal's current scope is broader and less verifiable because it combines vault accounting, two claim tokens, maturity behavior, four swap routes, and a pricing curve. A narrower application has a better chance than asking reviewers to underwrite the full architecture.

### KYC Token and UI for RWA, SCF #22, $45K

The official award record confirms a $45K award in a clear RWA-enablement lane ([SCF #22 awards](https://communityfund.stellar.org/awards/recNppqiAoaK3YGlE)). Sidereal can fit adjacent RWA infrastructure only after it wraps a real or credible testnet yield-bearing asset. Today it has no RWA or compliance integration. Calling the current prototype RWA infrastructure would be prospective, not shipped evidence.

### XCCY and Talwex calibration

The prompt identifies XCCY and Talwex as funded comparables. The current official SCF #43 page instead marks both as `Test Transaction` and states that they have not yet been awarded ([SCF #43 round](https://communityfund.stellar.org/awards/reciQ16Y1ztmnmE3N)). They remain useful competitive references, but not award calibration. Sidereal must distinguish tokenized principal and yield claims from XCCY's fixed-rate lending and swaps, and from bond products such as Talwex, using deployed behavior rather than category language.

## Section 10: Open questions for the human

1. Is the target route an Instaward, the next open Build Award, or both? What is the confirmed submission date and chapter process?
2. Is the submission product Tier 1 tokenization only, or is PT/SY trading mandatory? Is YT flash trading explicitly descoped unless the two-day gate passes?
3. Which first yield source is the team committing to: DeFindex, direct Blend, or another testnet asset? Has its current contract interface been validated?
4. Who controls the `sidereal-deployer` secret key? Is it a single local key, hardware-backed key, or multisig? Who can set the exchange rate?
5. Was the 1.1 live exchange rate intended to be backed by additional underlying? If so, where is that transaction and why does the vault balance not include it?
6. Can Vercel authentication be removed immediately, and which URL will remain stable through review?
7. Does the team have transaction hashes for the deposit, split, claim, recombine, and deployment smoke flow that produced the current state?
8. Has anyone outside the two developers completed a wallet flow? Can that person provide reproducible feedback or a public issue?
9. Has the team contacted PaltaLabs, DeFindex, Blend contributors, OpenZeppelin's Stellar team, SDF, or an SCF local chapter? What feedback was received, and what may be cited publicly?
10. What prior shipped work can Poulav and Ishita cite with verifiable links? What role will Ishita own during the funded milestone?
11. Is an actual RWA asset expected in the first milestone, or is the first integration a crypto lending or vault share? The application should not blur those categories.
12. Is the admin-set mock rate acceptable for the submission demo if every increase is fully backed and labeled, or does the team require a real adapter before recording the demo?
13. Will the team commit the current testnet manifest, or is there a reason it is untracked?
14. Is the absence of contract events intentional? If so, what will integrators and the demo use for verifiable lifecycle history?
