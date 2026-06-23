// SPDX-License-Identifier: Apache-2.0

#![cfg_attr(target_family = "wasm", no_std)]

use core::cmp::min;

use libm::{exp, floor, log, sqrt};
use sidereal_shared_types::Market;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env,
};

const WAD: i128 = 1_000_000_000_000_000_000;
const BPS_DENOMINATOR: i128 = 10_000;
const DAY: u64 = 86_400;
const IMPLIED_RATE_TIME: u64 = 365 * DAY;
const MINIMUM_LIQUIDITY: i128 = 1_000;
const MAX_MARKET_PROPORTION: i128 = (WAD * 96) / 100;

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Config {
    pub admin: Address,
    pub pt_token: Address,
    pub sy_token: Address,
    pub tokenizer: Address,
    pub maturity: u64,
    pub scalar_root: i128,
    pub initial_anchor: i128,
    pub fee_bps: i128,
    pub twap_window: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct State {
    pub total_pt: i128,
    pub total_sy: i128,
    pub total_lp: i128,
    pub last_ln_implied_rate: i128,
    pub twap_ln_implied_rate: i128,
    pub last_observation: u64,
    pub warmup_until: u64,
}

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Config,
    State,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
#[contracterror]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidMaturity = 3,
    InvalidAmount = 4,
    InvalidScalarRoot = 5,
    InvalidAnchor = 6,
    InvalidFee = 7,
    InvalidTwapWindow = 8,
    MarketNotSeeded = 9,
    MarketMatured = 10,
    SlippageExceeded = 11,
    InsufficientLiquidity = 12,
    MathOverflow = 13,
    MarketProportionTooHigh = 14,
    ExchangeRateBelowOne = 15,
    UnsupportedRoute = 16,
    TradeNotFound = 17,
}

struct Precompute {
    rate_scalar: i128,
    total_asset: i128,
    rate_anchor: i128,
    time_to_expiry: u64,
}

#[contract]
pub struct AmmMarket;

#[contractimpl]
impl AmmMarket {
    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        env: Env,
        admin: Address,
        pt_token: Address,
        sy_token: Address,
        tokenizer: Address,
        maturity: u64,
        scalar_root: i128,
        initial_anchor: i128,
        fee_bps: i128,
        twap_window: u64,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();

        if maturity <= env.ledger().timestamp() {
            return Err(Error::InvalidMaturity);
        }
        if scalar_root <= 0 {
            return Err(Error::InvalidScalarRoot);
        }
        if initial_anchor < WAD {
            return Err(Error::InvalidAnchor);
        }
        if !(0..BPS_DENOMINATOR).contains(&fee_bps) {
            return Err(Error::InvalidFee);
        }
        if twap_window == 0 {
            return Err(Error::InvalidTwapWindow);
        }

