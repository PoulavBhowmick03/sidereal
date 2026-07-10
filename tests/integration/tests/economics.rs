// SPDX-License-Identifier: Apache-2.0

//! Economics suite for the corrected PT/YT model (audit Layer 1 findings 3, 4,
//! and the post-maturity finding).
//!
//! Covers the intended Pendle-style behavior:
//!   - YT holders receive their accrued yield, paid in SY, on claim.
//!   - PT redeems to its asset face (principal at the maturity rate), not 1:1
//!     in SY shares.
//!   - Yield is conserved across transfers (no loss, no double count).
//!   - The escrow covers outstanding PT face plus unclaimed YT yield at every
//!     state transition, including a 10k-step random property test.
//!   - Insolvency: PT redemption is capped pro-rata on a rate regression; YT
//!     claims never freeze (the settle math pays zero on a dip, and banked
//!     yield stays payable).
//!   - The maturity rate is frozen, so post-maturity rate moves do not change
//!     redemption.
//!
//! These started as RED specs against the old code (PT redeemed 1:1, YT paid
//! nothing) and are now green. See docs/PROGRESS.md.

use sidereal_pt_token::{PtToken, PtTokenClient};
use sidereal_sy_wrapper::{SyWrapper, SyWrapperClient};
use sidereal_tokenizer::{Tokenizer, TokenizerClient};
use sidereal_yt_token::{YtToken, YtTokenClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env,
};

const WAD: i128 = 1_000_000_000_000_000_000;
/// One whole token at the 7-decimal underlying precision.
const UNIT: i128 = 10_000_000;
const MATURITY: u64 = 1_000_000;
const RATE_1_10: i128 = 1_100_000_000_000_000_000;

struct Market {
    env: Env,
    admin: Address,
    underlying: Address,
    sy: Address,
    pt: Address,
    yt: Address,
    tokenizer: Address,
}

fn deploy() -> Market {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    let underlying = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let sy = env.register(SyWrapper, ());
    let pt = env.register(PtToken, ());
    let yt = env.register(YtToken, ());
    let tokenizer = env.register(Tokenizer, ());

    SyWrapperClient::new(&env, &sy).initialize(&admin, &underlying);
    PtTokenClient::new(&env, &pt).initialize(&admin, &tokenizer, &sy, &MATURITY);
    YtTokenClient::new(&env, &yt).initialize(&admin, &tokenizer, &sy, &MATURITY);
    TokenizerClient::new(&env, &tokenizer).initialize(&admin, &sy, &pt, &yt, &MATURITY);

    Market {
        env,
        admin,
        underlying,
        sy,
        pt,
        yt,
        tokenizer,
    }
}

impl Market {
    /// Mints `amount` underlying to a fresh holder and returns their address.
    fn fund(&self, amount: i128) -> Address {
        let user = Address::generate(&self.env);
        token::StellarAssetClient::new(&self.env, &self.underlying).mint(&user, &amount);
        user
    }

    fn deposit(&self, who: &Address, amount: i128) -> i128 {
        SyWrapperClient::new(&self.env, &self.sy).deposit(who, &amount)
    }

    fn split(&self, who: &Address, sy_amount: i128) {
        TokenizerClient::new(&self.env, &self.tokenizer).split(who, &sy_amount);
    }

    /// A bare address that holds no underlying (it can still receive YT and be
    /// paid SY yield).
    fn account(&self) -> Address {
        Address::generate(&self.env)
    }

    fn transfer_yt(&self, from: &Address, to: &Address, amount: i128) {
        YtTokenClient::new(&self.env, &self.yt).transfer(from, to, &amount);
    }

    /// A holder burning their own YT directly on the YT contract (not through
    /// the tokenizer's recombine).
    fn burn_yt(&self, from: &Address, amount: i128) {
        YtTokenClient::new(&self.env, &self.yt).burn(from, &amount);
    }

    fn recombine(&self, who: &Address, amount: i128) -> i128 {
        TokenizerClient::new(&self.env, &self.tokenizer).recombine(who, &amount, &amount)
    }

    fn yt_balance(&self, who: &Address) -> i128 {
        YtTokenClient::new(&self.env, &self.yt).balance(who)
    }

    fn underlying_balance(&self, who: &Address) -> i128 {
        token::TokenClient::new(&self.env, &self.underlying).balance(who)
    }

    fn redeem_pt(&self, who: &Address, pt_amount: i128) -> i128 {
        TokenizerClient::new(&self.env, &self.tokenizer).redeem_at_maturity(who, &pt_amount)
    }

    fn maturity_rate(&self) -> i128 {
        TokenizerClient::new(&self.env, &self.tokenizer).maturity_rate()
    }

    /// Claims YT yield through the tokenizer, which pays SY out of escrow.
    fn claim(&self, holder: &Address) -> i128 {
        TokenizerClient::new(&self.env, &self.tokenizer).claim_yield(holder)
    }

    fn set_rate(&self, rate: i128) {
        SyWrapperClient::new(&self.env, &self.sy).set_exchange_rate(&self.admin, &rate);
    }

