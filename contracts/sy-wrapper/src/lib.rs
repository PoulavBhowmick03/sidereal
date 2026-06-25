// SPDX-License-Identifier: Apache-2.0

#![cfg_attr(target_family = "wasm", no_std)]

use sidereal_shared_types::StandardizedYield;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env,
};

const WAD: i128 = 1_000_000_000_000_000_000;

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Config {
    pub admin: Address,
    pub underlying: Address,
}

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Config,
    ExchangeRate,
    TotalShares,
    HolderShares(Address),
    HolderPrincipal(Address),
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
#[contracterror]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    InvalidExchangeRate = 4,
    InsufficientBalance = 5,
    MathOverflow = 6,
}

#[contract]
pub struct SyWrapper;

#[contractimpl]
impl SyWrapper {
    pub fn initialize(env: Env, admin: Address, underlying: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();

        let config = Config { admin, underlying };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::ExchangeRate, &WAD);
        env.storage().instance().set(&DataKey::TotalShares, &0_i128);

        Ok(())
    }

    pub fn config(env: Env) -> Result<Config, Error> {
        Self::read_config(&env)
    }

    pub fn set_exchange_rate(env: Env, admin: Address, exchange_rate: i128) -> Result<(), Error> {
        let config = Self::read_config(&env)?;
        admin.require_auth();
        if admin != config.admin {
            return Err(Error::NotInitialized);
        }
        Self::require_exchange_rate(exchange_rate)?;

        env.storage()
            .instance()
            .set(&DataKey::ExchangeRate, &exchange_rate);

        Ok(())
    }

    pub fn share_balance(env: Env, holder: Address) -> Result<i128, Error> {
        Self::read_config(&env)?;
        Ok(env
            .storage()
            .instance()
            .get(&DataKey::HolderShares(holder))
            .unwrap_or(0))
    }

    pub fn total_shares(env: Env) -> Result<i128, Error> {
        Self::read_config(&env)?;
        Ok(env
            .storage()
            .instance()
            .get(&DataKey::TotalShares)
            .unwrap_or(0))
    }

    fn read_config(env: &Env) -> Result<Config, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }

    fn require_positive_amount(amount: i128) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        Ok(())
    }

    fn require_exchange_rate(exchange_rate: i128) -> Result<(), Error> {
        if exchange_rate <= 0 {
            return Err(Error::InvalidExchangeRate);
        }

        Ok(())
    }
}

impl StandardizedYield for SyWrapper {
    fn deposit(env: &Env, from: Address, amount: i128) -> i128 {
        require_init(env);
        from.require_auth();
        if let Err(error) = Self::require_positive_amount(amount) {
            panic_with_error!(env, error);
        }

        let exchange_rate = <Self as StandardizedYield>::exchange_rate(env);
        let shares = mul_div_or_panic(env, amount, WAD, exchange_rate);
        if shares <= 0 {
            panic_with_error!(env, Error::InvalidAmount);
        }

        let current_shares: i128 = env
            .storage()
            .instance()
            .get(&DataKey::HolderShares(from.clone()))
            .unwrap_or(0);
        let current_principal: i128 = env
            .storage()
            .instance()
            .get(&DataKey::HolderPrincipal(from.clone()))
            .unwrap_or(0);
        let total_shares: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalShares)
            .unwrap_or(0);

        env.storage().instance().set(
            &DataKey::HolderShares(from.clone()),
            &add_or_panic(env, current_shares, shares),
        );
        env.storage().instance().set(
            &DataKey::HolderPrincipal(from),
            &add_or_panic(env, current_principal, amount),
        );
        env.storage().instance().set(
            &DataKey::TotalShares,
            &add_or_panic(env, total_shares, shares),
        );

