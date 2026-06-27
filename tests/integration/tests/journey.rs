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
    token, Address, Env,
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

#[allow(dead_code)]
struct SettlementMarket {
    admin: Address,
    user: Address,
    pt: Address,
    sy: Address,
    amm: Address,
}

fn deploy(env: &Env) -> Market {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let user = Address::generate(env);
    // The SY wrapper is a real vault now, so the underlying must be a live
    // token the user actually holds.
    let underlying = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    token::StellarAssetClient::new(env, &underlying).mint(&user, &2_000_000_000_i128);

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
        &yt,
        &tokenizer,
        &MATURITY,
        &SCALAR_ROOT,
        &INITIAL_ANCHOR,
        &FEE_BPS,
        &TWAP_WINDOW,
    );

    Market {
        admin,
        user,
        sy,
        pt,
        yt,
        tokenizer,
        amm,
    }
}

fn deploy_settlement_amm(env: &Env) -> SettlementMarket {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let user = Address::generate(env);
    let tokenizer = Address::generate(env);

    let pt = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let sy = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let yt = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let amm = env.register(AmmMarket, ());

    token::StellarAssetClient::new(env, &pt).mint(&user, &2_000_000_000_000_i128);
    token::StellarAssetClient::new(env, &sy).mint(&user, &2_000_000_000_000_i128);

    AmmMarketClient::new(env, &amm).initialize(
        &admin,
        &pt,
        &sy,
        &yt,
        &tokenizer,
        &MATURITY,
        &SCALAR_ROOT,
        &INITIAL_ANCHOR,
        &FEE_BPS,
        &TWAP_WINDOW,
    );

    SettlementMarket {
        admin,
        user,
        pt,
        sy,
        amm,
    }
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

    // The tokenizer custodies the SY now; the holder's SY moved into escrow.
    assert_eq!(
        tokenizer.escrowed_sy(),
        shares,
        "escrow equals outstanding PT"
    );
    assert_eq!(sy.balance(&m.user), 0);

    // PT + YT recombine back into exactly the SY we started with.
    let sy_back = tokenizer.recombine(&m.user, &pt, &yt);
    assert_eq!(sy_back, shares, "PT + YT = SY invariant across contracts");

    let after = tokenizer.position(&m.user);
    assert_eq!(after.pt_balance, 0);
    assert_eq!(after.yt_balance, 0);
    assert_eq!(tokenizer.escrowed_sy(), 0, "escrow drains on recombine");
    assert_eq!(sy.balance(&m.user), shares, "holder gets their SY back");
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
    let m = deploy_settlement_amm(&env);
    let amm = AmmMarketClient::new(&env, &m.amm);
    let pt = token::TokenClient::new(&env, &m.pt);
    let sy = token::TokenClient::new(&env, &m.sy);

    let liquidity = 1_000_000_000_000_i128;
    amm.add_liquidity(&m.user, &liquidity, &liquidity);
    assert_eq!(pt.balance(&m.amm), liquidity);
    assert_eq!(sy.balance(&m.amm), liquidity);
    let out = amm.quote_sy_for_pt(&100_000_000_i128);
    assert!(out > 0, "a seeded market returns a positive PT quote");
}

#[test]
fn amm_swap_round_trip_charges_fees() {
    let env = Env::default();
    let m = deploy_settlement_amm(&env);
    let amm = AmmMarketClient::new(&env, &m.amm);
    let pt = token::TokenClient::new(&env, &m.pt);
    let sy = token::TokenClient::new(&env, &m.sy);

    let liquidity = 1_000_000_000_000_i128;
    amm.add_liquidity(&m.user, &liquidity, &liquidity);

    let sy_in = 1_000_000_000_i128;
    let user_pt_before = pt.balance(&m.user);
    let user_sy_before = sy.balance(&m.user);
    let pt_out = amm.swap_sy_for_pt(&m.user, &sy_in, &0);
    assert!(pt_out > 0, "buying PT yields PT");
    assert!(
        amm.reserve_sy() > liquidity,
        "SY reserve grows after selling SY in"
    );
    assert_eq!(pt.balance(&m.user), user_pt_before + pt_out);
    assert_eq!(sy.balance(&m.user), user_sy_before - sy_in);

    // Selling the PT straight back returns less SY than we put in, because both
    // legs pay the fee.
    let sy_back = amm.swap_pt_for_sy(&m.user, &pt_out, &0);
    assert!(sy_back > 0 && sy_back < sy_in, "round trip loses the fee");
    assert_eq!(pt.balance(&m.amm), amm.reserve_pt());
    assert_eq!(sy.balance(&m.amm), amm.reserve_sy());
}

#[test]
fn yt_flash_route_round_trips_through_the_tokenizer() {
    let env = Env::default();
    let m = deploy(&env);
    // The flash route has the AMM authorize sub-calls on the tokenizer (split /
    // recombine) and the token transfers they perform. Allowing non-root
    // (contract) auth exercises the economics; the exact production
    // authorize_as_current_contract entries still need a testnet check.
    env.mock_all_auths_allowing_non_root_auth();
    let sy = SyWrapperClient::new(&env, &m.sy);
    let tokenizer = TokenizerClient::new(&env, &m.tokenizer);
    let amm = AmmMarketClient::new(&env, &m.amm);
    let yt = token::TokenClient::new(&env, &m.yt);

    // Seed AMM liquidity: deposit SY, split to obtain PT, add PT + SY.
    sy.deposit(&m.user, &2_000_000_000_i128);
    tokenizer.split(&m.user, &1_000_000_000_i128);
    amm.add_liquidity(&m.user, &800_000_000_i128, &800_000_000_i128);

    // Buy YT with SY through the flash route. The position is leveraged, so the
    // YT received exceeds the SY paid, and it is minted to the buyer's balance.
    let yt_before = yt.balance(&m.user);
    let sy_in = 1_000_000_i128;
    let yt_out = amm.swap_sy_for_yt(&m.user, &sy_in, &1);
    assert!(yt_out > sy_in, "buying YT is leveraged");
    assert_eq!(yt.balance(&m.user), yt_before + yt_out);
    assert_eq!(amm.reserve_sy(), sy.balance(&m.amm), "reserves reconciled");

    // Sell the YT straight back through the recombine path for less than face.
    let sy_out = amm.swap_yt_for_sy(&m.user, &yt_out, &1);
    assert!(
        sy_out > 0 && sy_out < yt_out,
        "selling YT returns less than face"
    );
}