    /// Records the current SY rate as the tokenizer's latest pre-maturity
    /// observation (the permissionless poke). Tests that model "the rate at
    /// maturity is X" must call this after their final pre-maturity set_rate:
    /// the maturity freeze uses the last observed rate, never a live
    /// post-maturity read.
    fn observe(&self) -> i128 {
        TokenizerClient::new(&self.env, &self.tokenizer).observe_rate()
    }

    fn rate(&self) -> i128 {
        SyWrapperClient::new(&self.env, &self.sy).exchange_rate()
    }

    fn sy_balance(&self, who: &Address) -> i128 {
        SyWrapperClient::new(&self.env, &self.sy).balance(who)
    }

    /// SY shares the tokenizer custodies in escrow.
    fn escrow_shares(&self) -> i128 {
        SyWrapperClient::new(&self.env, &self.sy).balance(&self.tokenizer)
    }

    fn pt_balance(&self, who: &Address) -> i128 {
        PtTokenClient::new(&self.env, &self.pt).balance(who)
    }

    fn pt_supply(&self) -> i128 {
        PtTokenClient::new(&self.env, &self.pt).total_supply()
    }

    /// SY-share YT yield owed but unclaimed, summed over the known holders.
    fn yt_outstanding(&self, holders: &[&Address]) -> i128 {
        let yt = YtTokenClient::new(&self.env, &self.yt);
        holders
            .iter()
            .map(|h| yt.preview_claim_yield(h))
            .sum::<i128>()
    }

    /// The hard invariant: escrow, valued at the current rate, must cover every
    /// outstanding PT at face plus every YT's unclaimed yield. All terms are in
    /// asset units (YT yield is reported in SY shares, so convert at the rate).
    fn assert_escrow_covers(&self, holders: &[&Address]) {
        let rate = self.rate();
        let escrow_asset = self.escrow_shares() * rate / WAD;
        let yt_asset = self.yt_outstanding(holders) * rate / WAD;
        let covered = self.pt_supply() + yt_asset;
        assert!(
            escrow_asset >= covered,
            "escrow {} asset units must cover PT+YT claims {}",
            escrow_asset,
            covered
        );
    }
}

#[test]
fn yt_receives_yield_on_claim() {
    let m = deploy();
    let alice = m.fund(100 * UNIT);
    m.deposit(&alice, 100 * UNIT); // 100*UNIT SY shares at rate 1.0
    m.split(&alice, 100 * UNIT); // PT and YT, asset-denominated
    assert_eq!(m.sy_balance(&alice), 0, "split escrows all of Alice's SY");

    m.set_rate(RATE_1_10); // +10% accrues to YT holders

    let reported = m.claim(&alice);

    // Yield in asset units = 100*UNIT * 0.10 = 10*UNIT. Paid in SY at rate 1.10:
    // 10*UNIT * WAD / 1.10 = ~9.0909 * UNIT.
    let expected_sy = (10 * UNIT) * WAD / RATE_1_10;
    let got = m.sy_balance(&alice);
    assert!(
        (got - expected_sy).abs() <= 2,
        "YT holder should receive ~{} SY of yield, got {}",
        expected_sy,
        got
    );
    assert!(reported > 0, "claim should report the accrued amount");
}

#[test]
fn pt_redeems_to_principal_not_share() {
    let m = deploy();
    let alice = m.fund(100 * UNIT);
    m.deposit(&alice, 100 * UNIT);
    m.split(&alice, 100 * UNIT);
    let pt = m.pt_balance(&alice);

    m.set_rate(RATE_1_10);
    m.observe(); // pin 1.10 as the observed maturity rate
    m.env.ledger().set_timestamp(MATURITY + 1);

    let sy_out = m.redeem_pt(&alice, pt);

    // PT is principal: pt_amount * WAD / R_maturity SY, NOT pt_amount of shares.
    let expected = pt * WAD / RATE_1_10;
    assert!(
        (sy_out - expected).abs() <= 2,
        "PT should redeem to {} SY (principal at the maturity rate), got {}",
        expected,
        sy_out
    );
    assert!(
        sy_out < pt,
        "PT must not redeem 1:1 in shares when the rate has grown above 1.0"
    );
}

#[test]
fn escrow_covers_outstanding_claims() {
    let m = deploy();
    let alice = m.fund(50 * UNIT);
    let bob = m.fund(50 * UNIT);
    m.deposit(&alice, 50 * UNIT);
    m.deposit(&bob, 50 * UNIT);
    m.split(&alice, 50 * UNIT);
    m.split(&bob, 50 * UNIT);

    let holders = [&alice, &bob];
    m.assert_escrow_covers(&holders);

    m.set_rate(RATE_1_10);
    m.assert_escrow_covers(&holders);

    // Each holder claims YT yield and must actually receive SY for it.
    m.claim(&alice);
    assert!(
        m.sy_balance(&alice) > 0,
        "Alice must receive her YT yield in SY"
    );
    m.assert_escrow_covers(&holders);

    m.claim(&bob);
    assert!(m.sy_balance(&bob) > 0, "Bob must receive his YT yield in SY");
    m.assert_escrow_covers(&holders);

    // Both redeem PT at maturity; the invariant holds after each.
    m.env.ledger().set_timestamp(MATURITY + 1);
    m.redeem_pt(&alice, m.pt_balance(&alice));
    m.assert_escrow_covers(&holders);
    m.redeem_pt(&bob, m.pt_balance(&bob));

    // With every claim settled, escrow drains to ~0 (within rounding dust).
    assert!(
        m.escrow_shares() <= 4,
        "escrow should drain to ~0, {} shares left",
        m.escrow_shares()
    );
}

