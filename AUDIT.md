Sidereal Product Audit

1. Executive summary

Sidereal is a working skeleton with one genuinely working primitive inside it. The core tokenization lifecycle (deposit, split, recombine, PT redeem at maturity) moves real SEP-41 tokens and is correct and well tested. That part is real. Everything that makes it a yield product is not.

Three things break the product claim. First, the AMM on main cannot run on Stellar at all: it uses libm f64 sqrt/log/exp, which the Soroban wasm VM rejects. The uncommitted integer rewrite fixes this but is not committed, so main is undeployable and any deploy from main produces a contract that fails to upload. Second, the yield economics are inverted: PT redeems 1:1 for appreciating SY shares, so PT holders capture the yield and YT is structurally worthless. claim_yield computes a number and transfers nothing. There is no code path that pays a YT holder. Third, there is no real yield source. The SY exchange rate is an admin-set knob with no backing, so any redemption above the original deposit is an insolvency the vault cannot honor.

The secondary market is also not live in practice. The committed deploy script is missing the AMM yt_token argument and would fail. The actual testnet deployment was produced by an uncommitted "resilient deploy" script, so the deployed bytecode does not correspond to any committed source. The seed script defaults to not seeding AMM liquidity, so the live market almost certainly returns "no liquidity" on every quote. The SDK reads use the market contract address as a simulation source account, which testnet RPC will reject, so the frontend read path likely returns null against live contracts.

Net: the deposit/split/recombine/PT-redeem core is a working primitive. The AMM, the YT side, the yield, and the live deployment are a working demo at best and partly a non-working one. None of it is mainnet-safe and most of it is not yet testnet-functional for a fresh user.

---

2. Findings by layer

Layer 1: Contract correctness and safety

---

Finding: The AMM curve math on main uses floating point, which the Soroban wasm VM forbids.

- Current state: contracts/amm/src/lib.rs on main imports libm::{exp, floor, log, sqrt} and uses f64 for ln, exp, sqrt, and float-to-fixed conversion. The uncommitted working-tree diff replaces all of these with integer fixed-point (range-reduced atanh series for ln, Taylor series for exp, Newton sqrt). Cargo.toml still lists libm as a dependency even in the fixed tree.
- Gap: Soroban rejects wasm modules containing float opcodes at upload time. The main AMM either fails stellar contract deploy or traps at runtime. CI does not catch it because CI runs cargo test (native f64 works) and cargo build --target wasm32v1-none (compiles fine; the rejection happens at upload, which CI never does).
- Work required: Commit the integer-math diff. Remove the libm dependency from contracts/amm/Cargo.toml. Add a CI step that runs stellar contract install (or a wasm float-opcode lint) against the built AMM wasm so this can never regress silently.
- Risk if shipped as-is: Critical. main is undeployable; the live contract is unverifiable against source.
- Estimated effort: 0.5 day.

---

Finding: The integer ln/exp rewrite is unproven against a reference and has no precision tests.

- Current state: ln_wad_checked runs the atanh series to n=49; exp_wad_checked runs Taylor to 20 terms with a 1i128 << k scale. The 10,000-case property test only checks the PT+YT=SY invariant, not price accuracy. It currently runs against the f64 version on native, not the integer version on wasm.
- Gap: No test asserts the integer ln/exp match a high-precision reference, no monotonicity test, no rounding-direction test, no boundary test near proportion → MAX_MARKET_PROPORTION or t → 0. The audit M4 recommendation (reference comparison) was never implemented.
- Work required: Add tests comparing ln_wad/exp_wad against a rational/bignum reference across the input domain with an explicit error bound. Add monotonicity and rounding tests for get_exchange_rate. Re-run the property suite confirming it exercises the integer path.
- Risk if shipped as-is: Medium. Likely correct, but unverified transcendental math sets prices.
- Estimated effort: 1.5 days.

---

Finding: PT redeems 1:1 for appreciating SY shares, so PT captures the yield and YT is worthless. This is the central economic defect.

