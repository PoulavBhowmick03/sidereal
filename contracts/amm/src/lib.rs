// SPDX-License-Identifier: Apache-2.0

#![cfg_attr(target_family = "wasm", no_std)]

use sidereal_shared_types::Market;
use soroban_sdk::{contract, contractimpl, Address, Env};

#[contract]
pub struct AmmMarket;

#[contractimpl]
impl AmmMarket {
    pub fn swap_pt_for_sy(env: Env, from: Address, pt_in: i128, min_sy_out: i128) -> i128 {
        <Self as Market>::swap_pt_for_sy(&env, from, pt_in, min_sy_out)
    }

    pub fn swap_sy_for_pt(env: Env, from: Address, sy_in: i128, min_pt_out: i128) -> i128 {
        <Self as Market>::swap_sy_for_pt(&env, from, sy_in, min_pt_out)
    }

    pub fn swap_sy_for_yt(env: Env, from: Address, sy_in: i128, min_yt_out: i128) -> i128 {
        <Self as Market>::swap_sy_for_yt(&env, from, sy_in, min_yt_out)
    }

    pub fn swap_yt_for_sy(env: Env, from: Address, yt_in: i128, min_sy_out: i128) -> i128 {
        <Self as Market>::swap_yt_for_sy(&env, from, yt_in, min_sy_out)
    }

    pub fn add_liquidity(env: Env, from: Address, pt_in: i128, sy_in: i128) -> i128 {
        <Self as Market>::add_liquidity(&env, from, pt_in, sy_in)
    }

    pub fn remove_liquidity(env: Env, from: Address, lp_in: i128) -> (i128, i128) {
        <Self as Market>::remove_liquidity(&env, from, lp_in)
    }

    pub fn implied_apy(env: Env) -> i128 {
        <Self as Market>::implied_apy(&env)
    }

    pub fn maturity(env: Env) -> u64 {
        <Self as Market>::maturity(&env)
    }
}

impl Market for AmmMarket {
    fn swap_pt_for_sy(_env: &Env, _from: Address, _pt_in: i128, _min_sy_out: i128) -> i128 {
        implementation_pending()
    }

    fn swap_sy_for_pt(_env: &Env, _from: Address, _sy_in: i128, _min_pt_out: i128) -> i128 {
        implementation_pending()
    }

    fn swap_sy_for_yt(_env: &Env, _from: Address, _sy_in: i128, _min_yt_out: i128) -> i128 {
        implementation_pending()
    }

    fn swap_yt_for_sy(_env: &Env, _from: Address, _yt_in: i128, _min_sy_out: i128) -> i128 {
        implementation_pending()
    }

    fn add_liquidity(_env: &Env, _from: Address, _pt_in: i128, _sy_in: i128) -> i128 {
        implementation_pending()
    }

    fn remove_liquidity(_env: &Env, _from: Address, _lp_in: i128) -> (i128, i128) {
        implementation_pending()
    }

    fn implied_apy(_env: &Env) -> i128 {
        implementation_pending()
    }

    fn maturity(_env: &Env) -> u64 {
        implementation_pending()
    }
}

fn implementation_pending() -> ! {
    panic!("AMM implementation pending")
}