#[test]
fn redemption_uses_frozen_maturity_rate() {
    let m = deploy();
    let alice = m.fund(100 * UNIT);
    m.deposit(&alice, 100 * UNIT);
    m.split(&alice, 100 * UNIT);

    // The rate at maturity is 1.10, pinned by an observation.
    m.set_rate(RATE_1_10);
    m.observe();
    m.env.ledger().set_timestamp(MATURITY + 1);

    let half = 50 * UNIT;
    let expected = half * WAD / RATE_1_10;
    let sy1 = m.redeem_pt(&alice, half); // first post-maturity redeem snapshots 1.10
    assert!((sy1 - expected).abs() <= 4, "first redeem at the maturity rate");
    assert_eq!(m.maturity_rate(), RATE_1_10, "rate frozen at maturity");

    // The admin bumps the rate AFTER maturity; redemption must ignore it.
    let rate_1_20: i128 = 1_200_000_000_000_000_000;
    m.set_rate(rate_1_20);
    let sy2 = m.redeem_pt(&alice, half);
    assert!(
        (sy2 - expected).abs() <= 4,
        "post-maturity rate bump ignored: {} vs {}",
        sy2,
        expected
    );
}

/// The freeze-timing blocker: Blend has no maturity concept and keeps accruing
/// after maturity, so if the freeze read the live rate on first post-maturity
/// touch, a later first touch would pin a higher rate, moving value from PT to
/// YT and making redemption a race. The freeze must instead use the last rate
/// observed at or before maturity, no matter how late the first touch lands or
/// how far the live rate has drifted by then.
#[test]
fn freeze_ignores_post_maturity_accrual_even_on_late_first_touch() {
    let m = deploy();
    let alice = m.fund(100 * UNIT);
    m.deposit(&alice, 100 * UNIT);
    m.split(&alice, 100 * UNIT);

    // Pre-maturity accrual to 1.05, observed by the poke.
    let rate_1_05: i128 = 1_050_000_000_000_000_000;
    m.set_rate(rate_1_05);
    assert_eq!(m.observe(), rate_1_05);

    // Maturity passes with no on-chain touch, and the live source keeps
    // accruing well past it before anyone shows up.
    m.env.ledger().set_timestamp(MATURITY + 100_000);
    m.set_rate(RATE_1_10);

    // The late first touch must freeze the pre-maturity observation, not the
    // live 1.10 read.
    let pt = m.pt_balance(&alice);
    let sy_out = m.redeem_pt(&alice, pt);
    assert_eq!(m.maturity_rate(), rate_1_05, "frozen at the observation");
    let expected = pt * WAD / rate_1_05;
    assert!(
        (sy_out - expected).abs() <= 4,
        "redeemed at the observed 1.05, not the drifted 1.10: {} vs {}",
        sy_out,
        expected
    );
}

/// The audit gap in the first freeze cut: direct YT operations (transfer,
/// burn) settle yield at a rate the tokenizer never saw, because they read SY
/// directly. YT's ledger could then recognize yield at 1.10 while the freeze
/// later pinned 1.00, starving YT of already-banked yield and over-crediting
/// PT. Direct YT paths now resolve their rate THROUGH the tokenizer's
/// observe_rate, so any rate YT banks at is on record for the freeze.
#[test]
fn direct_yt_transfer_is_observed_by_the_maturity_freeze() {
    let m = deploy();
    let alice = m.fund(100 * UNIT);
    let bob = m.account();
    m.deposit(&alice, 100 * UNIT);
    m.split(&alice, 100 * UNIT); // tokenizer observes 1.00

    // Rate accrues to 1.10; the ONLY subsequent pre-maturity action is a
    // direct YT transfer. No tokenizer operation, no explicit poke. The
    // transfer settles Alice at 1.10, banking her yield, and must leave that
    // 1.10 on record for the freeze.
    m.set_rate(RATE_1_10);
    m.transfer_yt(&alice, &bob, UNIT);
    let yt = YtTokenClient::new(&m.env, &m.yt);
    let banked = yt.preview_claim_yield(&alice);
    assert!(banked > 0, "the transfer banked Alice's accrued yield at 1.10");

    m.env.ledger().set_timestamp(MATURITY + 1);

    // First post-maturity touch freezes the 1.10 the transfer observed, not
    // the older 1.00 from the split.
    let pt = m.pt_balance(&alice);
    let sy_out = m.redeem_pt(&alice, pt);
    assert_eq!(
        m.maturity_rate(),
        RATE_1_10,
        "the direct transfer's rate must be the frozen observation"
    );
    let expected = pt * WAD / RATE_1_10;
    assert!(
        (sy_out - expected).abs() <= 4,
        "PT redeems at the transfer-observed 1.10: {} vs {}",
        sy_out,
        expected
    );

    // And the yield the transfer banked is actually payable: at a frozen 1.10
    // the escrow holds a surplus over the PT reservation equal to the yield,
    // so Alice collects what her ledger recognized. Under the old gap (frozen
    // 1.00) the reservation would swallow the whole escrow and pay her zero.
    let claimed = m.claim(&alice);
    assert!(
        (banked - claimed).abs() <= 2,
        "banked yield is payable because the freeze saw the same rate it was banked at: banked {} vs claimed {}",
        banked,
        claimed
    );
}