        let config = Config {
            admin,
            pt_token,
            sy_token,
            tokenizer,
            maturity,
            scalar_root,
            initial_anchor,
            fee_bps,
            twap_window,
        };
        let state = State {
            total_pt: 0,
            total_sy: 0,
            total_lp: 0,
            last_ln_implied_rate: 0,
            twap_ln_implied_rate: 0,
            last_observation: env.ledger().timestamp(),
            warmup_until: env.ledger().timestamp() + twap_window,
        };

        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::State, &state);

        Ok(())
    }

    pub fn config(env: Env) -> Result<Config, Error> {
        read_config(&env)
    }

    pub fn state(env: Env) -> Result<State, Error> {
        read_state(&env)
    }

    pub fn twap_apy(env: Env) -> Result<i128, Error> {
        let config = read_config(&env)?;
        let state = read_state(&env)?;

        if env.ledger().timestamp() >= config.maturity {
            return Ok(0);
        }

        Ok(ln_rate_to_bps(state.twap_ln_implied_rate))
    }

    pub fn twap_warming_up(env: Env) -> Result<bool, Error> {
        let state = read_state(&env)?;
        Ok(env.ledger().timestamp() < state.warmup_until)
    }

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
    fn swap_pt_for_sy(env: &Env, from: Address, pt_in: i128, min_sy_out: i128) -> i128 {
        from.require_auth();
        require_positive_amount(env, pt_in);

        let config = read_config_or_panic(env);
        require_live(env, &config);

        let mut state = read_state_or_panic(env);
        require_seeded(env, &state);

        let comp = precompute_or_panic(env, &config, &state);
        let (sy_out, observed_ln_rate) =
            apply_exact_pt_in_trade_or_panic(env, &config, &mut state, &comp, pt_in, min_sy_out);
        sync_twap(env, &config, &mut state, observed_ln_rate);
        write_state(env, &state);

        sy_out
    }

    fn swap_sy_for_pt(env: &Env, from: Address, sy_in: i128, min_pt_out: i128) -> i128 {
        from.require_auth();
        require_positive_amount(env, sy_in);

        let config = read_config_or_panic(env);
        require_live(env, &config);

        let mut state = read_state_or_panic(env);
        require_seeded(env, &state);

        let comp = precompute_or_panic(env, &config, &state);
        let pt_out = exact_sy_in_pt_out_or_panic(env, &config, &state, &comp, sy_in);
        if pt_out < min_pt_out {
            panic_with_error!(env, Error::SlippageExceeded);
        }

        let observed_ln_rate =
            apply_exact_sy_in_trade_or_panic(env, &config, &mut state, &comp, sy_in, pt_out);
        sync_twap(env, &config, &mut state, observed_ln_rate);
        write_state(env, &state);

        pt_out
    }

    fn swap_sy_for_yt(env: &Env, _from: Address, _sy_in: i128, _min_yt_out: i128) -> i128 {
        let from = _from;
        from.require_auth();
        require_positive_amount(env, _sy_in);

        let config = read_config_or_panic(env);
        require_live(env, &config);

        let mut state = read_state_or_panic(env);
        require_seeded(env, &state);

        let comp = precompute_or_panic(env, &config, &state);
        let yt_out = exact_sy_in_pt_out_or_panic(env, &config, &state, &comp, _sy_in);
        if yt_out < _min_yt_out {
            panic_with_error!(env, Error::SlippageExceeded);
        }

        let observed_ln_rate =
            apply_exact_sy_in_trade_or_panic(env, &config, &mut state, &comp, _sy_in, yt_out);
        sync_twap(env, &config, &mut state, observed_ln_rate);
        write_state(env, &state);

        yt_out
    }

    fn swap_yt_for_sy(env: &Env, _from: Address, _yt_in: i128, _min_sy_out: i128) -> i128 {
        let from = _from;
        from.require_auth();
        require_positive_amount(env, _yt_in);

        let config = read_config_or_panic(env);
        require_live(env, &config);

        let mut state = read_state_or_panic(env);
        require_seeded(env, &state);

        let comp = precompute_or_panic(env, &config, &state);
        let (sy_out, observed_ln_rate) =
            apply_exact_pt_in_trade_or_panic(env, &config, &mut state, &comp, _yt_in, _min_sy_out);
        sync_twap(env, &config, &mut state, observed_ln_rate);
        write_state(env, &state);

        sy_out
    }

    fn add_liquidity(env: &Env, from: Address, pt_in: i128, sy_in: i128) -> i128 {
        from.require_auth();
        require_positive_amount(env, pt_in);
        require_positive_amount(env, sy_in);

        let config = read_config_or_panic(env);
        require_live(env, &config);

        let mut state = read_state_or_panic(env);
        let now = env.ledger().timestamp();

        let lp_out = if state.total_lp == 0 {
            let gross_lp = integer_sqrt_or_panic(env, checked_mul(env, pt_in, sy_in));
            if gross_lp <= MINIMUM_LIQUIDITY {
                panic_with_error!(env, Error::InsufficientLiquidity);
            }

            state.total_pt = pt_in;
            state.total_sy = sy_in;
            state.total_lp = gross_lp;
            let time_to_expiry = time_to_expiry_or_panic(env, &config);
            let rate_scalar = get_rate_scalar_or_panic(env, config.scalar_root, time_to_expiry);
            state.last_ln_implied_rate = get_ln_implied_rate_or_panic(
                env,
                state.total_pt,
                state.total_sy,
                rate_scalar,
                config.initial_anchor,
                time_to_expiry,
            );
            state.twap_ln_implied_rate = state.last_ln_implied_rate;
            state.last_observation = now;

            gross_lp - MINIMUM_LIQUIDITY
        } else {
            let lp_by_pt = mul_div_down_or_panic(env, pt_in, state.total_lp, state.total_pt);
            let lp_by_sy = mul_div_down_or_panic(env, sy_in, state.total_lp, state.total_sy);
            let lp_out = min(lp_by_pt, lp_by_sy);
            if lp_out <= 0 {
                panic_with_error!(env, Error::InsufficientLiquidity);
            }

            let pt_used = mul_div_up_or_panic(env, state.total_pt, lp_out, state.total_lp);
            let sy_used = mul_div_up_or_panic(env, state.total_sy, lp_out, state.total_lp);

            state.total_pt = checked_add(env, state.total_pt, pt_used);
            state.total_sy = checked_add(env, state.total_sy, sy_used);
            state.total_lp = checked_add(env, state.total_lp, lp_out);

            lp_out
        };

        write_state(env, &state);
        lp_out
    }

    fn remove_liquidity(env: &Env, from: Address, lp_in: i128) -> (i128, i128) {
        from.require_auth();
        require_positive_amount(env, lp_in);

        let config = read_config_or_panic(env);
        let mut state = read_state_or_panic(env);
        require_live(env, &config);
        require_seeded(env, &state);

        if lp_in >= state.total_lp {
            panic_with_error!(env, Error::InsufficientLiquidity);
        }

        let sy_out = mul_div_down_or_panic(env, lp_in, state.total_sy, state.total_lp);
        let pt_out = mul_div_down_or_panic(env, lp_in, state.total_pt, state.total_lp);
        if sy_out == 0 && pt_out == 0 {
            panic_with_error!(env, Error::InsufficientLiquidity);
        }

        state.total_lp = checked_sub(env, state.total_lp, lp_in);
        state.total_sy = checked_sub(env, state.total_sy, sy_out);
        state.total_pt = checked_sub(env, state.total_pt, pt_out);
        write_state(env, &state);

        (pt_out, sy_out)
    }

    fn implied_apy(env: &Env) -> i128 {
        let config = read_config_or_panic(env);
        if env.ledger().timestamp() >= config.maturity {
            return 0;
        }

        let state = read_state_or_panic(env);
        if state.total_lp == 0 {
            return 0;
        }

        ln_rate_to_bps(state.last_ln_implied_rate)
    }

    fn maturity(env: &Env) -> u64 {
        read_config_or_panic(env).maturity
    }
}