        shares
    }

    fn redeem(env: &Env, from: Address, sy_amount: i128) -> i128 {
        require_init(env);
        from.require_auth();
        if let Err(error) = Self::require_positive_amount(sy_amount) {
            panic_with_error!(env, error);
        }

        let exchange_rate = <Self as StandardizedYield>::exchange_rate(env);
        let current_shares: i128 = env
            .storage()
            .instance()
            .get(&DataKey::HolderShares(from.clone()))
            .unwrap_or(0);
        let current_principal: i128 = env
            .storage()
            .instance()
            .get(&DataKey::HolderPrincipal(from.clone()))
            .unwrap_or(0);
        let total_shares: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalShares)
            .unwrap_or(0);

        if sy_amount > current_shares {
            panic_with_error!(env, Error::InsufficientBalance);
        }

        let underlying_out = mul_div_or_panic(env, sy_amount, exchange_rate, WAD);
        let principal_out = if current_shares == 0 {
            0
        } else {
            mul_div_or_panic(env, current_principal, sy_amount, current_shares)
        };

        env.storage().instance().set(
            &DataKey::HolderShares(from.clone()),
            &sub_or_panic(env, current_shares, sy_amount),
        );
        env.storage().instance().set(
            &DataKey::HolderPrincipal(from),
            &sub_or_panic(env, current_principal, principal_out),
        );
        env.storage().instance().set(
            &DataKey::TotalShares,
            &sub_or_panic(env, total_shares, sy_amount),
        );

        underlying_out
    }

    fn exchange_rate(env: &Env) -> i128 {
        require_init(env);
        env.storage()
            .instance()
            .get(&DataKey::ExchangeRate)
            .unwrap_or(WAD)
    }

    fn underlying(env: &Env) -> Address {
        match Self::read_config(env) {
            Ok(config) => config.underlying,
            Err(error) => panic_with_error!(env, error),
        }
    }

    fn accrued_yield(env: &Env, holder: Address) -> i128 {
        require_init(env);
        let exchange_rate = <Self as StandardizedYield>::exchange_rate(env);
        let shares: i128 = env
            .storage()
            .instance()
            .get(&DataKey::HolderShares(holder.clone()))
            .unwrap_or(0);
        let principal: i128 = env
            .storage()
            .instance()
            .get(&DataKey::HolderPrincipal(holder))
            .unwrap_or(0);
        let current_value = mul_div_or_panic(env, shares, exchange_rate, WAD);

        current_value.saturating_sub(principal)
    }
}

#[contractimpl]
impl SyWrapper {
    pub fn deposit(env: Env, from: Address, amount: i128) -> i128 {
        <Self as StandardizedYield>::deposit(&env, from, amount)
    }

    pub fn redeem(env: Env, from: Address, sy_amount: i128) -> i128 {
        <Self as StandardizedYield>::redeem(&env, from, sy_amount)
    }

    pub fn exchange_rate(env: Env) -> i128 {
        <Self as StandardizedYield>::exchange_rate(&env)
    }

    pub fn underlying(env: Env) -> Address {
        <Self as StandardizedYield>::underlying(&env)
    }

    pub fn accrued_yield(env: Env, holder: Address) -> i128 {
        <Self as StandardizedYield>::accrued_yield(&env, holder)
    }
}

fn mul_div_or_panic(env: &Env, lhs: i128, rhs: i128, denominator: i128) -> i128 {
    if denominator == 0 {
        panic_with_error!(env, Error::MathOverflow);
    }

    let lhs_gcd = gcd_i128(lhs, denominator);
    let lhs_reduced = lhs / lhs_gcd;
    let denominator_reduced = denominator / lhs_gcd;

    let rhs_gcd = gcd_i128(rhs, denominator_reduced);
    let rhs_reduced = rhs / rhs_gcd;
    let denominator_final = denominator_reduced / rhs_gcd;

    match lhs_reduced.checked_mul(rhs_reduced) {
        Some(product) => product / denominator_final,
        None => panic_with_error!(env, Error::MathOverflow),
    }
}

/// Panics with `NotInitialized` when the contract has no stored `Config`, so a
/// public SY method cannot read defaults or mutate state before `initialize`.
fn require_init(env: &Env) {
    if !env.storage().instance().has(&DataKey::Config) {
        panic_with_error!(env, Error::NotInitialized);
    }
}

fn add_or_panic(env: &Env, lhs: i128, rhs: i128) -> i128 {
    match lhs.checked_add(rhs) {
        Some(value) => value,
        None => panic_with_error!(env, Error::MathOverflow),
    }
}

fn sub_or_panic(env: &Env, lhs: i128, rhs: i128) -> i128 {
    match lhs.checked_sub(rhs) {
        Some(value) => value,
        None => panic_with_error!(env, Error::MathOverflow),
    }
}