/// Same gap, burn flavor: a holder burning their own YT directly settles
/// first, and that settle's rate must reach the freeze. The tokenizer-driven
/// burn (recombine) needs no observation of its own because recombine records
/// one in the same transaction; this covers the holder-direct path.
#[test]
fn direct_yt_burn_is_observed_by_the_maturity_freeze() {
    let m = deploy();
    let alice = m.fund(100 * UNIT);
    m.deposit(&alice, 100 * UNIT);
    m.split(&alice, 100 * UNIT); // tokenizer observes 1.00

    let rate_1_08: i128 = 1_080_000_000_000_000_000;
    m.set_rate(rate_1_08);
    m.burn_yt(&alice, UNIT); // direct burn, the only action at 1.08

    m.env.ledger().set_timestamp(MATURITY + 1);
    let pt = m.pt_balance(&alice);
    m.redeem_pt(&alice, pt);
    assert_eq!(
        m.maturity_rate(),
        rate_1_08,
        "the direct burn's settle rate must be the frozen observation"
    );
}

/// The unobserved tail is conservative in PT's favor, consistent with PT
/// seniority: rate moves after the last observation but before maturity are
/// not priced into the freeze unless someone (any keeper or YT holder, the
/// poke is permissionless) records them. Yield that IS observed pre-maturity
/// is pinned exactly.
#[test]
fn unobserved_pre_maturity_tail_freezes_at_the_last_observation() {
    let m = deploy();
    let alice = m.fund(100 * UNIT);
    m.deposit(&alice, 100 * UNIT);
    m.split(&alice, 100 * UNIT); // last mutating op observes rate 1.00

    // The rate climbs pre-maturity, but nothing observes it before maturity.
    let rate_1_08: i128 = 1_080_000_000_000_000_000;
    m.set_rate(rate_1_08);
    m.env.ledger().set_timestamp(MATURITY + 1);

    let pt = m.pt_balance(&alice);
    let sy_out = m.redeem_pt(&alice, pt);
    assert_eq!(
        m.maturity_rate(),
        WAD,
        "freeze falls back to the split-time observation, never a live post-maturity read"
    );
    // At the frozen 1.00 the full face is capped by pro-rata escrow coverage,
    // so PT redeems its escrow slice and no post-maturity read decided it.
    assert!(sy_out > 0);
}

