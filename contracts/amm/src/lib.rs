// SPDX-License-Identifier: Apache-2.0

#![cfg_attr(target_family = "wasm", no_std)]

use core::cmp::min;

use sidereal_shared_types::Market;
use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contracterror, contractimpl, contracttype, panic_with_error, token, vec, Address,
    Env, IntoVal, MuxedAddress, Symbol, Val, Vec,
};

const WAD: i128 = 1_000_000_000_000_000_000;
const BPS_DENOMINATOR: i128 = 10_000;
const DAY: u64 = 86_400;
const IMPLIED_RATE_TIME: u64 = 365 * DAY;
const MINIMUM_LIQUIDITY: i128 = 1_000;
const MAX_MARKET_PROPORTION: i128 = (WAD * 96) / 100;
// Conservative testnet caps on reserves and curve parameters. These were
// originally sized to keep values in the float-safe range of the old f64 curve
// helpers. The curve is integer fixed-point now, so the names no longer refer
// to floats; the caps are kept as a conservative product limit that also keeps
// the i128 intermediate products well clear of overflow. Re-deriving the exact
// i128 overflow bound is future work; these values are unchanged.
const MAX_RESERVE_UNITS: i128 = WAD;
const MAX_SCALAR_ROOT: i128 = 10 * WAD;
const MAX_ANCHOR: i128 = 2 * WAD;
const LEDGERS_PER_DAY: u32 = 17_280;
const AMM_INSTANCE_TTL_THRESHOLD_LEDGERS: u32 = 30 * LEDGERS_PER_DAY;
const AMM_INSTANCE_TTL_EXTEND_TO_LEDGERS: u32 = 120 * LEDGERS_PER_DAY;

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Config {
    pub admin: Address,
    pub pt_token: Address,
    pub sy_token: Address,
    pub yt_token: Address,
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
    LpBalance(Address),
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
    InputOutOfBounds = 18,
    InvalidSyRate = 19,
}

struct Precompute {
    rate_scalar: i128,
    total_asset: i128,
    rate_anchor: i128,
    time_to_expiry: u64,
}

#[inline(never)]
fn load_live_market(env: &Env, amount: i128) -> Result<(Config, State, Precompute), Error> {
    require_bounded_amount_result(amount)?;
    let config = read_config(env)?;
    require_live_result(env, &config)?;
    let state = read_state(env)?;
    require_seeded_result(&state)?;
    let comp = precompute_or_panic(env, &config, &state);
    Ok((config, state, comp))
}

fn load_live_market_or_panic(env: &Env, amount: i128) -> (Config, State, Precompute) {
    match load_live_market(env, amount) {
        Ok(loaded) => loaded,
        Err(error) => panic_with_error!(env, error),
    }
}