fn read_config(env: &Env) -> Result<Config, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(Error::NotInitialized)
}

fn read_state(env: &Env) -> Result<State, Error> {
    env.storage()
        .instance()
        .get(&DataKey::State)
        .ok_or(Error::NotInitialized)
}

fn read_config_or_panic(env: &Env) -> Config {
    match read_config(env) {
        Ok(config) => config,
        Err(error) => panic_with_error!(env, error),
    }
}

fn read_state_or_panic(env: &Env) -> State {
    match read_state(env) {
        Ok(state) => state,
        Err(error) => panic_with_error!(env, error),
    }
}

fn write_state(env: &Env, state: &State) {
    env.storage().instance().set(&DataKey::State, state);
}

fn require_live(env: &Env, config: &Config) {
    if env.ledger().timestamp() >= config.maturity {
        panic_with_error!(env, Error::MarketMatured);
    }
}

fn require_seeded(env: &Env, state: &State) {
    if state.total_lp <= 0 || state.total_pt <= 0 || state.total_sy <= 0 {
        panic_with_error!(env, Error::MarketNotSeeded);
    }
}

fn require_positive_amount(env: &Env, amount: i128) {
    if amount <= 0 {
        panic_with_error!(env, Error::InvalidAmount);
    }
}

fn time_to_expiry_or_panic(env: &Env, config: &Config) -> u64 {
    let now = env.ledger().timestamp();
    match config.maturity.checked_sub(now) {
        Some(remaining) if remaining > 0 => remaining,
        _ => panic_with_error!(env, Error::MarketMatured),
    }
}

fn precompute_or_panic(env: &Env, config: &Config, state: &State) -> Precompute {
    let time_to_expiry = time_to_expiry_or_panic(env, config);
    let rate_scalar = get_rate_scalar_or_panic(env, config.scalar_root, time_to_expiry);
    let total_asset = state.total_sy;
    if state.total_pt <= 0 || total_asset <= 0 {
        panic_with_error!(env, Error::MarketNotSeeded);
    }

    let rate_anchor = get_rate_anchor_or_panic(
        env,
        state.total_pt,
        state.last_ln_implied_rate,
        total_asset,
        rate_scalar,
        time_to_expiry,
    );

    Precompute {
        rate_scalar,
        total_asset,
        rate_anchor,
        time_to_expiry,
    }
}

fn exact_pt_in_sy_out_or_panic(
    env: &Env,
    config: &Config,
    state: &State,
    comp: &Precompute,
    pt_in: i128,
) -> i128 {
    let exchange_rate = get_exchange_rate_or_panic(
        env,
        state.total_pt,
        comp.total_asset,
        comp.rate_scalar,
        comp.rate_anchor,
        -pt_in,
    );
    let pre_fee_sy_out = mul_div_down_or_panic(env, pt_in, WAD, exchange_rate);
    let fee = mul_div_down_or_panic(env, pre_fee_sy_out, config.fee_bps, BPS_DENOMINATOR);
    let sy_out = checked_sub(env, pre_fee_sy_out, fee);

    if sy_out <= 0 || sy_out >= state.total_sy {
        panic_with_error!(env, Error::InsufficientLiquidity);
    }

    sy_out
}