/// Cross-contract maturity-rate consistency: the split-brain fix.
///
/// A matured market whose SY rate keeps drifting after maturity (idle
/// mock-custody mode, admin rate setter). PT redemption and YT yield must both
/// settle against the tokenizer's single canonical frozen rate, so the outcome
/// is identical whether PT is redeemed first or YT is claimed first.
///
/// Under the old split-brain, each contract froze its own rate on its own first
/// post-maturity call, so whichever action ran second pinned a later, different
/// rate. With PT-redeem-first that left the escrow unable to cover the (larger)
/// YT claim computed at the higher rate, which trapped; with YT-claim-first it
/// silently paid PT at the wrong rate. This test would fail (panic or mismatch)
/// on the old code and passes now that both read the one frozen rate.
#[test]
fn pt_redeem_and_yt_claim_use_one_frozen_rate_regardless_of_order() {
    const RATE_1_15: i128 = 1_150_000_000_000_000_000;
    const RATE_1_20: i128 = 1_200_000_000_000_000_000;

    // YT yield in SY shares for `bal` held from rate `c` to rate `r`, matching
    // the contract's telescoping form (floor division).
    fn owed(bal: i128, c: i128, r: i128) -> i128 {
        (bal * (r - c) / c) * WAD / r
    }

    // Runs one ordering and returns
    // (pt_redeem_sy, yt_claim_sy, escrow_left, tokenizer_frozen_rate).
    fn run(redeem_first: bool) -> (i128, i128, i128, i128) {
        let m = deploy();
        let alice = m.fund(100 * UNIT);
        m.deposit(&alice, 100 * UNIT);
        m.split(&alice, 100 * UNIT); // 100 UNIT PT + YT, checkpoint at rate 1.00

        // Rate climbs to 1.10 by maturity, observed, so YT has real accrued
        // yield to claim and the freeze has a pre-maturity rate to pin.
        m.set_rate(RATE_1_10);
        m.observe();
        m.env.ledger().set_timestamp(MATURITY + 1);

        // The SY rate is still drifting after maturity: it is 1.15 when the
        // first post-maturity action fires and 1.20 by the second. NONE of
        // that drift may reach redemption: the freeze must pin the observed
        // 1.10 for both PT and YT, regardless of which acts first or how far
        // the live rate has moved by then.
        m.set_rate(RATE_1_15);

        let pt = m.pt_balance(&alice);
        let redeem_sy;
        let claim_sy;
        if redeem_first {
            redeem_sy = m.redeem_pt(&alice, pt);
            m.set_rate(RATE_1_20);
            claim_sy = m.claim(&alice);
        } else {
            claim_sy = m.claim(&alice);
            m.set_rate(RATE_1_20);
            redeem_sy = m.redeem_pt(&alice, pt);
        }
        (redeem_sy, claim_sy, m.escrow_shares(), m.maturity_rate())
    }

    let a = run(true); // PT redeem first, then YT claim
    let b = run(false); // YT claim first, then PT redeem

    // Both orderings freeze the SAME canonical rate: the last pre-maturity
    // observation (1.10), never the 1.15 or 1.20 live at the post-maturity
    // touches. First-touch timing must be economically irrelevant.
    assert_eq!(a.3, RATE_1_10, "PT-first must freeze the observed rate");
    assert_eq!(b.3, RATE_1_10, "YT-first must freeze the observed rate");

    // Identical economic outcome regardless of order.
    assert_eq!(a.0, b.0, "PT redemption SY must not depend on order");
    assert_eq!(a.1, b.1, "YT claim SY must not depend on order");
    assert_eq!(a.0 + a.1, b.0 + b.1, "total SY paid out must not depend on order");
    assert_eq!(a.2, b.2, "escrow left must not depend on order");

    // The rate both contracts used equals the tokenizer's frozen maturity_rate:
    // cross-check the amounts against a 1.10 computation, and confirm the
    // drifted rates would differ, so the test fails if either contract read a
    // live post-maturity rate instead of the observation.
    let expected_redeem = 100 * UNIT * WAD / RATE_1_10;
    let expected_claim = owed(100 * UNIT, WAD, RATE_1_10);
    assert!(
        (a.0 - expected_redeem).abs() <= 4,
        "PT must redeem at the observed 1.10: {} vs {}",
        a.0,
        expected_redeem
    );
    assert!(
        (a.1 - expected_claim).abs() <= 4,
        "YT must claim at the observed 1.10: {} vs {}",
        a.1,
        expected_claim
    );
    assert!(
        (100 * UNIT * WAD / RATE_1_15 - expected_redeem).abs() > 4
            && (100 * UNIT * WAD / RATE_1_20 - expected_redeem).abs() > 4,
        "the drifted rates must differ from 1.10, else this test proves nothing"
    );
}