#[inline(never)]
fn settle_and_record(env: &Env, config: &Config, state: &mut State, observed_ln_rate: i128) {
    reconcile_reserves(env, config, state);
    sync_twap(env, config, state, observed_ln_rate);
    write_state(env, state);
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
        yt_token: Address,
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
        if scalar_root > MAX_SCALAR_ROOT {
            return Err(Error::InputOutOfBounds);
        }
        if initial_anchor < WAD {
            return Err(Error::InvalidAnchor);
        }
        if initial_anchor > MAX_ANCHOR {
            return Err(Error::InputOutOfBounds);
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
            yt_token,
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
        bump_instance_ttl(&env);

        Ok(())
    }

    pub fn config(env: Env) -> Result<Config, Error> {
        read_config(&env)
    }

    pub fn state(env: Env) -> Result<State, Error> {
        read_state(&env)
    }

    pub fn reserve_pt(env: Env) -> Result<i128, Error> {
        let config = read_config(&env)?;
        Ok(pool_token_balance(&env, &config.pt_token))
    }

    pub fn reserve_sy(env: Env) -> Result<i128, Error> {
        let config = read_config(&env)?;
        Ok(pool_token_balance(&env, &config.sy_token))
    }

    pub fn total_lp(env: Env) -> Result<i128, Error> {
        Ok(read_state(&env)?.total_lp)
    }

    pub fn bump_ttl(env: Env) -> Result<(), Error> {
        read_config(&env)?;
        bump_instance_ttl(&env);
        Ok(())
    }

    pub fn bump_lp_ttl(env: Env, holder: Address) -> Result<(), Error> {
        read_config(&env)?;
        bump_lp_balance_ttl(&env, holder);
        Ok(())
    }

    pub fn lp_balance(env: Env, holder: Address) -> Result<i128, Error> {
        read_config(&env)?;
        Ok(read_lp_balance(&env, holder))
    }

    pub fn quote_pt_for_sy(env: Env, pt_in: i128) -> Result<i128, Error> {
        let (config, state, comp) = load_live_market(&env, pt_in)?;
        Ok(exact_pt_in_sy_out_or_panic(
            &env, &config, &state, &comp, pt_in,
        ))
    }

    pub fn quote_sy_for_pt(env: Env, sy_in: i128) -> Result<i128, Error> {
        let (config, state, comp) = load_live_market(&env, sy_in)?;
        Ok(exact_sy_in_pt_out_or_panic(
            &env, &config, &state, &comp, sy_in,
        ))
    }

    pub fn quote_sy_for_yt(env: Env, sy_in: i128) -> Result<i128, Error> {
        let (config, state, comp) = load_live_market(&env, sy_in)?;
        let rate = sy_rate_or_panic(&env, &config);
        Ok(solve_yt_out_for_sy_in(
            &env, &config, &state, &comp, sy_in, rate,
        ))
    }

    pub fn quote_yt_for_sy(env: Env, yt_in: i128) -> Result<i128, Error> {
        let (config, state, comp) = load_live_market(&env, yt_in)?;
        let rate = sy_rate_or_panic(&env, &config);
        let sy_cost = exact_pt_out_sy_in_or_panic(&env, &config, &state, &comp, yt_in);
        // Recombining `yt_in` face of PT + YT returns floor(yt_in * WAD / rate)
        // SY shares (the tokenizer's own floor); the seller nets that minus the
        // curve-side cost of buying back the PT leg.
        let sy_value = shares_out_for_face_down(&env, yt_in, rate);
        if sy_cost >= sy_value {
            return Err(Error::InsufficientLiquidity);
        }
        Ok(sy_value - sy_cost)
    }

    pub fn spot_apy(env: Env) -> Result<i128, Error> {
        let config = read_config(&env)?;
        if env.ledger().timestamp() >= config.maturity {
            return Ok(0);
        }

        let state = read_state(&env)?;
        if state.total_lp == 0 {
            return Ok(0);
        }

        Ok(ln_rate_to_bps(state.last_ln_implied_rate))
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

    pub fn add_liquidity(
        env: Env,
        from: Address,
        pt_in: i128,
        sy_in: i128,
        min_lp_out: i128,
    ) -> i128 {
        let lp_out = <Self as Market>::add_liquidity(&env, from, pt_in, sy_in);
        // Slippage bound enforced here, after the shared-trait implementation,
        // because the Market trait signature is frozen (contracts/shared/types).
        // A panic reverts the entire invocation, transfers included, so this is
        // equivalent to checking before any token moves.
        if lp_out < min_lp_out {
            panic_with_error!(&env, Error::SlippageExceeded);
        }
        lp_out
    }

    pub fn remove_liquidity(
        env: Env,
        from: Address,
        lp_in: i128,
        min_pt_out: i128,
        min_sy_out: i128,
    ) -> (i128, i128) {
        let (pt_out, sy_out) = <Self as Market>::remove_liquidity(&env, from, lp_in);
        // Same pattern as add_liquidity: bound checked after the frozen-trait
        // call; the panic reverts everything.
        if pt_out < min_pt_out || sy_out < min_sy_out {
            panic_with_error!(&env, Error::SlippageExceeded);
        }
        (pt_out, sy_out)
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
        let (config, mut state, comp) = load_live_market_or_panic(env, pt_in);

        let (sy_out, observed_ln_rate) =
            apply_exact_pt_in_trade_or_panic(env, &config, &mut state, &comp, pt_in, min_sy_out);
        transfer_into_pool(env, &config.pt_token, &from, pt_in);
        transfer_out_of_pool(env, &config.sy_token, &from, sy_out);
        settle_and_record(env, &config, &mut state, observed_ln_rate);

        sy_out
    }

    fn swap_sy_for_pt(env: &Env, from: Address, sy_in: i128, min_pt_out: i128) -> i128 {
        from.require_auth();
        let (config, mut state, comp) = load_live_market_or_panic(env, sy_in);

        let pt_out = exact_sy_in_pt_out_or_panic(env, &config, &state, &comp, sy_in);
        if pt_out < min_pt_out {
            panic_with_error!(env, Error::SlippageExceeded);
        }

        let observed_ln_rate =
            apply_exact_sy_in_trade_or_panic(env, &config, &mut state, &comp, sy_in, pt_out);
        transfer_into_pool(env, &config.sy_token, &from, sy_in);
        transfer_out_of_pool(env, &config.pt_token, &from, pt_out);
        settle_and_record(env, &config, &mut state, observed_ln_rate);

        pt_out
    }

    fn swap_sy_for_yt(env: &Env, from: Address, sy_in: i128, min_yt_out: i128) -> i128 {
        from.require_auth();
        let (config, mut state, comp) = load_live_market_or_panic(env, sy_in);

        // The curve prices PT face units; the tokenizer escrows SY shares and
        // mints face = shares * rate / WAD. Every conversion between the two
        // unit systems happens here at the flash boundary, using the same rate
        // source the tokenizer reads (the SY contract's exchange_rate).
        let rate = sy_rate_or_panic(env, &config);
        let yt_out = solve_yt_out_for_sy_in(env, &config, &state, &comp, sy_in, rate);
        if yt_out < min_yt_out {
            panic_with_error!(env, Error::SlippageExceeded);
        }

        // The pool keeps the PT the split mints, so the curve moves as if it
        // bought `yt_out` PT; `sy_funded` is the SY the curve pays for that PT.
        let (sy_funded, observed_ln_rate) =
            apply_exact_pt_in_trade_or_panic(env, &config, &mut state, &comp, yt_out, 0);

        // Shares to split, rounded UP so the tokenizer's floored face mint is
        // at least `yt_out`, the amount the curve accounted for and the buyer
        // was quoted. Rounding up costs the pool at most one extra face unit of
        // shares, and that cost is backed one-for-one by the dust pair it keeps
        // (see below).
        let shares_to_split = shares_in_for_face_up(env, yt_out, rate);
        // The split is funded by the buyer's sy_in plus at most the curve-side
        // proceeds of the PT leg. The solver guarantees this bound; fail closed
        // if a future change breaks it, because exceeding it would tap LP
        // reserves the curve never accounted for.
        if shares_to_split > checked_add(env, sy_in, sy_funded) {
            panic_with_error!(env, Error::InsufficientLiquidity);
        }

        // Take the buyer's SY, split pool-funded SY into PT + YT, keep the PT,
        // and send exactly the quoted YT to the buyer.
        transfer_into_pool(env, &config.sy_token, &from, sy_in);
        let (_pt_minted, yt_minted) = flash_split(env, &config, shares_to_split);
        if yt_minted < yt_out {
            // Cannot happen while the tokenizer floors against the same rate we
            // ceiled with; a drifted rate read would under-mint, so fail closed.
            panic_with_error!(env, Error::InsufficientLiquidity);
        }
        transfer_out_of_pool(env, &config.yt_token, &from, yt_out);
        // Rounding dust: the ceil above can over-mint up to one face unit of
        // PT and YT beyond `yt_out`. Both stay in the pool: the PT dust enters
        // the curve reserves on the reconcile below, and the YT dust sits in
        // pool custody as an equal, recombinable pair with that PT. The trader
        // never receives the dust, so rounding cannot be farmed against LPs.
        settle_and_record(env, &config, &mut state, observed_ln_rate);

        yt_out
    }

    fn swap_yt_for_sy(env: &Env, from: Address, yt_in: i128, min_sy_out: i128) -> i128 {
        from.require_auth();
        let (config, mut state, comp) = load_live_market_or_panic(env, yt_in);

        // Curve amounts are PT face; the recombine returns SY shares. Convert
        // at the flash boundary with the tokenizer's own rate source.
        let rate = sy_rate_or_panic(env, &config);
        let sy_cost = exact_pt_out_sy_in_or_panic(env, &config, &state, &comp, yt_in);
        // SY shares the recombine of `yt_in` face returns, floored exactly like
        // the tokenizer floors, so the payout budget never exceeds what will
        // actually arrive.
        let sy_value = shares_out_for_face_down(env, yt_in, rate);
        if sy_value <= sy_cost {
            panic_with_error!(env, Error::InsufficientLiquidity);
        }
        let sy_out = sy_value - sy_cost;
        if sy_out < min_sy_out {
            panic_with_error!(env, Error::SlippageExceeded);
        }

        // The pool sold `yt_in` PT for `sy_cost` SY into the recombine.
        let observed_ln_rate =
            apply_exact_sy_in_trade_or_panic(env, &config, &mut state, &comp, sy_cost, yt_in);

        // Take the seller's YT, recombine pool PT + seller YT into SY, pay the
        // seller, and keep the spread.
        transfer_into_pool(env, &config.yt_token, &from, yt_in);
        let sy_from_recombine = flash_recombine(env, &config, yt_in);
        // The tokenizer pays floor(yt_in * WAD / rate) shares, pro-rata capped
        // under an escrow shortfall. At a constant rate the cap never binds
        // (split floors face against the same rate, so escrow always covers).
        // If less than the budget arrives, the escrow is genuinely short: fail
        // closed and revert the swap rather than pay the seller from LP funds.
        if sy_from_recombine < sy_value {
            panic_with_error!(env, Error::InsufficientLiquidity);
        }
        transfer_out_of_pool(env, &config.sy_token, &from, sy_out);
        settle_and_record(env, &config, &mut state, observed_ln_rate);

        sy_out
    }

    fn add_liquidity(env: &Env, from: Address, pt_in: i128, sy_in: i128) -> i128 {
        from.require_auth();
        require_bounded_amount(env, pt_in);
        require_bounded_amount(env, sy_in);

        let config = read_config_or_panic(env);
        require_live(env, &config);

        let mut state = read_state_or_panic(env);
        let now = env.ledger().timestamp();
        let (pt_used, sy_used, lp_out) = if state.total_lp == 0 {
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

            (pt_in, sy_in, gross_lp - MINIMUM_LIQUIDITY)
        } else {
            let lp_by_pt = mul_div_down_or_panic(env, pt_in, state.total_lp, state.total_pt);
            let lp_by_sy = mul_div_down_or_panic(env, sy_in, state.total_lp, state.total_sy);
            let lp_out = min(lp_by_pt, lp_by_sy);
            if lp_out <= 0 {
                panic_with_error!(env, Error::InsufficientLiquidity);
            }

            let pt_used = mul_div_up_or_panic(env, state.total_pt, lp_out, state.total_lp);
            let sy_used = mul_div_up_or_panic(env, state.total_sy, lp_out, state.total_lp);

            state.total_pt = checked_bounded_reserve_add(env, state.total_pt, pt_used);
            state.total_sy = checked_bounded_reserve_add(env, state.total_sy, sy_used);
            state.total_lp = checked_add(env, state.total_lp, lp_out);

            (pt_used, sy_used, lp_out)
        };

        let current_lp = read_lp_balance(env, from.clone());
        write_lp_balance(env, from.clone(), checked_add(env, current_lp, lp_out));
        transfer_into_pool(env, &config.pt_token, &from, pt_used);
        transfer_into_pool(env, &config.sy_token, &from, sy_used);
        reconcile_reserves(env, &config, &mut state);
        write_state(env, &state);
        lp_out
    }

    fn remove_liquidity(env: &Env, from: Address, lp_in: i128) -> (i128, i128) {
        from.require_auth();
        require_bounded_amount(env, lp_in);

        let config = read_config_or_panic(env);
        let mut state = read_state_or_panic(env);
        require_seeded(env, &state);

        let holder_lp = read_lp_balance(env, from.clone());
        if lp_in > holder_lp {
            panic_with_error!(env, Error::InsufficientLiquidity);
        }

        if lp_in >= state.total_lp {
            panic_with_error!(env, Error::InsufficientLiquidity);
        }

        let sy_out = mul_div_down_or_panic(env, lp_in, state.total_sy, state.total_lp);
        let pt_out = mul_div_down_or_panic(env, lp_in, state.total_pt, state.total_lp);
        if sy_out == 0 && pt_out == 0 {
            panic_with_error!(env, Error::InsufficientLiquidity);
        }

        write_lp_balance(env, from.clone(), checked_sub(env, holder_lp, lp_in));
        state.total_lp = checked_sub(env, state.total_lp, lp_in);
        state.total_sy = checked_sub(env, state.total_sy, sy_out);
        state.total_pt = checked_sub(env, state.total_pt, pt_out);
        transfer_out_of_pool(env, &config.pt_token, &from, pt_out);
        transfer_out_of_pool(env, &config.sy_token, &from, sy_out);
        reconcile_reserves(env, &config, &mut state);
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
    bump_instance_ttl(env);
}

fn bump_instance_ttl(env: &Env) {
    env.storage().instance().extend_ttl(
        AMM_INSTANCE_TTL_THRESHOLD_LEDGERS,
        AMM_INSTANCE_TTL_EXTEND_TO_LEDGERS,
    );
}

// LP balances live in persistent storage, one entry per holder, matching the
// token contracts' balance pattern. Keeping them in the instance entry would
// make every invocation's IO scale with the number of LP holders and cap how
// many holders can exist at the instance entry size limit.
fn read_lp_balance(env: &Env, holder: Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::LpBalance(holder))
        .unwrap_or(0)
}

fn write_lp_balance(env: &Env, holder: Address, balance: i128) {
    let key = DataKey::LpBalance(holder);
    env.storage().persistent().set(&key, &balance);
    extend_lp_balance_ttl(env, &key);
}

fn bump_lp_balance_ttl(env: &Env, holder: Address) {
    let key = DataKey::LpBalance(holder);
    if env.storage().persistent().has(&key) {
        extend_lp_balance_ttl(env, &key);
    }
}

fn extend_lp_balance_ttl(env: &Env, key: &DataKey) {
    env.storage().persistent().extend_ttl(
        key,
        AMM_INSTANCE_TTL_THRESHOLD_LEDGERS,
        AMM_INSTANCE_TTL_EXTEND_TO_LEDGERS,
    );
}

fn pool_token_balance(env: &Env, token_id: &Address) -> i128 {
    token::TokenClient::new(env, token_id).balance(&env.current_contract_address())
}

fn reconcile_reserves(env: &Env, config: &Config, state: &mut State) {
    state.total_pt = pool_token_balance(env, &config.pt_token);
    state.total_sy = pool_token_balance(env, &config.sy_token);
}

fn transfer_into_pool(env: &Env, token_id: &Address, from: &Address, amount: i128) {
    let pool = env.current_contract_address();
    let to = MuxedAddress::from(&pool);
    token::TokenClient::new(env, token_id).transfer(from, &to, &amount);
}

#[inline(never)]
fn auth_entry(
    env: &Env,
    contract: &Address,
    fn_name: &str,
    args: Vec<Val>,
) -> InvokerContractAuthEntry {
    InvokerContractAuthEntry::Contract(SubContractInvocation {
        context: ContractContext {
            contract: contract.clone(),
            fn_name: Symbol::new(env, fn_name),
            args,
        },
        sub_invocations: vec![env],
    })
}

fn transfer_out_of_pool(env: &Env, token_id: &Address, to: &Address, amount: i128) {
    let pool = env.current_contract_address();
    let to_muxed = MuxedAddress::from(to);
    let transfer_args: Vec<Val> = vec![
        env,
        pool.clone().into_val(env),
        to_muxed.clone().into_val(env),
        amount.into_val(env),
    ];
    env.authorize_as_current_contract(vec![
        env,
        auth_entry(env, token_id, "transfer", transfer_args),
    ]);
    token::TokenClient::new(env, token_id).transfer(&pool, &to_muxed, &amount);
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

fn require_seeded_result(state: &State) -> Result<(), Error> {
    if state.total_lp <= 0 || state.total_pt <= 0 || state.total_sy <= 0 {
        return Err(Error::MarketNotSeeded);
    }

    Ok(())
}

fn require_positive_amount(env: &Env, amount: i128) {
    if amount <= 0 {
        panic_with_error!(env, Error::InvalidAmount);
    }
}

fn require_positive_amount_result(amount: i128) -> Result<(), Error> {
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }

    Ok(())
}

fn require_bounded_amount(env: &Env, amount: i128) {
    require_positive_amount(env, amount);
    require_within_reserve_bounds(env, amount);
}

fn require_bounded_amount_result(amount: i128) -> Result<(), Error> {
    require_positive_amount_result(amount)?;
    if amount > MAX_RESERVE_UNITS {
        return Err(Error::InputOutOfBounds);
    }

    Ok(())
}

fn require_within_reserve_bounds(env: &Env, amount: i128) {
    if amount > MAX_RESERVE_UNITS {
        panic_with_error!(env, Error::InputOutOfBounds);
    }
}

fn require_live_result(env: &Env, config: &Config) -> Result<(), Error> {
    if env.ledger().timestamp() >= config.maturity {
        return Err(Error::MarketMatured);
    }

    Ok(())
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

    state.total_pt = checked_bounded_reserve_add(env, state.total_pt, pt_in);
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
    state.total_sy = checked_bounded_reserve_add(env, state.total_sy, sy_in);
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

/// Non-panicking SY out for selling `pt_in` PT to the pool, used by the YT-buy
/// solver. Mirrors exact_pt_in_sy_out_or_panic but returns None instead of
/// panicking at the liquidity bound.
fn try_exact_pt_in_sy_out(
    env: &Env,
    config: &Config,
    state: &State,
    comp: &Precompute,
    pt_in: i128,
) -> Option<i128> {
    if pt_in <= 0 {
        return None;
    }
    let exchange_rate = try_get_exchange_rate(
        env,
        state.total_pt,
        comp.total_asset,
        comp.rate_scalar,
        comp.rate_anchor,
        -pt_in,
    )?;
    let pre_fee_sy_out = mul_div_down_or_panic(env, pt_in, WAD, exchange_rate);
    let fee = mul_div_down_or_panic(env, pre_fee_sy_out, config.fee_bps, BPS_DENOMINATOR);
    let sy_out = pre_fee_sy_out - fee;
    if sy_out <= 0 || sy_out >= state.total_sy {
        return None;
    }
    Some(sy_out)
}

/// Solves for the YT face a buyer receives for `sy_in` SY shares. The pool
/// splits ceil(yt_out * WAD / rate) shares to mint `yt_out` face of PT + YT
/// and sells the PT to itself for `sy_paid` shares; the buyer covers the
/// difference. We binary search for the largest affordable `yt_out`; `best` is
/// only ever set on a candidate whose cost fits inside `sy_in`, so even if the
/// cost curve is locally non-monotone the result can only be suboptimal for
/// the buyer, never unsafe for the pool.
fn solve_yt_out_for_sy_in(
    env: &Env,
    config: &Config,
    state: &State,
    comp: &Precompute,
    sy_in: i128,
    rate: i128,
) -> i128 {
    let mut low = 1;
    // The largest face any split could mint from the buyer's SY plus the whole
    // SY reserve, converted from shares to face at the rate.
    let max_shares = checked_add(env, sy_in, state.total_sy);
    let mut high = mul_div_down_or_panic(env, max_shares, rate, WAD);
    let mut best = 0;
    while low <= high {
        let mid = low + ((high - low) / 2);
        let shares_needed = shares_in_for_face_up(env, mid, rate);
        match try_exact_pt_in_sy_out(env, config, state, comp, mid) {
            Some(sy_paid)
                if shares_needed > sy_paid && (shares_needed - sy_paid) <= sy_in =>
            {
                best = mid;
                low = mid + 1;
            }
            _ => {
                high = mid - 1;
            }
        }
    }
    if best <= 0 {
        panic_with_error!(env, Error::TradeNotFound);
    }
    best
}

/// Reads the SY exchange rate (asset per share, WAD scaled) from the SY token,
/// the same `exchange_rate` entrypoint the tokenizer prices split and recombine
/// with, so the AMM's unit conversions cannot drift from what the tokenizer
/// actually mints and burns.
fn sy_rate_or_panic(env: &Env, config: &Config) -> i128 {
    let args: Vec<Val> = vec![env];
    let rate: i128 =
        env.invoke_contract(&config.sy_token, &Symbol::new(env, "exchange_rate"), args);
    if rate <= 0 {
        panic_with_error!(env, Error::InvalidSyRate);
    }
    rate
}

/// SY shares that must be split so the tokenizer's floored face mint covers
/// `face`: ceil(face * WAD / rate). Rounding up is the safe direction for the
/// pool: the split can over-mint face dust (which the pool keeps) but can
/// never mint less than the curve accounted for.
fn shares_in_for_face_up(env: &Env, face: i128, rate: i128) -> i128 {
    mul_div_up_or_panic(env, face, WAD, rate)
}

/// SY shares a recombine of `face` PT + YT returns: floor(face * WAD / rate),
/// mirroring the tokenizer's own floor, so the pool never budgets more SY out
/// than the recombine actually delivers.
fn shares_out_for_face_down(env: &Env, face: i128, rate: i128) -> i128 {
    mul_div_down_or_panic(env, face, WAD, rate)
}

/// Calls `tokenizer.split(amm, amount)`, authorizing the exact tokenizer call
/// and the exact SY pull it performs from the pool. `amount` is denominated in
/// SY shares (what split escrows), not PT face (what split mints); callers
/// convert curve face amounts with shares_in_for_face_up first.
fn flash_split(env: &Env, config: &Config, amount: i128) -> (i128, i128) {
    let amm = env.current_contract_address();
    let split_args: Vec<Val> =
        soroban_sdk::vec![env, amm.clone().into_val(env), amount.into_val(env)];
    let pull_args: Vec<Val> = soroban_sdk::vec![
        env,
        amm.clone().into_val(env),
        config.tokenizer.clone().into_val(env),
        amount.into_val(env),
    ];
    env.authorize_as_current_contract(vec![
        env,
        auth_entry(env, &config.tokenizer, "split", split_args.clone()),
        auth_entry(env, &config.sy_token, "transfer", pull_args),
    ]);
    env.invoke_contract::<(i128, i128)>(&config.tokenizer, &Symbol::new(env, "split"), split_args)
}

/// Calls `tokenizer.recombine(amm, amount, amount)`, authorizing the call and
/// the PT and YT burns it performs on the pool's balances, and returns SY out.
/// `amount` is PT face (what recombine burns); the return value is SY shares,
/// floor(amount * WAD / rate) when the escrow is solvent.
fn flash_recombine(env: &Env, config: &Config, amount: i128) -> i128 {
    let amm = env.current_contract_address();
    let recombine_args: Vec<Val> = soroban_sdk::vec![
        env,
        amm.clone().into_val(env),
        amount.into_val(env),
        amount.into_val(env),
    ];
    let burn_args: Vec<Val> =
        soroban_sdk::vec![env, amm.clone().into_val(env), amount.into_val(env)];
    env.authorize_as_current_contract(vec![
        env,
        auth_entry(env, &config.tokenizer, "recombine", recombine_args.clone()),
        auth_entry(env, &config.pt_token, "burn", burn_args.clone()),
        auth_entry(env, &config.yt_token, "burn", burn_args),
    ]);
    env.invoke_contract::<i128>(
        &config.tokenizer,
        &Symbol::new(env, "recombine"),
        recombine_args,
    )
}

fn sync_twap(env: &Env, config: &Config, state: &mut State, observed_ln_rate: i128) {
    let now = env.ledger().timestamp();
    let elapsed = now.saturating_sub(state.last_observation);

    if elapsed == 0 {
        return;
    }

    if elapsed >= config.twap_window {
        // After an idle gap of a full window there is no history worth
        // blending, so the TWAP snaps to this single observation. One trade
        // deciding the TWAP is exactly the manipulation window the TWAP
        // exists to prevent, so re-enter warm-up: consumers that gate on
        // twap_warming_up (the SDK and app already do) will not trust the
        // value again until a full window of fresh observations has passed.
        state.twap_ln_implied_rate = observed_ln_rate;
        state.warmup_until = now + config.twap_window;
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

// ln(2) scaled by WAD. Used to range-reduce ln and exp into a small interval
// where the series below converge quickly. Soroban's wasm VM rejects
// floating-point instructions, so all transcendental math here is integer
// fixed-point (i128, WAD = 1e18); these replace the previous libm f64 helpers.
const LN2_WAD: i128 = 693_147_180_559_945_309;

fn integer_sqrt_or_panic(env: &Env, value: i128) -> i128 {
    if value <= 0 {
        panic_with_error!(env, Error::InvalidAmount);
    }

    // Floor integer square root via Newton's method. Exact for every i128 >= 1
    // and, unlike the previous f64 sqrt, it does not lose precision for products
    // approaching WAD^2 (~1e36), which f64's 53-bit mantissa cannot represent.
    let mut x = value;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + value / x) / 2;
    }
    x
}

// Natural log of a WAD-fixed positive value, returned WAD-fixed (signed).
// Range-reduce value = m * 2^k with m in [1, 2), so ln(value) = k*ln2 + ln(m),
// and evaluate ln(m) with the fast atanh series
// ln(m) = 2*(z + z^3/3 + z^5/5 + ...), z = (m-1)/(m+1) in [0, 1/3].
fn ln_wad_checked(value: i128) -> Option<i128> {
    if value <= 0 {
        return None;
    }

    let mut k: i128 = 0;
    let mut m = value;
    while m >= 2 * WAD {
        m /= 2;
        k += 1;
    }
    while m < WAD {
        m = m.checked_mul(2)?;
        k -= 1;
    }

    // z = (m - WAD) / (m + WAD), WAD-fixed, in [0, 1/3].
    let z = (m - WAD).checked_mul(WAD)? / (m + WAD);
    let z2 = z.checked_mul(z)? / WAD; // z^2, WAD-fixed (<= ~1/9)

    let mut term = z; // z^(2n+1), starting at z^1
    let mut sum = z;
    let mut n: i128 = 3;
    // z^2 <= 1/9 so terms decay ~9x each step; 24 terms is far past 1e-18.
    while n <= 49 {
        term = term.checked_mul(z2)? / WAD;
        sum = sum.checked_add(term / n)?;
        n += 2;
    }

    let ln_mant = sum.checked_mul(2)?;
    k.checked_mul(LN2_WAD)?.checked_add(ln_mant)
}

fn ln_wad_or_panic(env: &Env, value: i128) -> i128 {
    match ln_wad_checked(value) {
        Some(v) => v,
        None => panic_with_error!(env, Error::MathOverflow),
    }
}

fn try_ln_wad(_env: &Env, value: i128) -> Option<i128> {
    ln_wad_checked(value)
}

// e^x for WAD-fixed signed x, returned WAD-fixed. Range-reduce x = k*ln2 + r
// with |r| <= ln2/2, so e^x = 2^k * e^r, and evaluate e^r with its Taylor
// series (|r| <= 0.347 converges in a handful of terms).
fn exp_wad_checked(value: i128) -> Option<i128> {
    let k = if value >= 0 {
        (value + LN2_WAD / 2) / LN2_WAD
    } else {
        (value - LN2_WAD / 2) / LN2_WAD
    };
    let r = value.checked_sub(k.checked_mul(LN2_WAD)?)?; // |r| <= ln2/2

    let mut term = WAD; // r^0 / 0! = 1
    let mut sum = WAD;
    let mut i: i128 = 1;
    while i <= 20 {
        term = term.checked_mul(r)? / WAD / i; // term *= r/i
        if term == 0 {
            break;
        }
        sum = sum.checked_add(term)?;
        i += 1;
    }

    // Apply the 2^k factor.
    if k >= 0 {
        if k > 90 {
            return None; // e^x too large to represent in i128 WAD-fixed
        }
        sum.checked_mul(1i128 << k)
    } else {
        let shift = (-k) as u32;
        if shift >= 127 {
            return Some(0);
        }
        Some(sum >> shift)
    }
}

fn exp_wad_or_panic(env: &Env, value: i128) -> i128 {
    match exp_wad_checked(value) {
        Some(v) => v,
        None => panic_with_error!(env, Error::MathOverflow),
    }
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

fn checked_bounded_reserve_add(env: &Env, lhs: i128, rhs: i128) -> i128 {
    let value = checked_add(env, lhs, rhs);
    require_within_reserve_bounds(env, value);
    value
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
    use sidereal_sy_wrapper::{SyWrapper, SyWrapperClient};
    use soroban_sdk::testutils::{
        storage::Persistent, Address as _, Deployer, EnvTestConfig, Ledger,
    };
    use std::panic::{catch_unwind, AssertUnwindSafe};

    const NOW: u64 = 1_770_000_000;
    const MATURITY: u64 = NOW + 90 * DAY;
    const SCALAR_ROOT: i128 = 2 * WAD;
    const INITIAL_ANCHOR: i128 = 1_050_000_000_000_000_000;
    const FEE_BPS: i128 = 10;
    const TWAP_WINDOW: u64 = 30 * 60;
    const INITIAL_TOKEN_BALANCE: i128 = 10_000_000;

    struct Fixture {
        env: Env,
        client: AmmMarketClient<'static>,
        contract_id: Address,
        admin: Address,
        underlying: Address,
        pt_token: Address,
        sy_token: Address,
        yt_token: Address,
        tokenizer: Address,
        bob: Address,
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
        let pt_token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        // A real SY wrapper in idle mock-custody mode (no Blend pool), so the
        // YT quote paths can read exchange_rate the same way the tokenizer
        // does. All unit tests run at the default rate of 1.0, where SY shares
        // and asset units coincide; the non-par flash routes are exercised in
        // tests/integration.
        let underlying = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let sy_token = env.register(SyWrapper, ());
        SyWrapperClient::new(&env, &sy_token).initialize(&admin, &underlying);
        // A placeholder YT token; the unit fixture uses a stub tokenizer, so the
        // YT flash routes are exercised in tests/integration instead.
        let yt_token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let tokenizer = Address::generate(&env);
        let bob = Address::generate(&env);

        token::StellarAssetClient::new(&env, &pt_token).mint(&admin, &INITIAL_TOKEN_BALANCE);
        token::StellarAssetClient::new(&env, &underlying).mint(&admin, &INITIAL_TOKEN_BALANCE);
        SyWrapperClient::new(&env, &sy_token).deposit(&admin, &INITIAL_TOKEN_BALANCE);

        Fixture {
            env,
            client,
            contract_id,
            admin,
            underlying,
            pt_token,
            sy_token,
            yt_token,
            tokenizer,
            bob,
        }
    }

    fn pt_balance(fixture: &Fixture, holder: &Address) -> i128 {
        token::TokenClient::new(&fixture.env, &fixture.pt_token).balance(holder)
    }

    fn sy_balance(fixture: &Fixture, holder: &Address) -> i128 {
        token::TokenClient::new(&fixture.env, &fixture.sy_token).balance(holder)
    }

    fn pool_pt_balance(fixture: &Fixture) -> i128 {
        pt_balance(fixture, &fixture.contract_id)
    }

    fn pool_sy_balance(fixture: &Fixture) -> i128 {
        sy_balance(fixture, &fixture.contract_id)
    }

    fn mint_pt(fixture: &Fixture, holder: &Address, amount: i128) {
        token::StellarAssetClient::new(&fixture.env, &fixture.pt_token).mint(holder, &amount);
    }

    /// Mints `amount` SY shares to `holder` by depositing underlying at the
    /// wrapper's default 1.0 rate (1 underlying deposits to 1 share).
    fn mint_sy(fixture: &Fixture, holder: &Address, amount: i128) {
        token::StellarAssetClient::new(&fixture.env, &fixture.underlying).mint(holder, &amount);
        SyWrapperClient::new(&fixture.env, &fixture.sy_token).deposit(holder, &amount);
    }

    fn burn_pt(fixture: &Fixture, holder: &Address, amount: i128) {
        token::TokenClient::new(&fixture.env, &fixture.pt_token).burn(holder, &amount);
    }

    /// Burns `amount` SY shares from `holder` by redeeming them for underlying
    /// at the wrapper's default 1.0 rate.
    fn burn_sy(fixture: &Fixture, holder: &Address, amount: i128) {
        SyWrapperClient::new(&fixture.env, &fixture.sy_token).redeem(holder, &amount);
    }

    fn initialize(fixture: &Fixture) {
        fixture.client.initialize(
            &fixture.admin,
            &fixture.pt_token,
            &fixture.sy_token,
            &fixture.yt_token,
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
                yt_token: fixture.yt_token,
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
        assert_eq!(fixture.client.spot_apy(), 0);
        assert_eq!(fixture.client.reserve_pt(), 0);
        assert_eq!(fixture.client.reserve_sy(), 0);
        assert_eq!(fixture.client.total_lp(), 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #18)")]
    fn initialize_rejects_curve_inputs_above_testnet_bounds() {
        let fixture = fixture(NOW);
        fixture.client.initialize(
            &fixture.admin,
            &fixture.pt_token,
            &fixture.sy_token,
            &fixture.yt_token,
            &fixture.tokenizer,
            &MATURITY,
            &(MAX_SCALAR_ROOT + 1),
            &INITIAL_ANCHOR,
            &FEE_BPS,
            &TWAP_WINDOW,
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #18)")]
    fn liquidity_rejects_amounts_above_testnet_bounds() {
        let fixture = fixture(NOW);
        initialize(&fixture);

        fixture
            .client
            .add_liquidity(&fixture.admin, &(MAX_RESERVE_UNITS + 1), &10_000, &0);
    }

    #[test]
    fn bump_ttl_extends_idle_market_instance_ttl() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        lower_instance_ttl_below_threshold(&fixture);

        fixture.client.bump_ttl();

        assert!(
            fixture
                .env
                .deployer()
                .get_contract_instance_ttl(&fixture.contract_id)
                >= AMM_INSTANCE_TTL_EXTEND_TO_LEDGERS
        );
    }

    #[test]
    fn bump_lp_ttl_extends_idle_lp_balance_ttl() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &10_000, &10_000, &0);

        let key = DataKey::LpBalance(fixture.admin.clone());
        let ttl = fixture.env.as_contract(&fixture.contract_id, || {
            fixture.env.storage().persistent().get_ttl(&key)
        });
        assert!(ttl > AMM_INSTANCE_TTL_THRESHOLD_LEDGERS);

        let target_ttl = AMM_INSTANCE_TTL_THRESHOLD_LEDGERS - 1;
        fixture
            .env
            .ledger()
            .set_sequence_number(fixture.env.ledger().sequence() + ttl - target_ttl);
        fixture.env.as_contract(&fixture.contract_id, || {
            assert!(
                fixture.env.storage().persistent().get_ttl(&key)
                    < AMM_INSTANCE_TTL_THRESHOLD_LEDGERS
            );
        });

        fixture.client.bump_lp_ttl(&fixture.admin);

        fixture.env.as_contract(&fixture.contract_id, || {
            assert!(
                fixture.env.storage().persistent().get_ttl(&key)
                    >= AMM_INSTANCE_TTL_EXTEND_TO_LEDGERS
            );
        });
    }

    #[test]
    fn mutating_entrypoints_extend_instance_ttl() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        lower_instance_ttl_below_threshold(&fixture);

        fixture
            .client
            .add_liquidity(&fixture.admin, &10_000, &10_000, &0);

        assert!(
            fixture
                .env
                .deployer()
                .get_contract_instance_ttl(&fixture.contract_id)
                >= AMM_INSTANCE_TTL_EXTEND_TO_LEDGERS
        );
    }

    #[test]
    fn first_liquidity_seeds_market_state() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        let admin_pt_before = pt_balance(&fixture, &fixture.admin);
        let admin_sy_before = sy_balance(&fixture, &fixture.admin);

        let lp_out = fixture
            .client
            .add_liquidity(&fixture.admin, &10_000, &10_000, &0);
        let state = fixture.client.state();

        assert_eq!(lp_out, 9_000);
        assert_eq!(state.total_pt, 10_000);
        assert_eq!(state.total_sy, 10_000);
        assert_eq!(state.total_lp, 10_000);
        assert_eq!(fixture.client.lp_balance(&fixture.admin), 9_000);
        assert!(state.last_ln_implied_rate > 0);
        assert_eq!(state.last_ln_implied_rate, state.twap_ln_implied_rate);
        assert!(fixture.client.implied_apy() > 0);
        assert_eq!(pool_pt_balance(&fixture), state.total_pt);
        assert_eq!(pool_sy_balance(&fixture), state.total_sy);
        assert_eq!(
            pt_balance(&fixture, &fixture.admin),
            admin_pt_before - 10_000
        );
        assert_eq!(
            sy_balance(&fixture, &fixture.admin),
            admin_sy_before - 10_000
        );
    }

    #[test]
    fn remove_liquidity_returns_pro_rata_assets() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        let admin_pt_before = pt_balance(&fixture, &fixture.admin);
        let admin_sy_before = sy_balance(&fixture, &fixture.admin);
        fixture
            .client
            .add_liquidity(&fixture.admin, &10_000, &10_000, &0);

        let (pt_out, sy_out) = fixture.client.remove_liquidity(&fixture.admin, &9_000, &0, &0);
        let state = fixture.client.state();

        assert_eq!((pt_out, sy_out), (9_000, 9_000));
        assert_eq!(state.total_pt, 1_000);
        assert_eq!(state.total_sy, 1_000);
        assert_eq!(state.total_lp, 1_000);
        assert_eq!(fixture.client.lp_balance(&fixture.admin), 0);
        assert_eq!(pool_pt_balance(&fixture), 1_000);
        assert_eq!(pool_sy_balance(&fixture), 1_000);
        assert_eq!(
            pt_balance(&fixture, &fixture.admin),
            admin_pt_before - 1_000
        );
        assert_eq!(
            sy_balance(&fixture, &fixture.admin),
            admin_sy_before - 1_000
        );
    }

    #[test]
    fn remove_liquidity_after_maturity_returns_pro_rata_assets() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        let admin_pt_before = pt_balance(&fixture, &fixture.admin);
        let admin_sy_before = sy_balance(&fixture, &fixture.admin);
        fixture
            .client
            .add_liquidity(&fixture.admin, &10_000, &10_000, &0);

        fixture.env.ledger().set_timestamp(MATURITY);
        let (pt_out, sy_out) = fixture.client.remove_liquidity(&fixture.admin, &9_000, &0, &0);
        let state = fixture.client.state();

        assert_eq!((pt_out, sy_out), (9_000, 9_000));
        assert_eq!(state.total_pt, 1_000);
        assert_eq!(state.total_sy, 1_000);
        assert_eq!(state.total_lp, 1_000);
        assert_eq!(fixture.client.lp_balance(&fixture.admin), 0);
        assert_eq!(pool_pt_balance(&fixture), 1_000);
        assert_eq!(pool_sy_balance(&fixture), 1_000);
        assert_eq!(
            pt_balance(&fixture, &fixture.admin),
            admin_pt_before - 1_000
        );
        assert_eq!(
            sy_balance(&fixture, &fixture.admin),
            admin_sy_before - 1_000
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #11)")]
    fn add_liquidity_reverts_when_min_lp_out_not_met() {
        let fixture = fixture(NOW);
        initialize(&fixture);

        // The initial seed mints sqrt(10_000 * 10_000) - MINIMUM_LIQUIDITY
        // = 9_000 LP; asking for one more must revert with SlippageExceeded.
        fixture
            .client
            .add_liquidity(&fixture.admin, &10_000, &10_000, &9_001);
    }

    #[test]
    fn add_liquidity_passes_exact_min_lp_out() {
        let fixture = fixture(NOW);
        initialize(&fixture);

        let lp_out = fixture
            .client
            .add_liquidity(&fixture.admin, &10_000, &10_000, &9_000);
        assert_eq!(lp_out, 9_000);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #11)")]
    fn add_liquidity_min_lp_out_catches_ratio_move_between_quote_and_execution() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        mint_pt(&fixture, &fixture.bob, 1_000);
        mint_sy(&fixture, &fixture.bob, 1_000);

        // Quoted off the seeded 20_000/20_000 pool: 1_000 PT + 1_000 SY mints
        // 1_000 LP. Someone else moves the ratio before bob executes.
        let stale_quote = 1_000;
        mint_sy(&fixture, &fixture.admin, 2_000);
        fixture.client.swap_sy_for_pt(&fixture.admin, &2_000, &1);

        // With total_sy grown past 20_000, lp_by_sy = 1_000 * total_lp /
        // total_sy < 1_000, so the stale min must revert.
        fixture
            .client
            .add_liquidity(&fixture.bob, &1_000, &1_000, &stale_quote);
    }

    #[test]
    fn add_liquidity_generous_min_survives_ratio_move() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        mint_pt(&fixture, &fixture.bob, 1_000);
        mint_sy(&fixture, &fixture.bob, 1_000);
        mint_sy(&fixture, &fixture.admin, 2_000);
        fixture.client.swap_sy_for_pt(&fixture.admin, &2_000, &1);

        let lp_out = fixture
            .client
            .add_liquidity(&fixture.bob, &1_000, &1_000, &900);
        assert!(lp_out >= 900 && lp_out < 1_000);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #11)")]
    fn remove_liquidity_reverts_when_min_sy_out_not_met() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        // Quoted pro-rata for 1_000 LP: 1_000 PT and 1_000 SY. A PT seller
        // drains SY from the pool before the removal executes, so the stale
        // min_sy_out must revert.
        let stale_sy_quote = 1_000;
        mint_pt(&fixture, &fixture.admin, 2_000);
        fixture.client.swap_pt_for_sy(&fixture.admin, &2_000, &1);

        fixture
            .client
            .remove_liquidity(&fixture.admin, &1_000, &0, &stale_sy_quote);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #11)")]
    fn remove_liquidity_reverts_when_min_pt_out_not_met() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        // A PT buyer drains PT from the pool, so pt_out per LP falls below the
        // stale pro-rata quote of 1_000.
        let stale_pt_quote = 1_000;
        mint_sy(&fixture, &fixture.admin, 2_000);
        fixture.client.swap_sy_for_pt(&fixture.admin, &2_000, &1);

        fixture
            .client
            .remove_liquidity(&fixture.admin, &1_000, &stale_pt_quote, &0);
    }

    #[test]
    fn remove_liquidity_generous_bounds_pass_after_ratio_move() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        mint_pt(&fixture, &fixture.admin, 2_000);
        fixture.client.swap_pt_for_sy(&fixture.admin, &2_000, &1);

        let (pt_out, sy_out) = fixture
            .client
            .remove_liquidity(&fixture.admin, &1_000, &1_000, &900);
        assert!(pt_out >= 1_000, "PT per LP grew after the PT sell");
        assert!(sy_out >= 900 && sy_out < 1_000, "SY per LP shrank");
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #10)")]
    fn add_liquidity_rejects_after_maturity() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &10_000, &10_000, &0);

        fixture.env.ledger().set_timestamp(MATURITY);
        fixture.client.add_liquidity(&fixture.admin, &1_000, &1_000, &0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #10)")]
    fn swap_pt_for_sy_rejects_after_maturity() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        mint_pt(&fixture, &fixture.admin, 1_000);

        fixture.env.ledger().set_timestamp(MATURITY);
        fixture.client.swap_pt_for_sy(&fixture.admin, &1_000, &1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #10)")]
    fn swap_sy_for_pt_rejects_after_maturity() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        mint_sy(&fixture, &fixture.admin, 1_000);

        fixture.env.ledger().set_timestamp(MATURITY);
        fixture.client.swap_sy_for_pt(&fixture.admin, &1_000, &1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #10)")]
    fn swap_sy_for_yt_rejects_after_maturity() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        mint_sy(&fixture, &fixture.admin, 1_000);

        fixture.env.ledger().set_timestamp(MATURITY);
        fixture.client.swap_sy_for_yt(&fixture.admin, &1_000, &1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #10)")]
    fn swap_yt_for_sy_rejects_after_maturity() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        fixture.env.ledger().set_timestamp(MATURITY);
        fixture.client.swap_yt_for_sy(&fixture.admin, &1_000, &1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #12)")]
    fn non_lp_cannot_remove_liquidity() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &10_000, &10_000, &0);

        fixture.client.remove_liquidity(&fixture.bob, &1_000, &0, &0);
    }

    #[test]
    fn swap_pt_for_sy_updates_reserves_and_observation() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        mint_pt(&fixture, &fixture.admin, 1_000);
        let admin_pt_before = pt_balance(&fixture, &fixture.admin);
        let admin_sy_before = sy_balance(&fixture, &fixture.admin);

        fixture.env.ledger().set_timestamp(NOW + 60);
        let sy_out = fixture.client.swap_pt_for_sy(&fixture.admin, &1_000, &1);
        let state = fixture.client.state();

        assert!(sy_out > 0);
        assert_eq!(state.total_pt, 21_000);
        assert_eq!(state.total_sy, 20_000 - sy_out);
        assert_eq!(state.last_observation, NOW + 60);
        assert!(state.twap_ln_implied_rate > 0);
        assert_eq!(pool_pt_balance(&fixture), state.total_pt);
        assert_eq!(pool_sy_balance(&fixture), state.total_sy);
        assert_eq!(
            pt_balance(&fixture, &fixture.admin),
            admin_pt_before - 1_000
        );
        assert_eq!(
            sy_balance(&fixture, &fixture.admin),
            admin_sy_before + sy_out
        );
    }

    #[test]
    fn swap_sy_for_pt_updates_reserves_and_observation() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        mint_sy(&fixture, &fixture.admin, 1_000);
        let admin_pt_before = pt_balance(&fixture, &fixture.admin);
        let admin_sy_before = sy_balance(&fixture, &fixture.admin);

        fixture.env.ledger().set_timestamp(NOW + 60);
        let pt_out = fixture.client.swap_sy_for_pt(&fixture.admin, &1_000, &1);
        let state = fixture.client.state();

        assert!(pt_out > 0);
        assert_eq!(state.total_pt, 20_000 - pt_out);
        assert_eq!(state.total_sy, 21_000);
        assert_eq!(state.last_observation, NOW + 60);
        assert!(state.twap_ln_implied_rate > 0);
        assert_eq!(pool_pt_balance(&fixture), state.total_pt);
        assert_eq!(pool_sy_balance(&fixture), state.total_sy);
        assert_eq!(
            pt_balance(&fixture, &fixture.admin),
            admin_pt_before + pt_out
        );
        assert_eq!(
            sy_balance(&fixture, &fixture.admin),
            admin_sy_before - 1_000
        );
    }

    #[test]
    fn sy_exact_in_swaps_credit_full_input_to_reserves() {
        let pt_fixture = fixture(NOW);
        initialize(&pt_fixture);
        pt_fixture
            .client
            .add_liquidity(&pt_fixture.admin, &20_000, &20_000, &0);
        let (sy_in, required_sy) = sy_in_with_rounding_gap(&pt_fixture);
        assert!(required_sy < sy_in);

        let before = pt_fixture.client.state();
        pt_fixture
            .client
            .swap_sy_for_pt(&pt_fixture.admin, &sy_in, &1);
        let after = pt_fixture.client.state();
        assert_eq!(after.total_sy, before.total_sy + sy_in);
    }

    #[test]
    fn same_timestamp_swaps_do_not_overwrite_twap() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        fixture.env.ledger().set_timestamp(NOW + 60);
        fixture.client.swap_sy_for_pt(&fixture.admin, &1_000, &1);
        let after_first = fixture.client.state();

        fixture.client.swap_sy_for_pt(&fixture.admin, &1_500, &1);
        let after_second = fixture.client.state();

        assert_ne!(
            after_second.last_ln_implied_rate, after_first.twap_ln_implied_rate,
            "second swap must move spot so this test proves TWAP did not follow it"
        );
        assert_eq!(after_second.last_observation, after_first.last_observation);
        assert_eq!(
            after_second.twap_ln_implied_rate,
            after_first.twap_ln_implied_rate
        );
    }

    // The YT flash swaps move real tokens through the tokenizer and are
    // exercised end to end in tests/integration. Here we assert the pure
    // pricing the routes are built on.
    #[test]
    fn quote_sy_for_yt_is_leveraged() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        // Buying YT is leveraged: each SY buys more than its face in YT,
        // because the freshly minted PT is sold to fund the position.
        let yt_out = fixture.client.quote_sy_for_yt(&1_000);
        assert!(yt_out > 1_000);
    }

    #[test]
    fn quote_yt_for_sy_is_below_face() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        // Selling YT yields less SY than its face: PT must be repurchased to
        // complete the recombine.
        let sy_out = fixture.client.quote_yt_for_sy(&1_000);
        assert!(sy_out > 0 && sy_out < 1_000);
    }

    #[test]
    fn read_accessors_match_state_and_rate_views() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        fixture.env.ledger().set_timestamp(NOW + 60);
        fixture.client.swap_sy_for_pt(&fixture.admin, &1_000, &1);

        let state = fixture.client.state();

        assert_eq!(fixture.client.reserve_pt(), state.total_pt);
        assert_eq!(fixture.client.reserve_sy(), state.total_sy);
        assert_eq!(fixture.client.total_lp(), state.total_lp);
        assert_eq!(fixture.client.spot_apy(), fixture.client.implied_apy());
        assert!(fixture.client.twap_apy() > 0);
        assert_eq!(fixture.client.reserve_pt(), pool_pt_balance(&fixture));
        assert_eq!(fixture.client.reserve_sy(), pool_sy_balance(&fixture));
    }

    #[test]
    fn rate_views_track_warmup_and_zero_at_maturity() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        assert!(fixture.client.twap_warming_up());

        fixture.env.ledger().set_timestamp(NOW + TWAP_WINDOW);
        assert!(!fixture.client.twap_warming_up());

        fixture.env.ledger().set_timestamp(MATURITY);
        assert_eq!(fixture.client.implied_apy(), 0);
        assert_eq!(fixture.client.spot_apy(), 0);
        assert_eq!(fixture.client.twap_apy(), 0);
        assert!(!fixture.client.twap_warming_up());
    }

    /// After an idle gap of a full TWAP window, the next swap's observation
    /// fully replaces the TWAP (there is no history worth blending). One trade
    /// deciding the oracle value is the manipulation window the TWAP exists to
    /// close, so that snap must re-enter warm-up: consumers gating on
    /// twap_warming_up ignore the value until a fresh window has passed.
    #[test]
    fn twap_re_enters_warmup_after_an_idle_gap_snaps_it() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        // Trade while warm so the TWAP has a real blended history, then let
        // the initial warm-up lapse.
        fixture.env.ledger().set_timestamp(NOW + 60);
        fixture.client.swap_sy_for_pt(&fixture.admin, &1_000, &1);
        fixture.env.ledger().set_timestamp(NOW + TWAP_WINDOW + 61);
        assert!(!fixture.client.twap_warming_up(), "warmed up after a window");

        // Idle for well over a full window, then a single swap lands: the
        // observation snaps the TWAP, so the market must declare itself
        // warming up again for a full window from that swap.
        let after_gap = NOW + TWAP_WINDOW + 61 + 3 * TWAP_WINDOW;
        fixture.env.ledger().set_timestamp(after_gap);
        fixture.client.swap_sy_for_pt(&fixture.admin, &1_000, &1);
        assert!(
            fixture.client.twap_warming_up(),
            "a full-window idle snap must re-enter warm-up"
        );

        fixture.env.ledger().set_timestamp(after_gap + TWAP_WINDOW);
        assert!(
            !fixture.client.twap_warming_up(),
            "trust returns after a fresh window"
        );
    }

    #[test]
    fn quote_accessors_match_pt_route_execution_without_mutating_state() {
        let first_fixture = fixture(NOW);
        initialize(&first_fixture);
        first_fixture
            .client
            .add_liquidity(&first_fixture.admin, &20_000, &20_000, &0);

        let before = first_fixture.client.state();
        let quoted_sy_out = first_fixture.client.quote_pt_for_sy(&1_000);
        let quoted_pt_out = first_fixture.client.quote_sy_for_pt(&1_000);
        let after_quote = first_fixture.client.state();

        assert_eq!(before, after_quote);
        assert_eq!(
            quoted_sy_out,
            first_fixture
                .client
                .swap_pt_for_sy(&first_fixture.admin, &1_000, &1)
        );

        let second_fixture = fixture(NOW);
        initialize(&second_fixture);
        second_fixture
            .client
            .add_liquidity(&second_fixture.admin, &20_000, &20_000, &0);
        assert_eq!(
            quoted_pt_out,
            second_fixture
                .client
                .swap_sy_for_pt(&second_fixture.admin, &1_000, &1)
        );
    }

    #[test]
    fn quote_yt_accessors_do_not_mutate_state() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);

        let before = fixture.client.state();
        assert!(fixture.client.quote_sy_for_yt(&1_000) > 0);
        assert!(fixture.client.quote_yt_for_sy(&1_000) > 0);
        let after_quote = fixture.client.state();

        assert_eq!(before, after_quote);
    }

    #[test]
    fn quote_accessors_return_typed_errors_before_trade_execution() {
        let fixture = fixture(NOW);
        initialize(&fixture);

        assert_eq!(
            fixture
                .env
                .as_contract(&fixture.contract_id, || AmmMarket::quote_pt_for_sy(
                    fixture.env.clone(),
                    0
                )),
            Err(Error::InvalidAmount)
        );
        assert_eq!(
            fixture
                .env
                .as_contract(&fixture.contract_id, || AmmMarket::quote_sy_for_pt(
                    fixture.env.clone(),
                    0
                )),
            Err(Error::InvalidAmount)
        );
        assert_eq!(
            fixture.env.as_contract(&fixture.contract_id, || {
                AmmMarket::quote_sy_for_yt(fixture.env.clone(), 1_000)
            }),
            Err(Error::MarketNotSeeded)
        );
        assert_eq!(
            fixture.env.as_contract(&fixture.contract_id, || {
                AmmMarket::quote_yt_for_sy(fixture.env.clone(), 1_000)
            }),
            Err(Error::MarketNotSeeded)
        );
    }

    #[test]
    fn quote_accessors_reject_matured_market() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .add_liquidity(&fixture.admin, &20_000, &20_000, &0);
        fixture.env.ledger().set_timestamp(MATURITY);

        assert_eq!(
            fixture.env.as_contract(&fixture.contract_id, || {
                AmmMarket::quote_pt_for_sy(fixture.env.clone(), 1_000)
            }),
            Err(Error::MarketMatured)
        );
        assert_eq!(
            fixture.env.as_contract(&fixture.contract_id, || {
                AmmMarket::quote_sy_for_pt(fixture.env.clone(), 1_000)
            }),
            Err(Error::MarketMatured)
        );
        assert_eq!(
            fixture.env.as_contract(&fixture.contract_id, || {
                AmmMarket::quote_sy_for_yt(fixture.env.clone(), 1_000)
            }),
            Err(Error::MarketMatured)
        );
        assert_eq!(
            fixture.env.as_contract(&fixture.contract_id, || {
                AmmMarket::quote_yt_for_sy(fixture.env.clone(), 1_000)
            }),
            Err(Error::MarketMatured)
        );
    }

    #[derive(Clone, Debug)]
    enum ModelOp {
        Split(i128),
        Recombine(i128),
        BuyPt(i128),
        SellPt(i128),
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
        (0u8..4, 1i128..100i128).prop_map(|(kind, amount)| match kind {
            0 => ModelOp::Split(amount),
            1 => ModelOp::Recombine(amount),
            2 => ModelOp::BuyPt(amount),
            _ => ModelOp::SellPt(amount),
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

    fn sy_in_with_rounding_gap(fixture: &Fixture) -> (i128, i128) {
        let config = fixture.client.config();
        let state = fixture.client.state();
        let comp = precompute_or_panic(&fixture.env, &config, &state);

        for sy_in in 1..5_000 {
            let Some(pt_out) = quote_sy_for_pt(fixture, sy_in) else {
                continue;
            };
            let required_sy = catch_unwind(AssertUnwindSafe(|| {
                exact_pt_out_sy_in_or_panic(&fixture.env, &config, &state, &comp, pt_out)
            }));
            let Ok(required_sy) = required_sy else {
                continue;
            };
            if required_sy < sy_in {
                return (sy_in, required_sy);
            }
        }

        panic!("expected a SY input with rounding gap");
    }

    fn lower_instance_ttl_below_threshold(fixture: &Fixture) {
        let ttl = fixture
            .env
            .deployer()
            .get_contract_instance_ttl(&fixture.contract_id);
        assert!(ttl > AMM_INSTANCE_TTL_THRESHOLD_LEDGERS);

        let target_ttl = AMM_INSTANCE_TTL_THRESHOLD_LEDGERS - 1;
        let ledgers_to_advance = ttl - target_ttl;
        fixture
            .env
            .ledger()
            .set_sequence_number(fixture.env.ledger().sequence() + ledgers_to_advance);
        assert!(
            fixture
                .env
                .deployer()
                .get_contract_instance_ttl(&fixture.contract_id)
                < AMM_INSTANCE_TTL_THRESHOLD_LEDGERS
        );
    }

    proptest! {
        #![proptest_config(ProptestConfig {
            cases: 10_000,
            .. ProptestConfig::default()
        })]

        #[test]
        fn pt_yt_sy_invariant_holds_across_random_sequences(ops in prop::collection::vec(arb_op(), 1..8)) {
            let fixture = fixture(NOW);
            initialize(&fixture);
            burn_pt(&fixture, &fixture.admin, INITIAL_TOKEN_BALANCE);
            burn_sy(&fixture, &fixture.admin, INITIAL_TOKEN_BALANCE);
            mint_pt(&fixture, &fixture.admin, 2_000_000);
            mint_sy(&fixture, &fixture.admin, 2_000_000);
            fixture.client.add_liquidity(&fixture.admin, &1_000_000, &1_000_000, &0);

            let mut model = PositionModel::new(1_000_000);
            let mut wallet_pt = 1_000_000;
            let mut wallet_sy = 1_000_000;

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
                        if wallet_sy >= amount
                            && model.free_sy >= amount
                            && quote_sy_for_pt(&fixture, amount).is_some() =>
                    {
                        let pt_out = fixture.client.swap_sy_for_pt(&fixture.admin, &amount, &1);
                        wallet_sy -= amount;
                        wallet_pt += pt_out;
                        model.free_sy -= amount;
                        model.free_pt += pt_out;
                    }
                    ModelOp::SellPt(amount)
                        if wallet_pt >= amount
                            && model.free_pt >= amount
                            && quote_pt_for_sy(&fixture, amount).is_some() =>
                    {
                        let sy_out = fixture.client.swap_pt_for_sy(&fixture.admin, &amount, &1);
                        wallet_pt -= amount;
                        wallet_sy += sy_out;
                        model.free_pt -= amount;
                        model.free_sy += sy_out;
                    }
                    _ => {}
                }

                model.assert_invariant();
            }

            assert_eq!(pt_balance(&fixture, &fixture.admin), wallet_pt);
            assert_eq!(sy_balance(&fixture, &fixture.admin), wallet_sy);
            assert_eq!(pool_pt_balance(&fixture), fixture.client.reserve_pt());
            assert_eq!(pool_sy_balance(&fixture), fixture.client.reserve_sy());
        }
    }
}