fn apply_exact_pt_in_trade_or_panic(
    env: &Env,
    config: &Config,
    state: &mut State,
    comp: &Precompute,
    pt_in: i128,
    min_sy_out: i128,
) -> (i128, i128) {
    let sy_out = exact_pt_in_sy_out_or_panic(env, config, state, comp, pt_in);
    if sy_out < min_sy_out {
        panic_with_error!(env, Error::SlippageExceeded);
    }

    state.total_pt = checked_add(env, state.total_pt, pt_in);
    state.total_sy = checked_sub(env, state.total_sy, sy_out);
    let observed_ln_rate = get_ln_implied_rate_or_panic(
        env,
        state.total_pt,
        state.total_sy,
        comp.rate_scalar,
        comp.rate_anchor,
        comp.time_to_expiry,
    );
    state.last_ln_implied_rate = observed_ln_rate;

    (sy_out, observed_ln_rate)
}

fn exact_sy_in_pt_out_or_panic(
    env: &Env,
    config: &Config,
    state: &State,
    comp: &Precompute,
    sy_in: i128,
) -> i128 {
    let mut low = 1;
    let mut high = checked_sub(env, state.total_pt, 1);
    let mut best = 0;

    while low <= high {
        let mid = low + ((high - low) / 2);
        match try_exact_pt_out_sy_in(env, config, state, comp, mid) {
            Some(required_sy) if required_sy <= sy_in => {
                best = mid;
                low = mid + 1;
            }
            Some(_) | None => {
                high = mid - 1;
            }
        }
    }

    if best <= 0 {
        panic_with_error!(env, Error::TradeNotFound);
    }

    best
}

fn apply_exact_sy_in_trade_or_panic(
    env: &Env,
    _config: &Config,
    state: &mut State,
    comp: &Precompute,
    sy_in: i128,
    pt_out: i128,
) -> i128 {
    let required_sy = exact_pt_out_sy_in_or_panic(env, _config, state, comp, pt_out);
    if required_sy > sy_in {
        panic_with_error!(env, Error::SlippageExceeded);
    }

    state.total_pt = checked_sub(env, state.total_pt, pt_out);
    state.total_sy = checked_add(env, state.total_sy, required_sy);
    let observed_ln_rate = get_ln_implied_rate_or_panic(
        env,
        state.total_pt,
        state.total_sy,
        comp.rate_scalar,
        comp.rate_anchor,
        comp.time_to_expiry,
    );
    state.last_ln_implied_rate = observed_ln_rate;

    observed_ln_rate
}

fn exact_pt_out_sy_in_or_panic(
    env: &Env,
    config: &Config,
    state: &State,
    comp: &Precompute,
    pt_out: i128,
) -> i128 {
    match try_exact_pt_out_sy_in(env, config, state, comp, pt_out) {
        Some(value) => value,
        None => panic_with_error!(env, Error::TradeNotFound),
    }
}

fn try_exact_pt_out_sy_in(
    env: &Env,
    config: &Config,
    state: &State,
    comp: &Precompute,
    pt_out: i128,
) -> Option<i128> {
    if pt_out <= 0 || pt_out >= state.total_pt {
        return None;
    }

    let exchange_rate = try_get_exchange_rate(
        env,
        state.total_pt,
        comp.total_asset,
        comp.rate_scalar,
        comp.rate_anchor,
        pt_out,
    )?;
    let pre_fee_sy_in = mul_div_up_or_panic(env, pt_out, WAD, exchange_rate);
    let fee = mul_div_up_or_panic(env, pre_fee_sy_in, config.fee_bps, BPS_DENOMINATOR);
    Some(checked_add(env, pre_fee_sy_in, fee))
}

fn sync_twap(env: &Env, config: &Config, state: &mut State, observed_ln_rate: i128) {
    let now = env.ledger().timestamp();
    let elapsed = now.saturating_sub(state.last_observation);

    if elapsed == 0 {
        state.twap_ln_implied_rate = observed_ln_rate;
        state.last_observation = now;
        return;
    }

    if elapsed >= config.twap_window {
        state.twap_ln_implied_rate = observed_ln_rate;
    } else {
        let weight = mul_div_down_or_panic(env, elapsed as i128, WAD, config.twap_window as i128);
        let retained = checked_sub(env, WAD, weight);
        let carried = mul_div_down_or_panic(env, state.twap_ln_implied_rate, retained, WAD);
        let fresh = mul_div_down_or_panic(env, observed_ln_rate, weight, WAD);
        state.twap_ln_implied_rate = checked_add(env, carried, fresh);
    }

    state.last_observation = now;
}

fn get_rate_scalar_or_panic(env: &Env, scalar_root: i128, time_to_expiry: u64) -> i128 {
    let numerator = checked_mul(env, scalar_root, IMPLIED_RATE_TIME as i128);
    let rate_scalar = numerator / time_to_expiry as i128;
    if rate_scalar <= 0 {
        panic_with_error!(env, Error::InvalidScalarRoot);
    }

    rate_scalar
}