#[test]
fn redeem_allowed_at_exact_maturity() {
    let m = deploy();
    let alice = m.fund(100 * UNIT);
    m.deposit(&alice, 100 * UNIT);
    m.split(&alice, 100 * UNIT);

    m.env.ledger().set_timestamp(MATURITY); // exactly at maturity
    let pt = m.pt_balance(&alice);
    let out = m.redeem_pt(&alice, pt);
    assert!(out > 0, "redemption works at exactly the maturity timestamp");
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn split_rejects_at_exact_maturity() {
    let m = deploy();
    let alice = m.fund(100 * UNIT);
    m.deposit(&alice, 100 * UNIT);

    m.env.ledger().set_timestamp(MATURITY); // the market is no longer live
    m.split(&alice, 100 * UNIT);
}

#[test]
fn redemption_is_capped_when_rate_regresses() {
    let m = deploy();
    let alice = m.fund(100 * UNIT);
    let bob = m.fund(100 * UNIT);
    m.deposit(&alice, 100 * UNIT);
    m.deposit(&bob, 100 * UNIT);
    m.split(&alice, 100 * UNIT);
    m.split(&bob, 100 * UNIT);
    // Solvent: escrow 200 shares worth 200, PT principal 200, rate 1.00.

    // The yield source is slashed to 0.95: escrow now worth 190 < 200 of PT.
    // Observed pre-maturity, so the freeze prices the slash.
    let rate_0_95: i128 = 950_000_000_000_000_000;
    m.set_rate(rate_0_95);
    m.observe();
    m.env.ledger().set_timestamp(MATURITY + 1);

    let alice_pt = m.pt_balance(&alice);
    let full_uncapped = alice_pt * WAD / rate_0_95;
    let sy_alice = m.redeem_pt(&alice, alice_pt);
    assert!(
        sy_alice < full_uncapped,
        "redemption must be capped below full principal under insolvency: {} vs {}",
        sy_alice,
        full_uncapped
    );

    let bob_pt = m.pt_balance(&bob);
    let sy_bob = m.redeem_pt(&bob, bob_pt);

    // The shortfall is shared pro-rata: equal PT redeems for equal SY, and the
    // escrow drains to ~0 with no redeemer favored over another.
    assert!(
        (sy_alice - sy_bob).abs() <= 4,
        "loss shared equally: {} vs {}",
        sy_alice,
        sy_bob
    );
    assert!(
        m.escrow_shares() <= 4,
        "escrow drains, {} shares left",
        m.escrow_shares()
    );
}

/// Pendle alignment: on a rate regression the market is underwater, but the
/// collateral-neutral operations no longer revert. A new depositor can always
/// split (mint never blocks on coverage, like `PendleYieldToken._mintPY`), and
/// recombine prices the shortfall as a pro-rata haircut instead of bricking with
/// Insolvent (#9). Claims do not guard either; see the claim regression tests
/// below. This is exactly the state the frontend hit before the fix.
#[test]
fn split_and_recombine_survive_a_rate_regression() {
    let m = deploy();
    let alice = m.fund(100 * UNIT);
    m.deposit(&alice, 100 * UNIT);
    m.split(&alice, 100 * UNIT);
    // Solvent: escrow 100 shares worth 100 at rate 1.00, PT principal 100.

    // The yield source is slashed to 0.90: escrow is now worth 90 < 100 of PT.
    // This is the state that used to revert `split` with Insolvent (#9).
    let rate_0_90: i128 = 900_000_000_000_000_000;
    m.set_rate(rate_0_90);

    // A brand-new depositor can still mint. Split is collateral-neutral, so it
    // does not worsen coverage and must not revert.
    let bob = m.fund(50 * UNIT);
    m.deposit(&bob, 50 * UNIT);
    let bob_sy = m.sy_balance(&bob);
    m.split(&bob, bob_sy); // previously panicked with Error(Contract, #9)
    assert!(
        m.pt_balance(&bob) > 0,
        "a new depositor must be able to mint PT while the market is underwater"
    );

    // Recombine succeeds too, returning a fair haircut rather than reverting.
    // Alice's uncapped principal is pt/rate; underwater she gets her pro-rata
    // slice of escrow, which is strictly less. The preview must quote the
    // SAME capped number, not the uncapped principal, or the UI overpromises
    // during exactly the shortfall it matters most in.
    let alice_pt = m.pt_balance(&alice);
    let uncapped = alice_pt * WAD / rate_0_90;
    let quoted = TokenizerClient::new(&m.env, &m.tokenizer).preview_recombine(&alice_pt, &alice_pt);
    let got = m.recombine(&alice, alice_pt);
    assert!(
        got > 0 && got < uncapped,
        "recombine must haircut under a shortfall: got {} vs uncapped {}",
        got,
        uncapped
    );
    assert_eq!(
        quoted, got,
        "preview_recombine must quote the capped payout the recombine actually pays"
    );
}

/// The incident class Fix 1 was meant to end, on the claim path. With a
/// Blend-derived rate, split at rate exactly 1.00 leaves the escrow with zero
/// coverage slack, and a later redeem can tick the rate down by a sub-stroop
/// rounding notch (Blend's bToken burn rounds in the pool's favor). The old
/// post-claim solvency gate turned that dust into Insolvent (#9) on every
/// claim, even ones that owed nothing. Claims must instead succeed and pay
/// zero: the YT settle math holds the checkpoint on a dip.
#[test]
fn claim_yield_survives_a_sub_stroop_rate_regression() {
    let m = deploy();
    let alice = m.fund(100 * UNIT);
    m.deposit(&alice, 100 * UNIT);
    m.split(&alice, 100 * UNIT);
    // Zero slack: escrow 100 shares at rate exactly 1.00 backs exactly 100 PT.

    // The smallest representable regression; the Blend rounding notch at demo
    // scale (WAD minus 1e8) hits the same way, any dip below 1.00 did it.
    m.set_rate(WAD - 1);

    let previewed = YtTokenClient::new(&m.env, &m.yt).preview_claim_yield(&alice);
    assert_eq!(previewed, 0, "preview must report zero, not trap");

    let claimed = m.claim(&alice); // previously panicked with Error(Contract, #9)
    assert_eq!(claimed, 0, "no yield accrued, so the claim pays zero");
    assert_eq!(m.sy_balance(&alice), 0);
    assert_eq!(
        m.pt_supply(),
        100 * UNIT,
        "the claim must not touch principal"
    );
}

/// SY shares needed to redeem all outstanding PT at `rate`, rounded up the same
/// way the tokenizer's PT-senior cap reserves escrow. Kept local to the test so
/// the assertions recompute the reservation independently of the contract.
fn pt_face_reservation(pt_supply: i128, rate: i128) -> i128 {
    (pt_supply * WAD + rate - 1) / rate
}

/// PT is senior. When the escrow cannot even cover outstanding PT principal,
/// there is no surplus, so a YT claim pays zero. The unpaid yield is not
/// forfeited: it stays banked and claimable once coverage returns
/// (banked_yield_becomes_claimable_after_the_rate_recovers proves the recovery).
#[test]
fn yt_claim_is_subordinated_when_pt_is_under_covered() {
    let m = deploy();
    let alice = m.fund(100 * UNIT);
    let bob = m.account();
    m.deposit(&alice, 100 * UNIT);
    m.split(&alice, 100 * UNIT);

    // Rate rises; Alice banks her yield by moving 1 unit of YT (which settles
    // her at 1.10), then the yield source crashes below PT coverage.
    m.set_rate(RATE_1_10);
    m.transfer_yt(&alice, &bob, UNIT);
    let yt = YtTokenClient::new(&m.env, &m.yt);
    let owed_before = yt.preview_claim_yield(&alice);
    assert!(owed_before > 0, "Alice has banked yield to claim");

    let rate_0_90: i128 = 900_000_000_000_000_000;
    m.set_rate(rate_0_90);

    // Escrow (100 shares) at rate 0.90 covers only ~90 asset units of the 100
    // PT face, so the PT reservation exceeds the whole escrow: surplus is zero.
    assert!(
        pt_face_reservation(m.pt_supply(), rate_0_90) > m.escrow_shares(),
        "precondition: PT is under-covered, so there is no YT surplus"
    );

    let claimed = m.claim(&alice);
    assert_eq!(claimed, 0, "YT is subordinate to PT: no surplus, no payout");
    assert_eq!(m.sy_balance(&alice), 0, "nothing is paid out");
    assert_eq!(
        yt.preview_claim_yield(&alice),
        owed_before,
        "the unpaid yield stays banked, not forfeited"
    );
}

/// PT is senior but fully covered, leaving a surplus smaller than the YT's
/// banked yield. The claim takes exactly that surplus and no more, draining the
/// escrow down to the PT reservation. The remainder stays banked.
#[test]
fn yt_claim_takes_only_the_surplus_over_pt_reservation() {
    let m = deploy();
    let alice = m.fund(100 * UNIT);
    let bob = m.account();
    m.deposit(&alice, 100 * UNIT);
    m.split(&alice, 100 * UNIT);

    m.set_rate(RATE_1_10);
    m.transfer_yt(&alice, &bob, UNIT);
    let yt = YtTokenClient::new(&m.env, &m.yt);
    let owed_before = yt.preview_claim_yield(&alice);

    // Rate dips to 1.05. PT still fully coverable (~95.2 of 100 shares), leaving
    // a ~4.76-share surplus, below Alice's ~9.09 banked yield.
    let rate_1_05: i128 = 1_050_000_000_000_000_000;
    m.set_rate(rate_1_05);

    let escrow_before = m.escrow_shares();
    let reservation = pt_face_reservation(m.pt_supply(), rate_1_05);
    let surplus = escrow_before - reservation;
    assert!(
        surplus > 0 && surplus < owed_before,
        "precondition: partial surplus, less than owed ({} of {})",
        surplus,
        owed_before
    );

    let claimed = m.claim(&alice);
    assert_eq!(
        claimed, surplus,
        "the claim pays exactly the surplus over the PT reservation"
    );
    assert_eq!(
        m.escrow_shares(),
        reservation,
        "escrow is drained down to the PT reservation, so PT stays fully covered"
    );
    assert_eq!(
        yt.preview_claim_yield(&alice),
        owed_before - claimed,
        "the unpaid remainder stays banked"
    );
}

/// The transient-dip case the surplus cap must not punish: a claim during a dip
/// pays nothing, but once the rate recovers the previously-unpaid yield becomes
/// claimable in full. Conservation: Alice collects exactly what she was owed
/// across the dip and recovery, with no phantom yield from the round trip (the
/// checkpoint is a high-water mark, so the dip does not re-open accrual).
#[test]
fn banked_yield_becomes_claimable_after_the_rate_recovers() {
    let m = deploy();
    let alice = m.fund(100 * UNIT);
    let bob = m.account();
    m.deposit(&alice, 100 * UNIT);
    m.split(&alice, 100 * UNIT);

    m.set_rate(RATE_1_10);
    m.transfer_yt(&alice, &bob, UNIT);
    let yt = YtTokenClient::new(&m.env, &m.yt);
    let owed = yt.preview_claim_yield(&alice);
    assert!(owed > 0);

    // Deep dip: no surplus, so the claim pays nothing and banks the whole owed.
    m.set_rate(900_000_000_000_000_000);
    assert_eq!(m.claim(&alice), 0, "no surplus during the dip");
    assert_eq!(
        yt.preview_claim_yield(&alice),
        owed,
        "the full entitlement is still banked"
    );

    // Recovery restores the surplus; the banked yield is now claimable in full.
    m.set_rate(RATE_1_10);
    let claimed = m.claim(&alice);
    assert_eq!(
        claimed, owed,
        "the recovered payout equals the originally banked entitlement, no phantom yield"
    );
    assert_eq!(m.sy_balance(&alice), claimed);
    assert_eq!(
        yt.preview_claim_yield(&alice),
        0,
        "nothing left banked after the full payout"
    );
}

#[test]
fn transfer_conserves_yield_through_claims() {
    let m = deploy();
    let alice = m.fund(100 * UNIT);
    let bob = m.account(); // holds no underlying, only receives YT
    m.deposit(&alice, 100 * UNIT);
    m.split(&alice, 100 * UNIT); // 100 YT to Alice, checkpoint 1.00

    // Rate rises to 1.10, then Alice sends half her YT to Bob without claiming.
    // The transfer settles both: Alice banks her yield on 100 over 1.00->1.10,
    // Bob starts fresh at 1.10.
    m.set_rate(RATE_1_10);
    m.transfer_yt(&alice, &bob, 50 * UNIT);

    // Rate rises again to 1.20; now Alice earns on 50 and Bob earns on 50.
    let rate_1_20: i128 = 1_200_000_000_000_000_000;
    m.set_rate(rate_1_20);

    let claimed_alice = m.claim(&alice);
    let claimed_bob = m.claim(&bob);
    assert!(claimed_alice > 0 && claimed_bob > 0, "both earned yield");
    assert_eq!(m.sy_balance(&alice), claimed_alice);
    assert_eq!(m.sy_balance(&bob), claimed_bob);

    // Conservation: total yield paid equals what one 100-YT holder would have
    // earned over 1.00 -> 1.20. The transfer neither lost nor duplicated yield.
    // owed_shares = 100 * (1/1.00 - 1/1.20) * WAD.
    let asset_yield = (100 * UNIT) * (rate_1_20 - WAD) / WAD;
    let single_holder = asset_yield * WAD / rate_1_20;
    assert!(
        (claimed_alice + claimed_bob - single_holder).abs() <= 4,
        "claimed {} + {} should equal single-holder {}",
        claimed_alice,
        claimed_bob,
        single_holder
    );

    // No PT was redeemed, so escrow still exactly covers the 100 units of
    // principal and nothing more (all yield was claimed out).
    let escrow_asset = m.escrow_shares() * m.rate() / WAD;
    assert!(
        (escrow_asset - 100 * UNIT).abs() <= 4,
        "escrow should hold only principal, {} asset units",
        escrow_asset
    );
}

/// Deterministic LCG so the random sequence is reproducible.
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Rng(seed)
    }
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

