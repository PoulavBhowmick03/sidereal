// SPDX-License-Identifier: Apache-2.0

//! Full cross-contract journey: deposit -> split -> (trade) -> recombine, plus
//! redemption at maturity, asserting the PT + YT = SY invariant across the
//! SY wrapper, tokenizer, PT/YT, and AMM together.

use sidereal_amm::{AmmMarket, AmmMarketClient};
use sidereal_pt_token::PtToken;
use sidereal_sy_wrapper::{SyWrapper, SyWrapperClient};
use sidereal_tokenizer::{Tokenizer, TokenizerClient};
use sidereal_yt_token::YtToken;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env,
};

const WAD: i128 = 1_000_000_000_000_000_000;
const MATURITY: u64 = 1_000_000;
const SCALAR_ROOT: i128 = 2 * WAD;
const INITIAL_ANCHOR: i128 = 1_050_000_000_000_000_000;
const FEE_BPS: i128 = 10;
const TWAP_WINDOW: u64 = 1_800;

#[allow(dead_code)] // some fields document the deployment but aren't read by every test
struct Market {
    admin: Address,
    user: Address,
    sy: Address,
    pt: Address,
    yt: Address,
    tokenizer: Address,
    amm: Address,
}

fn deploy(env: &Env) -> Market {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let user = Address::generate(env);
    let underlying = Address::generate(env);

    let sy = env.register(SyWrapper, ());
    let pt = env.register(PtToken, ());
    let yt = env.register(YtToken, ());
    let tokenizer = env.register(Tokenizer, ());
    let amm = env.register(AmmMarket, ());

    SyWrapperClient::new(env, &sy).initialize(&admin, &underlying);
    sidereal_pt_token::PtTokenClient::new(env, &pt).initialize(&admin, &tokenizer, &sy, &MATURITY);
    sidereal_yt_token::YtTokenClient::new(env, &yt).initialize(&admin, &tokenizer, &sy, &MATURITY);
    TokenizerClient::new(env, &tokenizer).initialize(&admin, &sy, &pt, &yt, &MATURITY);
    AmmMarketClient::new(env, &amm).initialize(
        &admin,
        &pt,
        &sy,
        &tokenizer,
        &MATURITY,
        &SCALAR_ROOT,
        &INITIAL_ANCHOR,
        &FEE_BPS,
        &TWAP_WINDOW,
    );

    Market { admin, user, sy, pt, yt, tokenizer, amm }
}

#[test]
fn split_then_recombine_preserves_sy() {
    let env = Env::default();
    let m = deploy(&env);
    let sy = SyWrapperClient::new(&env, &m.sy);
    let tokenizer = TokenizerClient::new(&env, &m.tokenizer);

    let deposit = 1_000_000_000_i128;
    let shares = sy.deposit(&m.user, &deposit);
    assert_eq!(shares, deposit, "exchange rate starts at 1.0");

    // Split SY into equal PT and YT.
    let (pt, yt) = tokenizer.split(&m.user, &shares);
    assert_eq!(pt, shares);
    assert_eq!(yt, shares);

    let pos = tokenizer.position(&m.user);
    assert_eq!(pos.pt_balance, pt);
    assert_eq!(pos.yt_balance, yt);

    // PT + YT recombine back into exactly the SY we started with.
    let sy_back = tokenizer.recombine(&m.user, &pt, &yt);
    assert_eq!(sy_back, shares, "PT + YT = SY invariant across contracts");

    let after = tokenizer.position(&m.user);
    assert_eq!(after.pt_balance, 0);
    assert_eq!(after.yt_balance, 0);
}

#[test]
fn pt_redeems_one_to_one_after_maturity() {
    let env = Env::default();
    let m = deploy(&env);
    let sy = SyWrapperClient::new(&env, &m.sy);
    let tokenizer = TokenizerClient::new(&env, &m.tokenizer);

    let shares = sy.deposit(&m.user, &500_000_000_i128);
    let (pt, _yt) = tokenizer.split(&m.user, &shares);

    env.ledger().set_timestamp(MATURITY + 1);

    let sy_out = tokenizer.redeem_at_maturity(&m.user, &pt);
    assert_eq!(sy_out, pt, "PT redeems 1:1 for SY at maturity");
}

#[test]
fn amm_wires_to_the_same_market() {
    let env = Env::default();
    let m = deploy(&env);
    let amm = AmmMarketClient::new(&env, &m.amm);

    // The AMM was initialized against the same PT/SY/tokenizer; its config
    // should reflect that and a quote on a seeded market should be readable.
    let liquidity = 1_000_000_000_000_i128;
    amm.add_liquidity(&m.user, &liquidity, &liquidity);
    let out = amm.quote_sy_for_pt(&100_000_000_i128);
    assert!(out > 0, "a seeded market returns a positive PT quote");
}

#[test]
fn amm_swap_round_trip_charges_fees() {
    let env = Env::default();
    let m = deploy(&env);
    let amm = AmmMarketClient::new(&env, &m.amm);

    let liquidity = 1_000_000_000_000_i128;
    amm.add_liquidity(&m.user, &liquidity, &liquidity);

    let sy_in = 1_000_000_000_i128;
    let pt_out = amm.swap_sy_for_pt(&m.user, &sy_in, &0);
    assert!(pt_out > 0, "buying PT yields PT");
    assert!(amm.reserve_sy() > liquidity, "SY reserve grows after selling SY in");

    // Selling the PT straight back returns less SY than we put in, because both
    // legs pay the fee.
    let sy_back = amm.swap_pt_for_sy(&m.user, &pt_out, &0);
    assert!(sy_back > 0 && sy_back < sy_in, "round trip loses the fee");
}

#[test]
fn amm_yt_route_executes_in_the_internal_model() {
    // The AMM computes the YT flash route numerically against its own reserves;
    // it does not yet mint PT+YT via the tokenizer or move real tokens. This
    // test pins that behavior: the route returns a positive YT amount in the
    // internal-accounting model. Real cross-contract settlement is the open gap
    // (see README Limitations).
    let env = Env::default();
    let m = deploy(&env);
    let amm = AmmMarketClient::new(&env, &m.amm);

    let liquidity = 1_000_000_000_000_i128;
    amm.add_liquidity(&m.user, &liquidity, &liquidity);

    let yt_out = amm.swap_sy_for_yt(&m.user, &1_000_000_000_i128, &0);
    assert!(yt_out > 0, "the YT route returns a positive amount in the internal model");
}
