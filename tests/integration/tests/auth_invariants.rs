// SPDX-License-Identifier: Apache-2.0

//! Auth-tree invariants for the YT flash route (audit Layer 1, "flash-route
//! auth tree" finding).
//!
//! The audit's reframing is the key point: the flash route is a LIVENESS risk,
//! not a drain risk, BECAUSE every sub-invocation the AMM authorizes is pinned
//! to exact (contract, fn_name, args) including the exact amount. This file
//! locks that property in so a future change cannot loosen it into a
//! coerce-an-arbitrary-transfer hole.
//!
//! Ownership: the flash-route auth tree itself is Codex's lane. These tests are
//! the invariant Codex verifies the real (non-mock) auth tree against on
//! testnet. `flash_route_top_level_auth_is_arg_pinned` runs today and asserts
//! the user-facing entry is bound to exact args. `flash_route_user_only_signs_
//! the_swap` is the strict end-state and is #[ignore]d until the real auth tree
//! is wired (the MuxedAddress-vs-Address recipient encoding is the open item).

use sidereal_amm::{AmmMarket, AmmMarketClient};
use sidereal_pt_token::PtToken;
use sidereal_sy_wrapper::{SyWrapper, SyWrapperClient};
use sidereal_tokenizer::{Tokenizer, TokenizerClient};
use sidereal_yt_token::YtToken;
use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, MockAuth, MockAuthInvoke},
    Address, Env, IntoVal, Symbol, TryFromVal, Val, Vec as SVec,
};

const WAD: i128 = 1_000_000_000_000_000_000;
const MATURITY: u64 = 1_000_000;
const SCALAR_ROOT: i128 = 2 * WAD;
const INITIAL_ANCHOR: i128 = 1_050_000_000_000_000_000;
const FEE_BPS: i128 = 10;
const TWAP_WINDOW: u64 = 1_800;

struct Market {
    user: Address,
    sy: Address,
    amm: Address,
}

fn deploy(env: Env) -> Market {
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let underlying = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &underlying).mint(&user, &2_000_000_000_i128);

    let sy = env.register(SyWrapper, ());
    let pt = env.register(PtToken, ());
    let yt = env.register(YtToken, ());
    let tokenizer = env.register(Tokenizer, ());
    let amm = env.register(AmmMarket, ());

    SyWrapperClient::new(&env, &sy).initialize(&admin, &underlying);
    sidereal_pt_token::PtTokenClient::new(&env, &pt).initialize(&admin, &tokenizer, &sy, &MATURITY);
    sidereal_yt_token::YtTokenClient::new(&env, &yt).initialize(&admin, &tokenizer, &sy, &MATURITY);
    TokenizerClient::new(&env, &tokenizer).initialize(&admin, &sy, &pt, &yt, &MATURITY);
    AmmMarketClient::new(&env, &amm).initialize(
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

    // Seed AMM liquidity so the route can quote: deposit, split, add PT + SY.
    SyWrapperClient::new(&env, &sy).deposit(&user, &2_000_000_000_i128);
    TokenizerClient::new(&env, &tokenizer).split(&user, &1_000_000_000_i128);
    AmmMarketClient::new(&env, &amm).add_liquidity(&user, &800_000_000_i128, &800_000_000_i128);

    Market { user, sy, amm }
}

/// Recursively collect every contract sub-invocation in an authorization tree.
fn collect(inv: &AuthorizedInvocation, out: &mut std::vec::Vec<(Address, Symbol, SVec<Val>)>) {
    if let AuthorizedFunction::Contract((addr, sym, args)) = &inv.function {
        out.push((addr.clone(), sym.clone(), args.clone()));
    }
    for sub in &inv.sub_invocations {
        collect(sub, out);
    }
}

#[test]
fn flash_route_top_level_auth_is_arg_pinned() {
    let env = Env::default();
    let m = deploy(env.clone());
    // Allowing non-root (contract) auth lets the AMM self-authorize its internal
    // split/recombine/transfer sub-calls; the user-facing entry is still
    // recorded so we can assert it is bound to the exact arguments.
    env.mock_all_auths_allowing_non_root_auth();
    let amm = AmmMarketClient::new(&env, &m.amm);

    let sy_in = 1_000_000_i128;
    let min_yt_out = 1_i128;
    let yt_out = amm.swap_sy_for_yt(&m.user, &sy_in, &min_yt_out);
    assert!(yt_out > sy_in, "buying YT is leveraged");

    let mut calls = std::vec::Vec::new();
    for (_addr, inv) in env.auths().iter() {
        collect(inv, &mut calls);
    }

    let swap_sym = Symbol::new(&env, "swap_sy_for_yt");
    let swap = calls
        .iter()
        .find(|(addr, sym, _)| addr == &m.amm && sym == &swap_sym)
        .expect("the user must authorize swap_sy_for_yt on the AMM");

    // Arg-pinning: the authorization carries the EXACT sy_in and min_yt_out, so
    // it cannot be replayed for a different size.
    let auth_sy_in = i128::try_from_val(&env, &swap.2.get(1).expect("sy_in arg"))
        .expect("sy_in decodes to i128");
    let auth_min_out = i128::try_from_val(&env, &swap.2.get(2).expect("min_yt_out arg"))
        .expect("min_yt_out decodes to i128");
    assert_eq!(auth_sy_in, sy_in, "swap auth pinned to the exact SY input");
    assert_eq!(
        auth_min_out, min_yt_out,
        "swap auth pinned to the exact min YT out"
    );

    // No transfer the user authorizes may carry a non-positive (or wildcard)
    // amount: every money move in the tree is a concrete, pinned quantity.
    let transfer_sym = Symbol::new(&env, "transfer");
    for (_addr, sym, args) in calls.iter() {
        if sym == &transfer_sym {
            let amount = i128::try_from_val(&env, &args.get(args.len() - 1).expect("amount arg"))
                .expect("transfer amount decodes to i128");
            assert!(amount > 0, "authorized transfer amount must be concrete and positive");
        }
    }
}

/// Strict end-state: a user who authorizes ONLY the top-level swap (plus the
/// single SY transfer that funds it) can complete the flash route, because the
/// AMM scopes every other sub-call itself via authorize_as_current_contract.
///
/// This stays in CI so the flash route cannot regress to requiring users to
/// authorize AMM-internal split, recombine, mint, burn, or transfer calls.
#[test]
fn flash_route_user_only_signs_the_swap() {
    let env = Env::default();
    let m = deploy(env.clone());
    let amm = AmmMarketClient::new(&env, &m.amm);

    let sy_in = 1_000_000_i128;
    // The user authorizes exactly the swap and the SY transfer that funds it.
    // Every AMM-internal call is authorized by the AMM with exact args.
    env.mock_auths(&[MockAuth {
        address: &m.user,
        invoke: &MockAuthInvoke {
            contract: &m.amm,
            fn_name: "swap_sy_for_yt",
            args: (m.user.clone(), sy_in, 1_i128).into_val(&env),
            sub_invokes: &[MockAuthInvoke {
                contract: &m.sy,
                fn_name: "transfer",
                args: (m.user.clone(), m.amm.clone(), sy_in).into_val(&env),
                sub_invokes: &[],
            }],
        },
    }]);

    let yt_out = amm.swap_sy_for_yt(&m.user, &sy_in, &1_i128);
    assert!(
        yt_out > 0,
        "the user authorizing only the swap (plus its funding transfer) suffices"
    );
}