/// Step 10: conservation across a long random sequence of split / transfer /
/// claim / recombine, with a monotonically rising rate, then full drain at
/// maturity. The escrow-coverage invariant must hold at every step (the
/// contract also asserts the PT half on every mutation), and the escrow must
/// drain to dust once everyone has claimed and redeemed. The economics code is
/// pure integer math, so the native test path and the wasm path are identical.
#[test]
fn conservation_holds_across_random_sequences() {
    const N: u64 = 10_000;
    let m = deploy();
    let holders: std::vec::Vec<Address> = (0..3).map(|_| m.fund(1_000_000 * UNIT)).collect();
    let refs: std::vec::Vec<&Address> = holders.iter().collect();
    let mut rng = Rng::new(0xC0FFEE);
    let mut rate = WAD;
    let mut value_ops: i128 = 0;

    for _ in 0..N {
        let h = &holders[rng.below(holders.len() as u64) as usize];
        match rng.below(5) {
            0 => {
                // deposit a random amount, then split all the SY now held
                let amt = (1 + rng.below(50)) as i128 * UNIT;
                if m.underlying_balance(h) >= amt {
                    m.deposit(h, amt);
                    let sy = m.sy_balance(h);
                    if sy > 0 {
                        m.split(h, sy);
                        value_ops += 1;
                    }
                }
            }
            1 => {
                // transfer a portion of YT to another holder
                let bal = m.yt_balance(h);
                if bal > 1 {
                    let to = &holders[rng.below(holders.len() as u64) as usize];
                    let amount = 1 + (rng.below(bal as u64) as i128);
                    if amount <= bal {
                        m.transfer_yt(h, to, amount);
                    }
                }
            }
            2 => {
                m.claim(h);
                value_ops += 1;
            }
            3 => {
                // recombine equal PT and YT
                let pt = m.pt_balance(h);
                let yt = m.yt_balance(h);
                let max = if pt < yt { pt } else { yt };
                if max > 0 {
                    let amount = 1 + (rng.below(max as u64) as i128);
                    if amount <= max {
                        m.recombine(h, amount);
                        value_ops += 1;
                    }
                }
            }
            _ => {
                // bump the rate up by 0 to ~2%
                rate += (rng.below(20_000_000_000_000_000) + 1) as i128;
                m.set_rate(rate);
            }
        }

        m.assert_escrow_covers(&refs);
    }

    // Drain everything at maturity: claim all yield, then redeem all PT.
    m.env.ledger().set_timestamp(MATURITY + 1);
    for h in &holders {
        m.claim(h);
    }
    m.assert_escrow_covers(&refs);
    for h in &holders {
        let pt = m.pt_balance(h);
        if pt > 0 {
            m.redeem_pt(h, pt);
            value_ops += 1;
        }
    }

    // The real conservation proof is that assert_escrow_covers held at every one
    // of the N steps above: the escrow was never short, so no holder could be
    // underpaid, and every claim/redeem transfer succeeded. What remains is pure
    // floor-rounding excess that stays stuck in escrow (the safe direction): each
    // value-moving op rounds a division down by less than ~2 shares, so the
    // leftover is bounded linearly by the op count, not by the values involved.
    // Measured ~1.15 shares per op; bound at 2 with a margin.
    let left = m.escrow_shares();
    assert!(
        left <= 2 * value_ops + 16,
        "leftover escrow {} exceeds the rounding-dust bound for {} value ops",
        left,
        value_ops
    );
}