fn get_rate_anchor_or_panic(
    env: &Env,
    total_pt: i128,
    last_ln_implied_rate: i128,
    total_asset: i128,
    rate_scalar: i128,
    time_to_expiry: u64,
) -> i128 {
    let exchange_rate =
        get_exchange_rate_from_implied_rate_or_panic(env, last_ln_implied_rate, time_to_expiry);
    if exchange_rate < WAD {
        panic_with_error!(env, Error::ExchangeRateBelowOne);
    }

    let proportion =
        mul_div_down_or_panic(env, total_pt, WAD, checked_add(env, total_pt, total_asset));
    let ln_proportion = log_proportion_or_panic(env, proportion);
    checked_sub(
        env,
        exchange_rate,
        mul_div_down_or_panic(env, ln_proportion, WAD, rate_scalar),
    )
}

fn get_ln_implied_rate_or_panic(
    env: &Env,
    total_pt: i128,
    total_asset: i128,
    rate_scalar: i128,
    rate_anchor: i128,
    time_to_expiry: u64,
) -> i128 {
    let exchange_rate =
        get_exchange_rate_or_panic(env, total_pt, total_asset, rate_scalar, rate_anchor, 0);
    let ln_rate = ln_wad_or_panic(env, exchange_rate);
    mul_div_down_or_panic(
        env,
        ln_rate,
        IMPLIED_RATE_TIME as i128,
        time_to_expiry as i128,
    )
}

fn get_exchange_rate_from_implied_rate_or_panic(
    env: &Env,
    ln_implied_rate: i128,
    time_to_expiry: u64,
) -> i128 {
    let rt = mul_div_down_or_panic(
        env,
        ln_implied_rate,
        time_to_expiry as i128,
        IMPLIED_RATE_TIME as i128,
    );
    exp_wad_or_panic(env, rt)
}

fn get_exchange_rate_or_panic(
    env: &Env,
    total_pt: i128,
    total_asset: i128,
    rate_scalar: i128,
    rate_anchor: i128,
    net_pt_to_account: i128,
) -> i128 {
    let numerator = checked_sub(env, total_pt, net_pt_to_account);
    let denominator = checked_add(env, total_pt, total_asset);
    let proportion = mul_div_down_or_panic(env, numerator, WAD, denominator);
    if proportion > MAX_MARKET_PROPORTION {
        panic_with_error!(env, Error::MarketProportionTooHigh);
    }

    let ln_proportion = log_proportion_or_panic(env, proportion);
    let exchange_rate = checked_add(
        env,
        mul_div_down_or_panic(env, ln_proportion, WAD, rate_scalar),
        rate_anchor,
    );
    if exchange_rate < WAD {
        panic_with_error!(env, Error::ExchangeRateBelowOne);
    }

    exchange_rate
}

fn try_get_exchange_rate(
    env: &Env,
    total_pt: i128,
    total_asset: i128,
    rate_scalar: i128,
    rate_anchor: i128,
    net_pt_to_account: i128,
) -> Option<i128> {
    let numerator = total_pt.checked_sub(net_pt_to_account)?;
    let denominator = total_pt.checked_add(total_asset)?;
    if numerator <= 0 || denominator <= 0 {
        return None;
    }

    let proportion = numerator.checked_mul(WAD)?.checked_div(denominator)?;
    if proportion <= 0 || proportion > MAX_MARKET_PROPORTION {
        return None;
    }

    let complement = WAD.checked_sub(proportion)?;
    if complement <= 0 {
        return None;
    }

    let ratio = proportion.checked_mul(WAD)?.checked_div(complement)?;
    let ln_proportion = try_ln_wad(env, ratio)?;
    let scaled = ln_proportion.checked_mul(WAD)?.checked_div(rate_scalar)?;
    let exchange_rate = scaled.checked_add(rate_anchor)?;
    if exchange_rate < WAD {
        return None;
    }

    Some(exchange_rate)
}

fn log_proportion_or_panic(env: &Env, proportion: i128) -> i128 {
    let complement = checked_sub(env, WAD, proportion);
    if complement <= 0 {
        panic_with_error!(env, Error::MarketProportionTooHigh);
    }

    let ratio = mul_div_down_or_panic(env, proportion, WAD, complement);
    ln_wad_or_panic(env, ratio)
}

fn ln_rate_to_bps(ln_rate: i128) -> i128 {
    (ln_rate * BPS_DENOMINATOR) / WAD
}

fn integer_sqrt_or_panic(env: &Env, value: i128) -> i128 {
    if value <= 0 {
        panic_with_error!(env, Error::InvalidAmount);
    }

    let root = floor(sqrt(value as f64));
    if !root.is_finite() || root <= 0.0 || root > i128::MAX as f64 {
        panic_with_error!(env, Error::MathOverflow);
    }

    root as i128
}

fn ln_wad_or_panic(env: &Env, value: i128) -> i128 {
    if value <= 0 {
        panic_with_error!(env, Error::MathOverflow);
    }

    let as_float = value as f64 / WAD as f64;
    let logged = log(as_float);
    from_float_wad_or_panic(env, logged)
}

