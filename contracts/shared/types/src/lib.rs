// SPDX-License-Identifier: Apache-2.0

#![cfg_attr(target_family = "wasm", no_std)]

use soroban_sdk::{Address, Env};

/// Standardized Yield token interface exposed by tokenization contracts.
pub trait StandardizedYield {
    /// Deposits underlying from `from` and returns the amount of SY minted.
    fn deposit(env: &Env, from: Address, amount: i128) -> i128;

    /// Redeems SY from `from` and returns the amount of underlying released.
    fn redeem(env: &Env, from: Address, sy_amount: i128) -> i128;

    /// Returns SY per underlying, scaled to 18 decimals.
    fn exchange_rate(env: &Env) -> i128;

    /// Returns the underlying asset address.
    fn underlying(env: &Env) -> Address;

    /// Returns accrued yield for `holder`.
    fn accrued_yield(env: &Env, holder: Address) -> i128;
}

/// PT/SY market interface exposed by the AMM contract.
pub trait Market {
    /// Swaps PT into SY and returns the SY amount out.
    fn swap_pt_for_sy(env: &Env, from: Address, pt_in: i128, min_sy_out: i128) -> i128;

    /// Swaps SY into PT and returns the PT amount out.
    fn swap_sy_for_pt(env: &Env, from: Address, sy_in: i128, min_pt_out: i128) -> i128;

    /// Flash-routes a SY to YT swap and returns the YT amount out.
    fn swap_sy_for_yt(env: &Env, from: Address, sy_in: i128, min_yt_out: i128) -> i128;

    /// Flash-routes a YT to SY swap and returns the SY amount out.
    fn swap_yt_for_sy(env: &Env, from: Address, yt_in: i128, min_sy_out: i128) -> i128;

    /// Adds PT/SY liquidity and returns LP tokens minted.
    fn add_liquidity(env: &Env, from: Address, pt_in: i128, sy_in: i128) -> i128;

    /// Removes liquidity and returns PT and SY amounts out.
    fn remove_liquidity(env: &Env, from: Address, lp_in: i128) -> (i128, i128);

    /// Returns the internal implied APY in basis points.
    fn implied_apy(env: &Env) -> i128;

    /// Returns the market maturity as a Unix timestamp in seconds.
    fn maturity(env: &Env) -> u64;
}