- Current state: tokenizer.split mints pt = yt = sy_amount (1:1 in share units) and escrows sy_amount SY. tokenizer.redeem_at_maturity burns PT and pushes SY 1:1. SY shares appreciate via exchange_rate. So at maturity a PT holder redeems 1 PT → 1 SY → rate underlying, collecting principal plus yield. ARCHITECTURE.md:68's own worked example is internally inconsistent: it gives the 2 USDC of yield to the PT redeemer ("100 SY ... unwrap into 102 USDC") and also claims "the 2 USDC of yield went to whoever held the YT." Both cannot be true; the vault holds 102.
- Gap: In Pendle, 1 PT redeems to 1 unit of asset (fixed principal), and YT collects the accrued interest as SY is drawn out of escrow over the term. Here YT draws nothing (claim_yield moves no tokens) and PT redemption is not capped to principal. YT has no cash flow. The product does not actually separate principal from yield.
- Work required: Redesign redemption so PT redeems to its asset face (pt_amount \* WAD / rate_at_maturity SY, or denominate PT/YT in asset units at mint), and make claim_yield actually transfer SY out of the tokenizer escrow to the YT holder equal to accrued interest, reducing escrow so PT remains exactly covered at maturity. This is real protocol work plus an invariant test that escrow == PT-face-coverage after arbitrary claim/redeem interleavings.
- Risk if shipped as-is: Critical (product-defining). The yield instrument does not pay yield.
- Estimated effort: 4 to 6 days.

---

Finding: claim_yield is not transfer-safe; YT yield is lost or over-claimed when YT changes hands.

- Current state: Yield is (current_rate - checkpoint) \* yt_balance / WAD. The checkpoint is per (holder, maturity) and is only advanced on claim_yield. There is no checkpoint hook on transfer/transfer_from. A new holder's missing checkpoint defaults to the current rate (unwrap_or(current_exchange_rate)).
- Gap: If Alice accrues yield then transfers YT without claiming, the buyer's default checkpoint is "now," so that interval's yield is unclaimable by anyone (lost). If the buyer already had an older checkpoint and receives more YT, they over-claim against the larger balance for a period they did not hold it. ARCHITECTURE.md:82 acknowledges the "transfer carries unclaimed yield" behavior as intended, but the code does not even achieve that; it loses or inflates it. Pendle checkpoints both parties in \_beforeTokenTransfer.
- Work required: Checkpoint the sender and receiver before every YT balance move (settle or escrow their accrued yield first). Add tests: accrue, transfer without claim, both parties claim, assert conservation.
- Risk if shipped as-is: High once real yield exists (fund inflation / loss). Low today because nothing is paid.
- Estimated effort: 2 to 3 days (couples with the claim-payout work).

---

Finding: SY redemption and PT/YT yield are unbacked; the vault is insolvent above the deposited principal.

- Current state: sy-wrapper.set_exchange_rate lets the admin set any rate. redeem pays sy_amount \* rate / WAD underlying via push_underlying. The vault only holds what was deposited. No yield ever enters.
- Gap: After any rate bump, total claims exceed vault holdings. The first redeemer is paid from later depositors' principal; the last redeemers' push_underlying transfer simply fails (insufficient balance). There is no solvency check.
- Work required: Either integrate a real yield source so the underlying actually grows (Layer 2), or cap redemption to available underlying and document the vault as principal-only. A real fix requires the rate to be derived from a held position, not set by an admin.
- Risk if shipped as-is: Critical on mainnet (direct loss). It is the same root cause as the mock-yield gap.
- Estimated effort: folds into Layer 2.

---

Finding: Tokenizer cross-contract calls follow checks-effects-interactions and reentrancy surface is low, but unguarded.