fn try_ln_wad(env: &Env, value: i128) -> Option<i128> {
    if value <= 0 {
        return None;
    }

    let as_float = value as f64 / WAD as f64;
    let logged = log(as_float);
    try_from_float_wad(env, logged)
}

fn exp_wad_or_panic(env: &Env, value: i128) -> i128 {
    let exponent = value as f64 / WAD as f64;
    from_float_wad_or_panic(env, exp(exponent))
}

fn from_float_wad_or_panic(env: &Env, value: f64) -> i128 {
    if !value.is_finite() {
        panic_with_error!(env, Error::MathOverflow);
    }

    let scaled = value * WAD as f64;
    if !scaled.is_finite() || scaled > i128::MAX as f64 || scaled < i128::MIN as f64 {
        panic_with_error!(env, Error::MathOverflow);
    }

    floor(scaled) as i128
}

fn try_from_float_wad(_env: &Env, value: f64) -> Option<i128> {
    if !value.is_finite() {
        return None;
    }

    let scaled = value * WAD as f64;
    if !scaled.is_finite() || scaled > i128::MAX as f64 || scaled < i128::MIN as f64 {
        return None;
    }

    Some(floor(scaled) as i128)
}

fn mul_div_down_or_panic(env: &Env, lhs: i128, rhs: i128, denominator: i128) -> i128 {
    if denominator == 0 {
        panic_with_error!(env, Error::MathOverflow);
    }

    checked_mul(env, lhs, rhs) / denominator
}

fn mul_div_up_or_panic(env: &Env, lhs: i128, rhs: i128, denominator: i128) -> i128 {
    if denominator == 0 {
        panic_with_error!(env, Error::MathOverflow);
    }

    let product = checked_mul(env, lhs, rhs);
    let quotient = product / denominator;
    if product % denominator == 0 {
        quotient
    } else {
        checked_add(env, quotient, 1)
    }
}

fn checked_add(env: &Env, lhs: i128, rhs: i128) -> i128 {
    match lhs.checked_add(rhs) {
        Some(value) => value,
        None => panic_with_error!(env, Error::MathOverflow),
    }
}

fn checked_sub(env: &Env, lhs: i128, rhs: i128) -> i128 {
    match lhs.checked_sub(rhs) {
        Some(value) if value >= 0 => value,
        _ => panic_with_error!(env, Error::MathOverflow),
    }
}

