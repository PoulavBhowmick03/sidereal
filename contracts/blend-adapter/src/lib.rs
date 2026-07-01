// SPDX-License-Identifier: Apache-2.0
#![cfg_attr(target_family = "wasm", no_std)]

//! Blend yield-source adapter for the Sidereal SY wrapper.
//!
//! This is Fix 2 from `docs/BLEND_INTEGRATION.md`: replace the admin-set SY rate
//! with a rate derived from a real Blend pool position, so it moves only with
//! actual accrued interest and cannot be arbitrarily lowered (the root cause of
//! the `#9 Insolvent` incident).
//!
//! This pass implements and tests the **rate-derivation math** — the part most
//! likely to hold a subtle scaling bug. The cross-contract wiring
//! (`supply`/`withdraw`/`get_positions` calls into the live Blend pool) and its
//! no-mock testnet authorization proof are the remaining work; see the doc.

use soroban_sdk::{contractclient, contracttype, Address, Env, Map, Vec};

/// Minimal bindings for the deployed Blend v2 pool interface used by Sidereal.
///
/// These types are generated from the live testnet pool contract spec. The
/// published `blend-contract-sdk` currently depends on Soroban SDK 25 while
/// Sidereal is pinned to 26.1, so importing that crate would create incompatible
/// SDK types. Keep this surface limited to the four calls the wrapper needs.
#[contractclient(name = "BlendPoolClient")]
pub trait BlendPool {
    fn get_reserve_list(env: Env) -> Vec<Address>;
    fn get_reserve(env: Env, asset: Address) -> Reserve;
    fn get_positions(env: Env, address: Address) -> Positions;
    fn submit(
        env: Env,
        from: Address,
        spender: Address,
        to: Address,
        requests: Vec<Request>,
    ) -> Positions;
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Request {
    pub address: Address,
    pub amount: i128,
    pub request_type: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Positions {
    pub collateral: Map<u32, i128>,
    pub liabilities: Map<u32, i128>,
    pub supply: Map<u32, i128>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Reserve {
    pub asset: Address,
    pub config: ReserveConfig,
    pub data: ReserveData,
    pub scalar: i128,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct ReserveConfig {
    pub c_factor: u32,
    pub decimals: u32,
    pub enabled: bool,
    pub index: u32,
    pub l_factor: u32,
    pub max_util: u32,
    pub r_base: u32,
    pub r_one: u32,
    pub r_three: u32,
    pub r_two: u32,
    pub reactivity: u32,
    pub supply_cap: i128,
    pub util: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct ReserveData {
    pub b_rate: i128,
    pub b_supply: i128,
    pub backstop_credit: i128,
    pub d_rate: i128,
    pub d_supply: i128,
    pub ir_mod: i128,
    pub last_time: u64,
}

/// WAD: SY exchange-rate fixed-point scale (asset-per-share, 18 decimals),
/// matching `sy-wrapper`.
pub const WAD: i128 = 1_000_000_000_000_000_000;

/// Blend scales `reserve.data.b_rate` to 12 decimals (`SCALAR_12`). Verified
/// against `blend-contracts-v2` `pool/src/pool/reserve.rs`:
/// `to_asset_from_b_token = b_tokens.fixed_mul_floor(b_rate, SCALAR_12)`.
pub const BLEND_SCALAR_12: i128 = 1_000_000_000_000;

/// Blend `RequestType` discriminants we use (from `pool/src/pool/actions.rs`).
/// Plain `Supply` (not `SupplyCollateral`) keeps the position liquid and never
/// seizable, since the wrapper never borrows.
pub const REQUEST_SUPPLY: u32 = 0;
pub const REQUEST_WITHDRAW: u32 = 1;

/// The seam the SY wrapper depends on. A Blend implementation fulfills these by
/// cross-calling the pool's `submit` / `get_positions` / `get_reserve`; the SY
/// wrapper then derives its rate as `assets_under_management * WAD / sy_supply`.
///
/// Not exercised in this crate's tests (it needs a live pool or a mock contract);
/// it pins the interface the wiring must satisfy.
pub trait YieldAdapter {
    /// Supply `amount` of the underlying (already custodied) into the source.
    fn supply(env: &Env, amount: i128);
    /// Withdraw underlying worth `amount` from the source back to the wrapper.
    /// Returns the underlying actually released (may be less on a liquidity cap).
    fn withdraw(env: &Env, amount: i128) -> i128;
    /// Underlying the wrapper's whole position is currently worth (7-dec units).
    fn assets_under_management(env: &Env) -> i128;
    /// The underlying asset the source consumes (the pool's reserve asset).
    fn underlying(env: &Env) -> Address;
}

/// Convert a Blend bToken balance to its underlying asset value, using the
/// reserve's `b_rate` (12-decimal). `assets = b_tokens * b_rate / SCALAR_12`,
/// floored, matching Blend's `to_asset_from_b_token`. Checked; `None` on overflow.
pub fn assets_from_b_tokens(b_tokens: i128, b_rate: i128) -> Option<i128> {
    b_tokens
        .checked_mul(b_rate)
        .map(|v| v / BLEND_SCALAR_12)
}

/// The SY exchange rate (asset-per-share, WAD) derived from the vault's real
/// holdings: `aum * WAD / sy_supply`. Returns WAD when no SY is outstanding
/// (bootstrap). Because `aum` tracks a Blend position whose value only rises with
/// accrued interest, this rate is monotonic under normal operation — no admin can
/// lower it, which is the whole point. Checked; `None` on overflow.
pub fn derived_exchange_rate(aum: i128, sy_supply: i128) -> Option<i128> {
    if sy_supply <= 0 {
        return Some(WAD);
    }
    aum.checked_mul(WAD).map(|v| v / sy_supply)
}

/// Inverse of [`assets_from_b_tokens`]: the bTokens Blend credits for supplying
/// `assets` of underlying at the reserve's `b_rate`. `b_tokens = assets * SCALAR_12
/// / b_rate`, floored (Blend rounds in the pool's favor). Checked; `None` on
/// overflow or non-positive rate.
pub fn b_tokens_from_assets(assets: i128, b_rate: i128) -> Option<i128> {
    if b_rate <= 0 {
        return None;
    }
    assets.checked_mul(BLEND_SCALAR_12).map(|v| v / b_rate)
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::*;

    const UNIT: i128 = 10_000_000; // 1.0 with 7 decimals, like Stellar USDC/SY.

    #[test]
    fn b_tokens_convert_at_unit_rate_one_to_one() {
        // b_rate 1.0 (12-dec) => bTokens equal underlying, no interest yet.
        let assets = assets_from_b_tokens(100 * UNIT, BLEND_SCALAR_12).unwrap();
        assert_eq!(assets, 100 * UNIT);
    }

    #[test]
    fn b_tokens_convert_with_accrued_interest() {
        // b_rate 1.10 => 100 bTokens are worth 110 underlying (10% interest).
        let b_rate = 1_100_000_000_000; // 1.10 in 12-dec
        let assets = assets_from_b_tokens(100 * UNIT, b_rate).unwrap();
        assert_eq!(assets, 110 * UNIT);
    }

    #[test]
    fn derived_rate_reflects_aum_over_supply() {
        // Vault holds 110 underlying, 100 SY outstanding => 1 SY = 1.10 (WAD).
        let rate = derived_exchange_rate(110 * UNIT, 100 * UNIT).unwrap();
        assert_eq!(rate, 1_100_000_000_000_000_000);
    }

    #[test]
    fn derived_rate_bootstraps_to_wad_when_empty() {
        assert_eq!(derived_exchange_rate(0, 0).unwrap(), WAD);
        assert_eq!(derived_exchange_rate(50 * UNIT, 0).unwrap(), WAD);
    }

    #[test]
    fn derived_rate_is_monotonic_as_interest_accrues() {
        // Same SY supply; as the Blend position's asset value grows, the rate
        // only rises. This is the property that makes `#9` impossible: nobody can
        // set it down, and YT yield tracks the increase.
        let supply = 100 * UNIT;
        let r0 = derived_exchange_rate(100 * UNIT, supply).unwrap();
        let r1 = derived_exchange_rate(105 * UNIT, supply).unwrap();
        let r2 = derived_exchange_rate(120 * UNIT, supply).unwrap();
        assert_eq!(r0, WAD);
        assert!(r1 > r0 && r2 > r1, "rate must rise with AUM: {r0} {r1} {r2}");
    }

    #[test]
    fn end_to_end_supply_then_accrual() {
        // Deposit 100 USDC: at b_rate 1.0 the pool credits ~100 bTokens, and with
        // 100 SY minted the rate is 1.0. Interest lifts b_rate to 1.05 => AUM 105
        // => rate 1.05, exactly the yield that accrues to YT holders.
        let b_tokens = 100 * UNIT;
        let sy_supply = 100 * UNIT;
        let rate_at_deposit =
            derived_exchange_rate(assets_from_b_tokens(b_tokens, BLEND_SCALAR_12).unwrap(), sy_supply)
                .unwrap();
        assert_eq!(rate_at_deposit, WAD);

        let b_rate_later = 1_050_000_000_000; // 1.05
        let aum_later = assets_from_b_tokens(b_tokens, b_rate_later).unwrap();
        let rate_later = derived_exchange_rate(aum_later, sy_supply).unwrap();
        assert_eq!(rate_later, 1_050_000_000_000_000_000);
    }

    #[test]
    fn overflow_is_reported_not_panicked() {
        assert_eq!(assets_from_b_tokens(i128::MAX, 2), None);
        assert_eq!(derived_exchange_rate(i128::MAX, 1), None);
    }

    #[test]
    fn b_tokens_from_assets_inverts_the_conversion() {
        // Supplying at b_rate 1.0 credits 1:1; at 1.2, 60 underlying buys 50 bTokens.
        assert_eq!(b_tokens_from_assets(100 * UNIT, BLEND_SCALAR_12).unwrap(), 100 * UNIT);
        assert_eq!(b_tokens_from_assets(60 * UNIT, 1_200_000_000_000).unwrap(), 50 * UNIT);
        assert_eq!(b_tokens_from_assets(1, 0), None);
    }

    /// Full accounting model of a Blend-backed SY vault: a supplier deposits, a
    /// second supplier joins after interest accrues, then one redeems. The point
    /// being proven: the derived rate equals the real b_rate ratio, is invariant
    /// under supply and redeem (those move bTokens and SY by matched amounts), and
    /// only ever rises with accrued interest. That is exactly the property that
    /// makes the `#9 Insolvent` freeze impossible: nobody can lower the rate, and a
    /// rate that only rises can never leave the escrow short of PT.
    #[test]
    fn full_accounting_round_trips_and_keeps_rate_honest() {
        // 1) Alice supplies 100 at b_rate 1.0, minting 100 SY. Rate = 1.00.
        let mut b_rate = BLEND_SCALAR_12; // 1.0 in 12-dec
        let mut b_tokens = b_tokens_from_assets(100 * UNIT, b_rate).unwrap();
        let mut sy_supply = 100 * UNIT;
        assert_eq!(b_tokens, 100 * UNIT);
        assert_eq!(
            derived_exchange_rate(assets_from_b_tokens(b_tokens, b_rate).unwrap(), sy_supply).unwrap(),
            WAD
        );

        // 2) Interest accrues: b_rate 1.0 -> 1.2. bTokens are unchanged, but the
        //    position is now worth 120, so the rate rises to 1.20 (all of it YT yield).
        b_rate = 1_200_000_000_000; // 1.2
        let aum = assets_from_b_tokens(b_tokens, b_rate).unwrap();
        assert_eq!(aum, 120 * UNIT);
        assert_eq!(derived_exchange_rate(aum, sy_supply).unwrap(), 1_200_000_000_000_000_000);

        // 3) Bob supplies 60 at the current b_rate 1.2 -> 50 bTokens, minting SY at
        //    the current rate 1.2: 60/1.2 = 50 SY. The rate must not move: he paid
        //    fair value in.
        let bob_b = b_tokens_from_assets(60 * UNIT, b_rate).unwrap();
        assert_eq!(bob_b, 50 * UNIT);
        b_tokens += bob_b;
        sy_supply += 50 * UNIT; // 60 underlying / rate 1.2 = 50 SY
        let aum = assets_from_b_tokens(b_tokens, b_rate).unwrap();
        assert_eq!(aum, 180 * UNIT);
        assert_eq!(derived_exchange_rate(aum, sy_supply).unwrap(), 1_200_000_000_000_000_000);

        // 4) Alice redeems 30 SY at rate 1.2 -> 36 underlying withdrawn -> burns
        //    36/1.2 = 30 bTokens. Matched reduction, so the rate is still 1.20.
        let redeem_sy = 30 * UNIT;
        let underlying_out = redeem_sy * 1_200_000_000_000_000_000 / WAD; // sy * rate / WAD
        assert_eq!(underlying_out, 36 * UNIT);
        let burned_b = b_tokens_from_assets(underlying_out, b_rate).unwrap();
        assert_eq!(burned_b, 30 * UNIT);
        b_tokens -= burned_b;
        sy_supply -= redeem_sy;
        let aum = assets_from_b_tokens(b_tokens, b_rate).unwrap();
        assert_eq!(aum, 144 * UNIT); // (150 - 30) bTokens * 1.2
        assert_eq!(derived_exchange_rate(aum, sy_supply).unwrap(), 1_200_000_000_000_000_000);
    }
}