- Current state: split/recombine/redeem_at_maturity call out to SY/PT/YT (the protocol's own SEP-41 tokens, which have no transfer hooks). AMM swaps reconcile_reserves from real balances after transfers, which defends against balance drift. There is no explicit reentrancy guard.
- Gap: Safe only because every token in the path is a trusted, hookless contract. The SY underlying is a standard SAC (also hookless). If a future SY underlying had transfer callbacks, the post-transfer reconcile_reserves pattern plus missing guards could be exploitable.
- Work required: Document the trust assumption (underlying must be a hookless SAC). If permissionless underlyings are ever allowed, add a reentrancy guard.
- Risk if shipped as-is: Low (given trusted tokens).
- Estimated effort: 0.5 day (documentation).

---

Finding: SY-wrapper Principal does not move on transfer, corrupting accrued_yield display.

- Current state: move_balance moves Balance but not Principal. accrued_yield = shares\*rate - principal.
- Gap: A recipient of transferred SY has principal 0, so their entire balance reads as "yield." The sender's principal stays high against a reduced balance and saturates to 0. Display-only, no fund impact, but wrong.
- Work required: Move principal pro-rata on transfer, or drop per-holder principal tracking and compute yield differently.
- Risk if shipped as-is: Low (cosmetic).
- Estimated effort: 0.5 day.

---

Finding: Flash-route auth tree is tightly scoped, so it is a liveness risk more than a drain risk. Pushing back on the "most fund-draining surface" framing.

- Current state: flash_split/flash_recombine build InvokerContractAuthEntry entries scoped to exact (contract, fn_name, args) including the exact amount. The integration test uses mock_all_auths_allowing_non_root_auth, not a real signed auth tree.
- Gap: Because each authorized sub-invocation is pinned to specific args, the AMM cannot be coerced into authorizing an arbitrary transfer; the realistic failure is the transaction reverting on testnet because the MuxedAddress argument encoding the AMM predicts for SY.transfer(amm → tokenizer) does not byte-match what the tokenizer actually invokes. The code comments flag exactly this. So the danger is "YT trading does not work on testnet," not "funds drain."
- Work required: Run swap_sy_for_yt and swap_yt_for_sy on testnet with a real wallet, no mocks. Debug the muxed-vs-Address ScVal encoding until the auth tree is accepted. Add a host-level auth test (not mock_all_auths) asserting the exact entries.
- Risk if shipped as-is: Medium (liveness). The tight arg-scoping lowers the drain risk the brief assumed.
- Estimated effort: 2 to 3 days.

---

Finding: MAX*FLOAT_HELPER*\* bounds are now misnamed leftovers but still constrain the contract.

- Current state: Inputs and reserves are capped at WAD (1e18 base units) by require_within_float_helper_bounds, a holdover from the f64 era to keep values in float-safe range.
- Gap: The integer math no longer needs these bounds, but they still cap any single reserve at 1e18 base units (1e11 whole tokens at 7 decimals). Fine for testnet, but the name lies and the cap is now an arbitrary product limit.
- Work required: Re-derive the real i128 overflow bounds for the integer path and rename, or remove if the checked arithmetic already covers it.
- Risk if shipped as-is: Low.
- Estimated effort: 0.5 day.

---

Layer 2: Real yield integration

---

Finding: There is no yield source. ARCHITECTURE.md and README imply Blend; the code has an admin knob.

- Current state: set_exchange_rate(admin, rate) is the entire yield mechanism. ARCHITECTURE.md:39-41 claims the OpenZeppelin Soroban Vault extension and "as the Blend pool earns interest, the exchange rate ticks up." Neither is in the code; there is no OZ vault import and no Blend reference anywhere.
- Gap: For a product, the rate must come from a real position whose value the vault actually holds.
- Work required (DeFindex path, cleaner): DeFindex vaults expose a share token with a 4626-style read path. Build an SY adapter that, on deposit, deposits underlying into the DeFindex vault and records the share amount; exchange_rate reads vault pricePerShare; redeem withdraws from the vault. Handle: vault paused (reject deposit, allow redeem), vault empty / zero shares, and a decreasing rate (see the negative-yield finding). Replace set_exchange_rate with a read-through. This is the bulk of the SY-wrapper rewrite.
- Work required (Blend path, harder): bTokens are not 4626. You wrap the bToken: deposit supplies to the Blend pool and tracks the bToken balance; exchange_rate derives underlying-per-share from the pool's bRate; redeem withdraws. You must handle Blend's interest accrual cadence and pool health. This is closer to 8 to 12 days than 2.
- Risk if shipped as-is: Critical (the product has no yield).
- Estimated effort: DeFindex 5 to 8 days; Blend 8 to 12 days.

---

Finding: No handling of negative yield (exchange-rate decrease).

- Current state: yt-token rejects a rate below the checkpoint (ExchangeRateRegression), which means YT claims simply halt on a downturn. The SY wrapper allows the rate to be set lower, but redemption then pays less underlying with no floor. PT still redeems 1:1 SY regardless.
- Gap: If the real source slashes or loses value, PT can still attempt 1:1 redemption against an escrow worth less, and there is no defined loss-allocation policy.
- Work required: Define and implement loss handling: PT redemption must be capped to actual recoverable underlying; YT claims floored at zero; document who absorbs the loss.
- Risk if shipped as-is: High on mainnet.
- Estimated effort: 1 to 2 days (after Layer 2 core).

---

Layer 3: AMM completeness and tradability

---

Finding: With the float fix, the PT/SY curve math is structurally sound and the H1/H2/M1 audit findings are fixed.

- Current state: LP balances are now per-holder (DataKey::LpBalance), remove_liquidity checks lp_in <= holder_lp (H1 fixed). sync_twap returns early on elapsed == 0 with a passing test (H2 fixed). Exact-in swaps transfer the full sy_in and reconcile_reserves credits it, so dust accrues to LPs rather than vanishing (M1 mitigated). PT price converges to par as τ → 0 because rate_scalar = scalar_root \* IMPLIED_RATE_TIME / τ grows and the curve flattens around proportion. Rounding uses mul_div_down on outputs and mul_div_up on required inputs, which favors the pool.
- Gap: Usability is gated on the float commit, on liquidity being seeded, and on the SDK read bug (below). The math itself is fine.
- Work required: Commit float fix; then end-to-end test a fresh wallet buying and selling PT on testnet.
- Risk if shipped as-is: Low (math), pending the operational gates.
- Estimated effort: included elsewhere.

---

Finding: The live market is almost certainly unseeded, so every quote fails.

- Current state: scripts/seed-demo.sh defaults SEED_AMM=0 and explicitly skips add_liquidity "until AMM auth is verified on testnet." require_seeded panics (MarketNotSeeded) on any quote or swap when total_lp <= 0.
- Gap: Unless someone ran with SEED_AMM=1, the deployed AMM has no reserves and the trade page shows "This market has no liquidity yet" for everyone.
- Work required: After the float fix and auth proof, seed liquidity on testnet and confirm quotes return.
- Risk if shipped as-is: High (the secondary market is non-functional for users).
- Estimated effort: 0.5 day (after auth proof).

---

Finding: The rate anchor is admin-fixed at init, so the first-LP bad-anchor risk is limited.

- Current state: First add_liquidity computes the initial implied rate from config.initial_anchor (set by admin at initialize) and the deposited PT:SY ratio. The first LP chooses the ratio, not the anchor.
- Gap: A skewed first ratio sets a skewed starting implied APY, corrected by arbitrage. No drain, because the first LP funds both sides. The real lever is the admin's scalar_root/initial_anchor choice.
- Work required: Document recommended anchor/scalar for the chosen maturity. Optionally constrain the first LP ratio to be near the anchor-implied ratio.
- Risk if shipped as-is: Low.
- Estimated effort: 0.5 day.

---

Finding: Internal TWAP is implemented and same-ledger-resistant, but manipulation resistance over a single block is weak by construction and it is not externally consumed safely.

- Current state: sync_twap time-weights twap_ln_implied_rate over twap_window (default 1800s), skips zero-elapsed updates, and snaps to spot after a full window. twap_apy exposes it. The SDK reads twap_apy for display.
- Gap: The TWAP is an EWMA seeded from a single observation per ledger; a determined actor moving price across consecutive ledgers still drags it. It is fine for display and slippage context, not as a price oracle for an external lending market. No one currently consumes it as an oracle, which is the safe state.
- Work required: Keep it display-only and document "do not use as an external oracle." If external use is ever wanted, that is a larger design task.
- Risk if shipped as-is: Low (display); High if anyone wires it as collateral pricing.
- Estimated effort: 0.5 day (docs).

---

Finding: Swap fees accrue to LPs correctly via reserve reconciliation; there is no separate fee bucket.

- Current state: Fees are folded into the SY leg (fee subtracted from pre_fee_sy_out, added on the in-leg) and remain in the pool, raising reserves against constant LP supply, so LP value grows. No protocol fee split.
- Gap: None for an LP-only fee model. There is no protocol-fee switch (out of scope per REMAINING.md).
- Risk if shipped as-is: Low.
- Estimated effort: none.

---

Layer 4: Frontend

---

Finding: The frontend is genuinely built and wired to live addresses, but its read path likely fails against testnet because simulations use a contract address as the source account.

- Current state: app/.env.local holds five real testnet C-addresses. wallet.tsx integrates @creit.tech/stellar-wallets-kit with allowAllModules (Freighter/xBull/Lobstr), real signTransaction, network-mismatch detection. tx.tsx/useSidereal.ts drive build → sign → submit. trade/page.tsx has all four routes, live debounced quotes, slippage, price impact, implied APY, and error mapping. But sdk/src/client.ts:278 does getAccount(this.contracts.market) to source every simulation, and the market is a contract address, not a funded account.
- Gap: Testnet RPC getAccount on a C-address returns not-found, so simulateRead throws, getMarketSafe/getPosition/quoteSwap return null or error, and the UI silently shows "no market" / "quote unavailable." The flows have not been verified against live contracts.
- Work required: Use a real funded account (the connected wallet address, or a throwaway funded G-account) as the simulation source. Then do a full manual pass: mint, split, recombine, redeem, swap PT, add/remove liquidity, against testnet, fixing whatever surfaces.
- Risk if shipped as-is: High (the app appears empty to every visitor).
- Estimated effort: 0.5 day for the source-account fix; 1 to 2 days for the full live verification pass.

---

Finding: Transaction preview and error handling are decent; YT preview is honest about leverage.

- Current state: The trade panel shows expected out, price impact, implied APY, and min-received at 0.5% slippage in human units. errors.ts maps per-contract codes to readable messages. The YT route shows a leverage warning.
- Gap: Amounts are shown but the user is not shown the multi-operation nature of a YT flash tx or the mint+split atomic co-sign. Minor.
- Risk if shipped as-is: Low.
- Estimated effort: 0.5 day polish (optional).

---

Layer 5: SDK

---

Finding: The SDK covers the core methods and is usable headless, but it does not expose YT claim, liquidity reads, or LP balance, and the simulate path has the source-account bug.

- Current state: StellarYT exposes getMarket, quoteSwap, getPosition, buildMint (with optional atomic split), buildSwap, buildRedeem, buildAddLiquidity, buildRemoveLiquidity, submit. Quotes simulate the AMM quote\_\* accessors. getPosition reads preview_claim_yield for display.
- Gap: No claim_yield builder (consistent with claim paying nothing). No lp_balance / total_lp read for an LP UI. The source-account bug (Layer 4) breaks all reads. buildMint split amount is computed off the pre-tx rate and could round above minted shares and revert.
- Work required: Fix the simulate source. Add LP and claim methods once claim actually pays. Guard the split amount against rounding.
- Risk if shipped as-is: Medium (reads broken; integrators blocked).
- Estimated effort: 1 day.

---

Layer 6: Tests and correctness signals

---

Finding: Coverage is real for the core, thin for the parts that are broken.

- Current state: 40-plus Rust tests. AMM has a 10,000-case property test for PT+YT=SY across random swap/split/recombine sequences with real token balances. Integration journey.rs reconciles real balances for deposit/split/recombine/redeem and runs the YT flash round-trip under mock_all_auths_allowing_non_root_auth. SY/PT/YT/tokenizer have focused unit tests including overflow and init gating.
- Gap: The property test runs against the f64 path on native, not the integer path on wasm. No reference-precision tests for ln/exp. No real-auth (non-mock) test for the flash route. No test that YT yield is conserved across transfers (because no payout exists). No maturity-boundary invariant test that escrow exactly covers PT after arbitrary claim/redeem interleavings. No test against live testnet RPC. The pre-testnet audit's own NO-GO verdict predates these fixes and its "deferred" section is stale.
- Work required: Add the precision tests, a host-auth flash test, a YT conservation test (after the payout rework), and a maturity-coverage invariant test. Add one integration test that runs the integer wasm, not just native.
- Risk if shipped as-is: Medium. The green suite overstates confidence in the AMM and YT.
- Estimated effort: 2 to 3 days (spread across the other fixes).

---

Layer 7: Operational and deployment

---

Finding: The committed deploy script is broken and the live deployment is not reproducible from source.

- Current state: scripts/deploy-testnet.sh invokes AMM initialize without --yt_token, which the AMM signature requires; the call would fail. app/.env.local is headed "Generated by resilient deploy," a script not in the repo. The deploy builds wasm from the working tree, so a main deploy ships the float-broken AMM.
- Gap: The committed script does not work; the deployed bytecode corresponds to no committed commit; a clean-checkout deploy from main produces an undeployable AMM.
- Work required: Fix the AMM init args. Commit the "resilient deploy" script. Build from a pinned, committed commit and record the commit hash alongside the addresses.
- Risk if shipped as-is: High (provenance and reproducibility).
- Estimated effort: 1 day.

---

Finding: Contracts are not upgradeable and admin/addresses are pinned only in .env.local.

- Current state: No update_current_contract_wasm, no upgrade, no set_admin/admin-transfer in any contract. Addresses live only in .env.local.
- Gap: A bug after deploy means redeploy at new addresses and rewire the frontend. If testnet state is wiped, everything moves. No admin rotation.
- Work required: Decide an upgrade policy. For testnet, redeploy-and-rewire is acceptable if documented. For mainnet, wire an admin-gated upgrade and an address registry. Pin addresses in a committed file, not just .env.local.
- Risk if shipped as-is: Medium on testnet, High on mainnet.
- Estimated effort: 2 days (upgrade wiring) if pursued.

---

Finding: TTL strategy exists only for the AMM, and YT puts per-holder data in instance storage.

- Current state: The AMM bumps instance TTL on mutating calls. SY, PT, YT, and tokenizer have no TTL bump. Token balances are in persistent storage (good), but Config, TotalSupply, exchange rate, and YT Checkpoint(holder, maturity) are in instance storage.
- Gap: For a 90-day market, instance entries on the non-AMM contracts can be archived mid-term, freezing the contract until restored. Worse, YT per-holder checkpoints in instance storage bloat a single shared entry and all share one TTL; this does not scale and is the wrong storage class.
- Work required: Add TTL bumps on mutating entrypoints in SY/PT/YT/tokenizer. Move YT checkpoints to persistent storage keyed per holder.
- Risk if shipped as-is: Medium (operational freeze; checkpoint scaling).
- Estimated effort: 1 to 2 days.

---

Finding: No monitoring, no admin-key documentation.

- Current state: None. Admin is the sidereal-deployer CLI identity; who holds it and where is undocumented.
- Gap: No alerting on TTL expiry, on the unbacked exchange rate, or on contract liveness. No documented key custody.
- Work required: A simple cron that checks instance TTLs and key balances and alerts. Document admin custody.
- Risk if shipped as-is: Medium.
- Estimated effort: 1 to 2 days.

---

Layer 8: Maturity and edge cases

---

Finding: Maturity boundaries are gated correctly, but post-maturity yield and rollover are undefined, and the underlying insolvency surfaces here.

- Current state: Live paths reject timestamp >= maturity; PT/tokenizer redemption allows timestamp == maturity onward. PT can be redeemed indefinitely after maturity (no window). AMM rate views return zero at maturity.
- Gap: At maturity, unclaimed YT yield is simply forfeited (YT is worthless and never paid). PT redemption at the grown rate is where the unbacked-vault insolvency actually bites. There is no v2 rollover path (acknowledged out of scope in docs). No cleanup or escrow sweep is defined.
- Work required: Define post-maturity YT settlement (pay out accrued at the final rate before YT expires, or explicitly forfeit and document). Cap PT redemption to recoverable underlying. Specify the redemption window and any escrow sweep.
- Risk if shipped as-is: Critical on mainnet (insolvent redemption), tied to Layer 1/2.
- Estimated effort: folds into the economics rework.

---

Layer 9: Documentation accuracy

---

Finding: The README is mostly honest about the AMM but lies about YT claim and the deploy script, and both README and ARCHITECTURE imply a real yield source that does not exist.

- Current state and the specific lies:
  - README:40 and REMAINING.md:25,67: "YT yield claim ✅ built / assert payout." claim_yield transfers nothing; there is no payout path.
  - README:47: "Testnet deploy script ✅ scripts/deploy-testnet.sh." It is missing --yt_token and would fail; the real deploy used an uncommitted script.
  - README:11,24 and ARCHITECTURE:39-45: imply USDC-in-Blend yield and the OpenZeppelin Vault extension. Neither is in the code; the rate is an admin knob.
  - ARCHITECTURE:68: the worked example double-counts the yield (gives it to PT and claims it for YT).
  - README:139: "property tests ... if a change fails them it does not ship" overstates the gate, since the float defect ships through CI untested on wasm.
  - REMAINING.md does not mention the wasm float blocker at all, framing the AMM gap as auth-only.
- Work required: Rewrite the YT-claim, yield-source, deploy-script, and worked-example claims to match the code. Add the float/wasm blocker to REMAINING.md. State plainly that yield is mocked.
- Risk if shipped as-is: High for credibility. A reviewer who reads the code will find the gaps fast.
- Estimated effort: 1 day.

---

3. Critical path to product completion (dependency-ordered, atomic)

1. Commit the integer-math AMM fix; remove libm; add a wasm float-opcode CI guard. (Everything downstream needs a deployable AMM.)
1. Fix the SDK simulation source account (use a funded G-account, not the market contract). (Every read depends on this.)
1. Fix and commit the deploy script (--yt_token); commit the real deploy script; pin the source commit. (Reproducible deploys.)
1. Redeploy all five contracts from a pinned commit to testnet; record addresses + commit hash.
1. Prove the PT/SY swap path on testnet with a real wallet, no mocks; seed AMM liquidity.
1. Prove the YT flash-route auth tree on testnet (debug the muxed-arg encoding); fix until accepted.
1. Add TTL bumps to SY/PT/YT/tokenizer; move YT checkpoints to persistent storage.
1. Rework PT/YT economics: PT redeems to principal; claim_yield actually pays YT from escrow; escrow-coverage invariant test. (This is the product.)
1. Make claim_yield transfer-safe (checkpoint both parties on YT transfer).
1. Cap redemption to recoverable underlying (insolvency guard) and define post-maturity YT settlement.
1. Integrate a real yield source (DeFindex adapter) so the exchange rate is backed; remove set_exchange_rate.
1. Full frontend verification pass against live contracts for every flow.
1. Reconcile README/ARCHITECTURE/REMAINING with the code.

Items 8 through 11 are the line between "demo" and "product."

---

4. What is NOT required for product completion

- Multiple maturities and rollover. One maturity is enough to be real.
- Protocol fee switch, governance, tokenomics.
- zap_out_at_maturity and other convenience wrappers.
- The Blend adapter specifically; DeFindex is the cheaper path to a real yield source. Pick one.
- Permissionless pools / "full Pendle" positioning.
- Any third-party audit, formal verification, or marketing artifact (these are downstream of the product working).
- Exposing the internal TWAP as an external oracle. Keep it display-only; that is less work and safer.
- Renaming the MAX*FLOAT_HELPER*\* constants is nice-to-have, not blocking.

---

5. Three-week sequencing (one contracts dev, realistic)

Assume ~15 working days, single-threaded on contracts, with the frontend fixes interleaved because they are small.

Week 1 (unblock and prove the existing core on testnet):

- Day 1: Commit float fix, drop libm, add wasm CI guard. Fix SDK simulation source.
- Day 2: Fix and commit deploy scripts; redeploy from a pinned commit; record addresses + hash.
- Days 3 to 4: Seed liquidity; prove PT/SY swap on testnet end to end with a wallet.
- Day 5: Prove the YT flash-route auth on testnet (muxed encoding). Buffer; this can slip.

Week 2 (make the yield real, the hard part):

- Days 6 to 9: Rework PT/YT economics. PT redeems to principal; claim_yield pays YT from escrow; transfer-safe checkpoints; escrow-coverage and conservation invariant tests.
- Day 10: Insolvency guard on redemption; post-maturity YT settlement decision.

Week 3 (back the yield and finish):

- Days 11 to 14: DeFindex SY adapter (deposit-through, rate read-through, redeem, paused/empty/decreasing-rate handling). This is tight; if the economics rework in Week 2 ran long, this is what slips.
- Day 15: TTL bumps + checkpoint storage move; frontend live verification pass; doc reconciliation.

What gets cut, honestly:

- The DeFindex integration is the most likely casualty. If economics (Week 2) overruns, you ship corrected PT/YT economics on a still-mocked-but-honestly-labeled rate, and DeFindex lands in week 4. That is the right cut: correct economics on a mock rate is a coherent testnet product; real yield on broken economics is not.
- Blend does not fit. Do not attempt it in three weeks.
- Upgradeability and monitoring do not fit and are not needed for a testnet product.
- The flash-route auth proof (Day 5) is the schedule risk inside Week 1; if the muxed encoding fights back, defer YT trading on the AMM and ship YT mint/claim/recombine (which do not need the AMM) while PT/SY trading works. The product still stands.

Realistic three-week landing: a deployable, reproducibly-deployed protocol where PT/SY trading works on testnet, PT and YT have correct economics, YT actually pays yield, redemption is solvency-guarded, and the rate is either DeFindex-backed (if Week 2 was clean) or honestly labeled as mocked. That is a real testnet product. The grant follows from that.

---

6. Mainnet readiness gap (informational, beyond the sprint)

- A real yield source fully integrated and battle-tested across paused/slashed/negative-rate states, not a mock.
- Third-party audit of the full system, with the flash-route auth tree and the economics rework as the focus areas.
- Reference-precision proofs (or fuzzing against a bignum oracle) for the integer ln/exp, plus property tests on the integer wasm path.
- Reentrancy guards if any non-trusted underlying is ever allowed.
- Upgradeability with a timelock, an address registry, and an admin-key ceremony (multisig custody, documented rotation).
- Solvency invariants enforced on-chain, not just tested.
- Monitoring and alerting: TTL expiry, vault solvency, oracle/rate sanity, contract liveness.
- A defined post-maturity lifecycle and a v2 rollover path.
- Economic review of LP impermanent-loss behavior and the anchor/scalar parameter choices under real volatility.

---

7. Open questions (need a human answer)

1. Was the live testnet AMM (CBQY...) deployed from the integer-math fix or the float version? If the latter, it cannot have uploaded, so what is actually at that address? This determines whether any testnet AMM exists at all.
1. Was the live AMM ever seeded with liquidity (SEED_AMM=1), or is it empty?
1. Where is the "resilient deploy" script that generated .env.local, and what commit did it build from?
1. Who holds the sidereal-deployer admin key, and is the same key admin on all five contracts?
1. Is the intended design that PT is fixed-principal and YT is the yield (standard Pendle), confirming the redemption math is a defect? Or was a deliberate divergence intended? The code and ARCHITECTURE.md:68 contradict each other, so I need the intent.
1. DeFindex or Blend as the first real yield source? This sets the Layer 2 effort and what fits in three weeks.
1. Is YT tradability on the AMM in scope for the sprint, or is YT mint/claim/recombine (no AMM) acceptable for the first product cut?

---

Two things I'd flag against the brief's framing. The flash route is not the "most fund-draining surface"; its auth entries are arg-scoped, so it is a liveness risk, not a drain. The real fund risk is the unbacked vault plus the inverted PT/YT economics. And the settlement is as real as you said for deposit/split/recombine/PT-redeem, but it is not real for YT yield: claim_yield moves no tokens, so the yield half of the protocol settles nothing today.