fn gcd_i128(mut lhs: i128, mut rhs: i128) -> i128 {
    while rhs != 0 {
        let next = lhs % rhs;
        lhs = rhs;
        rhs = next;
    }

    if lhs < 0 {
        -lhs
    } else {
        lhs
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    struct Fixture {
        client: SyWrapperClient<'static>,
        admin: Address,
        underlying: Address,
        alice: Address,
    }

    fn fixture() -> Fixture {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(SyWrapper, ());
        let client = SyWrapperClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let underlying = Address::generate(&env);
        let alice = Address::generate(&env);

        Fixture {
            client,
            admin,
            underlying,
            alice,
        }
    }

    fn initialize(fixture: &Fixture) {
        fixture
            .client
            .initialize(&fixture.admin, &fixture.underlying);
    }

    #[test]
    fn initialize_sets_initial_exchange_rate() {
        let fixture = fixture();
        initialize(&fixture);

        assert_eq!(
            fixture.client.config(),
            Config {
                admin: fixture.admin,
                underlying: fixture.underlying,
            }
        );
        assert_eq!(fixture.client.exchange_rate(), WAD);
        assert_eq!(fixture.client.total_shares(), 0);
    }

    #[test]
    fn deposit_mints_shares_at_current_rate() {
        let fixture = fixture();
        initialize(&fixture);

        let minted = fixture.client.deposit(&fixture.alice, &(100 * WAD));

        assert_eq!(minted, 100 * WAD);
        assert_eq!(fixture.client.share_balance(&fixture.alice), 100 * WAD);
        assert_eq!(fixture.client.total_shares(), 100 * WAD);
    }

    #[test]
    fn accrued_yield_tracks_exchange_rate_growth() {
        let fixture = fixture();
        initialize(&fixture);
        fixture.client.deposit(&fixture.alice, &(100 * WAD));
        fixture
            .client
            .set_exchange_rate(&fixture.admin, &1_050_000_000_000_000_000);

        assert_eq!(fixture.client.accrued_yield(&fixture.alice), 5 * WAD);
    }

    #[test]
    fn redeem_returns_underlying_and_reduces_principal() {
        let fixture = fixture();
        initialize(&fixture);
        fixture.client.deposit(&fixture.alice, &(100 * WAD));
        fixture
            .client
            .set_exchange_rate(&fixture.admin, &1_100_000_000_000_000_000);

        let underlying_out = fixture.client.redeem(&fixture.alice, &(40 * WAD));

        assert_eq!(underlying_out, 44 * WAD);
        assert_eq!(fixture.client.share_balance(&fixture.alice), 60 * WAD);
        assert_eq!(fixture.client.total_shares(), 60 * WAD);
        assert_eq!(fixture.client.accrued_yield(&fixture.alice), 6 * WAD);
    }

    // M2: a public SY method must not mutate state or read defaults before
    // initialize. deposit before initialize fails with NotInitialized (#2).
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn deposit_before_initialize_fails() {
        let fixture = fixture();
        fixture.client.deposit(&fixture.alice, &(100 * WAD));
    }

    // M2: exchange_rate must not default to WAD before initialize.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn exchange_rate_before_initialize_fails() {
        let fixture = fixture();
        fixture.client.exchange_rate();
    }

    // M3: holder/total share accumulation must reject i128 overflow rather than
    // wrap. A second deposit that overflows the running total fails with
    // MathOverflow (#6).
    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn deposit_overflow_is_rejected() {
        let fixture = fixture();
        initialize(&fixture);
        fixture.client.deposit(&fixture.alice, &i128::MAX);
        fixture.client.deposit(&fixture.alice, &1);
    }

    // M2: redeem before initialize fails with NotInitialized (#2).
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn redeem_before_initialize_fails() {
        let fixture = fixture();
        fixture.client.redeem(&fixture.alice, &(10 * WAD));
    }

    // M2: accrued_yield before initialize fails with NotInitialized (#2).
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn accrued_yield_before_initialize_fails() {
        let fixture = fixture();
        fixture.client.accrued_yield(&fixture.alice);
    }

    // M3: redeem must reject overflow when a large exchange rate multiplied by
    // the redeemed shares exceeds i128, rather than wrapping (#6).
    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn redeem_overflow_is_rejected() {
        let fixture = fixture();
        initialize(&fixture);
        fixture.client.deposit(&fixture.alice, &(1000 * WAD));
        fixture.client.set_exchange_rate(&fixture.admin, &i128::MAX);
        fixture.client.redeem(&fixture.alice, &(1000 * WAD));
    }
}