fn checked_mul(env: &Env, lhs: i128, rhs: i128) -> i128 {
    match lhs.checked_mul(rhs) {
        Some(value) => value,
        None => panic_with_error!(env, Error::MathOverflow),
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::*;
    use proptest::prelude::*;
    use soroban_sdk::testutils::{Address as _, EnvTestConfig, Ledger};
    use std::panic::{catch_unwind, AssertUnwindSafe};

    const NOW: u64 = 1_770_000_000;
    const MATURITY: u64 = NOW + 90 * DAY;
    const SCALAR_ROOT: i128 = 2 * WAD;
    const INITIAL_ANCHOR: i128 = 1_050_000_000_000_000_000;
    const FEE_BPS: i128 = 10;
    const TWAP_WINDOW: u64 = 30 * 60;

    struct Fixture {
        env: Env,
        client: AmmMarketClient<'static>,
        admin: Address,
        pt_token: Address,
        sy_token: Address,
        tokenizer: Address,
    }

    fn fixture(now: u64) -> Fixture {
        let env = Env::new_with_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        env.ledger().set_timestamp(now);
        env.mock_all_auths();

        let contract_id = env.register(AmmMarket, ());
        let client = AmmMarketClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let pt_token = Address::generate(&env);
        let sy_token = Address::generate(&env);
        let tokenizer = Address::generate(&env);

        Fixture {
            env,
            client,
            admin,
            pt_token,
            sy_token,
            tokenizer,
        }
    }

    fn initialize(fixture: &Fixture) {
        fixture.client.initialize(
            &fixture.admin,
            &fixture.pt_token,
            &fixture.sy_token,
            &fixture.tokenizer,
            &MATURITY,
            &SCALAR_ROOT,
            &INITIAL_ANCHOR,
            &FEE_BPS,
            &TWAP_WINDOW,
        );
    }

    #[test]
    fn initialize_stores_config_and_empty_state() {
        let fixture = fixture(NOW);

        initialize(&fixture);

        assert_eq!(
            fixture.client.config(),
            Config {
                admin: fixture.admin,
                pt_token: fixture.pt_token,
                sy_token: fixture.sy_token,
                tokenizer: fixture.tokenizer,
                maturity: MATURITY,
                scalar_root: SCALAR_ROOT,
                initial_anchor: INITIAL_ANCHOR,
                fee_bps: FEE_BPS,
                twap_window: TWAP_WINDOW,
            }
        );
        assert_eq!(
            fixture.client.state(),
            State {
                total_pt: 0,
                total_sy: 0,
                total_lp: 0,
                last_ln_implied_rate: 0,
                twap_ln_implied_rate: 0,
                last_observation: NOW,
                warmup_until: NOW + TWAP_WINDOW,
            }
        );
        assert_eq!(fixture.client.implied_apy(), 0);
    }

    #[test]
    fn first_liquidity_seeds_market_state() {
        let fixture = fixture(NOW);
        initialize(&fixture);

        let lp_out = fixture
            .client
            .add_liquidity(&fixture.admin, &10_000, &10_000);
        let state = fixture.client.state();

        assert_eq!(lp_out, 9_000);
        assert_eq!(state.total_pt, 10_000);
        assert_eq!(state.total_sy, 10_000);
        assert_eq!(state.total_lp, 10_000);
        assert!(state.last_ln_implied_rate > 0);
        assert_eq!(state.last_ln_implied_rate, state.twap_ln_implied_rate);
        assert!(fixture.client.implied_apy() > 0);
    }

    #[test]
    fn remove_liquidity_returns_pro_rata_assets() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &10_000, &10_000);

        let (pt_out, sy_out) = fixture.client.remove_liquidity(&fixture.admin, &9_000);
        let state = fixture.client.state();

        assert_eq!((pt_out, sy_out), (9_000, 9_000));
        assert_eq!(state.total_pt, 1_000);
        assert_eq!(state.total_sy, 1_000);
        assert_eq!(state.total_lp, 1_000);
    }

    #[test]
    fn swap_pt_for_sy_updates_reserves_and_observation() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000);

        fixture.env.ledger().set_timestamp(NOW + 60);
        let sy_out = fixture.client.swap_pt_for_sy(&fixture.admin, &1_000, &1);
        let state = fixture.client.state();

        assert!(sy_out > 0);
        assert_eq!(state.total_pt, 21_000);
        assert_eq!(state.total_sy, 20_000 - sy_out);
        assert_eq!(state.last_observation, NOW + 60);
        assert!(state.twap_ln_implied_rate > 0);
    }

    #[test]
    fn swap_sy_for_pt_updates_reserves_and_observation() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000);

        fixture.env.ledger().set_timestamp(NOW + 60);
        let pt_out = fixture.client.swap_sy_for_pt(&fixture.admin, &1_000, &1);
        let state = fixture.client.state();

        assert!(pt_out > 0);
        assert_eq!(state.total_pt, 20_000 - pt_out);
        assert!(state.total_sy > 20_000);
        assert_eq!(state.last_observation, NOW + 60);
        assert!(state.twap_ln_implied_rate > 0);
    }

    #[test]
    fn swap_sy_for_yt_routes_through_same_market_state_as_pt_purchase() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000);

        fixture.env.ledger().set_timestamp(NOW + 60);
        let yt_out = fixture.client.swap_sy_for_yt(&fixture.admin, &1_000, &1);
        let state = fixture.client.state();

        assert!(yt_out > 0);
        assert_eq!(state.total_pt, 20_000 - yt_out);
        assert!(state.total_sy > 20_000);
        assert_eq!(state.last_observation, NOW + 60);
    }

    #[test]
    fn swap_yt_for_sy_routes_through_same_market_state_as_pt_sale() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000);

        fixture.env.ledger().set_timestamp(NOW + 60);
        let sy_out = fixture.client.swap_yt_for_sy(&fixture.admin, &1_000, &1);
        let state = fixture.client.state();

        assert!(sy_out > 0);
        assert_eq!(state.total_pt, 21_000);
        assert_eq!(state.total_sy, 20_000 - sy_out);
        assert_eq!(state.last_observation, NOW + 60);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #11)")]
    fn swap_sy_for_yt_respects_min_out() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000);

        fixture.client.swap_sy_for_yt(&fixture.admin, &100, &10_000);
    }

    #[derive(Clone, Debug)]
    enum ModelOp {
        Split(i128),
        Recombine(i128),
        BuyPt(i128),
        SellPt(i128),
        BuyYt(i128),
        SellYt(i128),
    }

    #[derive(Clone, Debug)]
    struct PositionModel {
        free_sy: i128,
        free_pt: i128,
        free_yt: i128,
        escrowed_sy: i128,
        total_pt_supply: i128,
        total_yt_supply: i128,
    }

    impl PositionModel {
        fn new(free_sy: i128) -> Self {
            Self {
                free_sy,
                free_pt: 0,
                free_yt: 0,
                escrowed_sy: 0,
                total_pt_supply: 0,
                total_yt_supply: 0,
            }
        }

        fn assert_invariant(&self) {
            assert_eq!(self.escrowed_sy, self.total_pt_supply);
            assert_eq!(self.escrowed_sy, self.total_yt_supply);
            assert!(self.free_sy >= 0);
            assert!(self.free_pt >= 0);
            assert!(self.free_yt >= 0);
            assert!(self.escrowed_sy >= 0);
        }
    }

    fn arb_op() -> impl Strategy<Value = ModelOp> {
        (0u8..6, 1i128..100i128).prop_map(|(kind, amount)| match kind {
            0 => ModelOp::Split(amount),
            1 => ModelOp::Recombine(amount),
            2 => ModelOp::BuyPt(amount),
            3 => ModelOp::SellPt(amount),
            4 => ModelOp::BuyYt(amount),
            _ => ModelOp::SellYt(amount),
        })
    }

    fn quote_sy_for_pt(fixture: &Fixture, sy_in: i128) -> Option<i128> {
        let config = fixture.client.config();
        let state = fixture.client.state();
        let comp = precompute_or_panic(&fixture.env, &config, &state);

        catch_unwind(AssertUnwindSafe(|| {
            exact_sy_in_pt_out_or_panic(&fixture.env, &config, &state, &comp, sy_in)
        }))
        .ok()
    }

    fn quote_pt_for_sy(fixture: &Fixture, pt_in: i128) -> Option<i128> {
        let config = fixture.client.config();
        let state = fixture.client.state();
        let comp = precompute_or_panic(&fixture.env, &config, &state);

        catch_unwind(AssertUnwindSafe(|| {
            exact_pt_in_sy_out_or_panic(&fixture.env, &config, &state, &comp, pt_in)
        }))
        .ok()
    }

    proptest! {
        #![proptest_config(ProptestConfig {
            cases: 10_000,
            .. ProptestConfig::default()
        })]

        #[test]
        fn pt_yt_sy_invariant_holds_across_random_sequences(ops in prop::collection::vec(arb_op(), 1..64)) {
            let fixture = fixture(NOW);
            initialize(&fixture);
            fixture.client.add_liquidity(&fixture.admin, &1_000_000, &1_000_000);

            let mut model = PositionModel::new(1_000_000);

            for op in ops {
                match op {
                    ModelOp::Split(amount) if model.free_sy >= amount => {
                        let (pt_out, yt_out) = (amount, amount);
                        model.free_sy -= amount;
                        model.free_pt += pt_out;
                        model.free_yt += yt_out;
                        model.escrowed_sy += amount;
                        model.total_pt_supply += pt_out;
                        model.total_yt_supply += yt_out;
                    }
                    ModelOp::Recombine(amount)
                        if model.free_pt >= amount
                            && model.free_yt >= amount
                            && model.escrowed_sy >= amount =>
                    {
                        model.free_pt -= amount;
                        model.free_yt -= amount;
                        model.free_sy += amount;
                        model.escrowed_sy -= amount;
                        model.total_pt_supply -= amount;
                        model.total_yt_supply -= amount;
                    }
                    ModelOp::BuyPt(amount)
                        if model.free_sy >= amount && quote_sy_for_pt(&fixture, amount).is_some() =>
                    {
                        let pt_out = fixture.client.swap_sy_for_pt(&fixture.admin, &amount, &1);
                        model.free_sy -= amount;
                        model.free_pt += pt_out;
                    }
                    ModelOp::SellPt(amount)
                        if model.free_pt >= amount && quote_pt_for_sy(&fixture, amount).is_some() =>
                    {
                        let sy_out = fixture.client.swap_pt_for_sy(&fixture.admin, &amount, &1);
                        model.free_pt -= amount;
                        model.free_sy += sy_out;
                    }
                    ModelOp::BuyYt(amount)
                        if model.free_sy >= amount && quote_sy_for_pt(&fixture, amount).is_some() =>
                    {
                        let yt_out = fixture.client.swap_sy_for_yt(&fixture.admin, &amount, &1);
                        model.free_sy -= amount;
                        model.free_yt += yt_out;
                        model.escrowed_sy += yt_out;
                        model.total_pt_supply += yt_out;
                        model.total_yt_supply += yt_out;
                    }
                    ModelOp::SellYt(amount)
                        if model.free_yt >= amount
                            && model.escrowed_sy >= amount
                            && model.total_pt_supply >= amount
                            && model.total_yt_supply >= amount =>
                    {
                        if quote_pt_for_sy(&fixture, amount).is_some() {
                            let sy_out = fixture.client.swap_yt_for_sy(&fixture.admin, &amount, &1);
                            model.free_yt -= amount;
                            model.free_sy += sy_out;
                            model.escrowed_sy -= amount;
                            model.total_pt_supply -= amount;
                            model.total_yt_supply -= amount;
                        }
                    }
                    _ => {}
                }

                model.assert_invariant();
            }
        }
    }
}
