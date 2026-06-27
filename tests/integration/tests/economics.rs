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

    fn redeem_pt(&self, who: &Address, pt_amount: i128) -> i128 {
        TokenizerClient::new(&self.env, &self.tokenizer).redeem_at_maturity(who, &pt_amount)
    }

    /// The YT yield-claim entrypoint. Phase 2 step 5 may move this onto the
    /// tokenizer and drop the explicit rate argument once the contract reads
    /// the SY rate itself. Update here in one place when it does.
    fn claim(&self, holder: &Address) -> i128 {
        let rate = self.rate();
        YtTokenClient::new(&self.env, &self.yt).claim_yield(holder, &rate)
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

    /// Asset-unit YT yield owed but unclaimed, summed over the known holders.
    fn yt_outstanding(&self, holders: &[&Address]) -> i128 {
        let yt = YtTokenClient::new(&self.env, &self.yt);
        let rate = self.rate();
        holders
            .iter()
            .map(|h| yt.preview_claim_yield(h, &rate))
            .sum::<i128>()
    }

    /// The hard invariant: escrow, valued at the current rate, must cover every
    /// outstanding PT at face plus every YT's unclaimed yield.
    fn assert_escrow_covers(&self, holders: &[&Address]) {
        let escrow_asset = self.escrow_shares() * self.rate() / WAD;
        let covered = self.pt_supply() + self.yt_outstanding(holders);
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
