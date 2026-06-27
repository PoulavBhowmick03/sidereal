// SPDX-License-Identifier: Apache-2.0

//! Phase 1 failing specs for the corrected PT/YT economics
//! (audit Layer 1, findings 3 and 4: "PT captures yield, YT pays nothing" and
//! the escrow-coverage gap).
//!
//! These assert the INTENDED Pendle-style behavior:
//!   - YT holders receive their accrued yield, paid in SY, on claim.
//!   - PT redeems to its asset face (principal at the maturity rate), not 1:1
//!     in SY shares.
//!   - The tokenizer escrow always covers outstanding PT face plus unclaimed
//!     YT yield, at every state transition.
//!
//! They are RED against the current code, which pays YT nothing (claim_yield
//! moves no tokens) and redeems PT 1:1 in shares. Phase 2 turns them green.
//! See docs/PROGRESS.md for the plan.

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

    fn redeem_pt(&self, who: &Address, pt_amount: i128) -> i128 {
        TokenizerClient::new(&self.env, &self.tokenizer).redeem_at_maturity(who, &pt_amount)
    }

    /// Claims YT yield through the tokenizer, which pays SY out of escrow.
    fn claim(&self, holder: &Address) -> i128 {
        TokenizerClient::new(&self.env, &self.tokenizer).claim_yield(holder)
    }

    fn set_rate(&self, rate: i128) {
        SyWrapperClient::new(&self.env, &self.sy).set_exchange_rate(&self.admin, &rate);
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
