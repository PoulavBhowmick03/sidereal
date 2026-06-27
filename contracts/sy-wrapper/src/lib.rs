// SPDX-License-Identifier: Apache-2.0

#![cfg_attr(target_family = "wasm", no_std)]

use sidereal_shared_types::StandardizedYield;
use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contracterror, contractimpl, contracttype, panic_with_error, token, vec, Address,
    Env, IntoVal, MuxedAddress, String, Symbol,
};

const WAD: i128 = 1_000_000_000_000_000_000;

/// Display decimals for SY, matching the 7-decimal underlying.
const DECIMALS: u32 = 7;

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Config {
    pub admin: Address,
    pub underlying: Address,
}

#[derive(Clone)]
#[contracttype]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Config,
    ExchangeRate,
    TotalSupply,
    Balance(Address),
    /// Underlying principal a holder deposited, used for accrued-yield display.
    Principal(Address),
    /// (owner, spender)
    Allowance(Address, Address),
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
    InsufficientAllowance = 7,
    InvalidExpiration = 8,
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
        env.storage().instance().set(&DataKey::TotalSupply, &0_i128);

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
        Ok(Self::read_balance(&env, &holder))
    }

    pub fn total_shares(env: Env) -> Result<i128, Error> {
        Self::read_config(&env)?;
        Ok(Self::read_total_supply(&env))
    }

    // --- SEP-41 token interface (SY is a transferable share) ---------------

    pub fn balance(env: Env, id: Address) -> i128 {
        Self::read_balance(&env, &id)
    }

    pub fn total_supply(env: Env) -> i128 {
        Self::read_total_supply(&env)
    }

    pub fn decimals(_env: Env) -> u32 {
        DECIMALS
    }

    pub fn name(env: Env) -> String {
        String::from_str(&env, "Sidereal Standardized Yield")
    }

    pub fn symbol(env: Env) -> String {
        String::from_str(&env, "sSY")
    }

    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        Self::read_allowance(&env, &from, &spender).amount
    }

    pub fn approve(
        env: Env,
        from: Address,
        spender: Address,
        amount: i128,
        expiration_ledger: u32,
    ) {
        from.require_auth();
        if amount < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if amount > 0 && expiration_ledger < env.ledger().sequence() {
            panic_with_error!(&env, Error::InvalidExpiration);
        }
        env.storage().temporary().set(
            &DataKey::Allowance(from, spender),
            &AllowanceValue {
                amount,
                expiration_ledger,
            },
        );
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        Self::require_amount_or_panic(&env, amount);
        Self::move_balance(&env, &from, &to, amount);
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        Self::require_amount_or_panic(&env, amount);
        Self::spend_allowance(&env, &from, &spender, amount);
        Self::move_balance(&env, &from, &to, amount);
    }

    // --- internal helpers --------------------------------------------------

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

    fn require_amount_or_panic(env: &Env, amount: i128) {
        if amount <= 0 {
            panic_with_error!(env, Error::InvalidAmount);
        }
    }

    fn require_exchange_rate(exchange_rate: i128) -> Result<(), Error> {
        if exchange_rate <= 0 {
            return Err(Error::InvalidExchangeRate);
        }

        Ok(())
    }

    fn read_balance(env: &Env, id: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(id.clone()))
            .unwrap_or(0)
    }

    fn write_balance(env: &Env, id: &Address, amount: i128) {
        env.storage()
            .persistent()
            .set(&DataKey::Balance(id.clone()), &amount);
    }

    fn read_principal(env: &Env, id: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Principal(id.clone()))
            .unwrap_or(0)
    }

    fn write_principal(env: &Env, id: &Address, amount: i128) {
        env.storage()
            .persistent()
            .set(&DataKey::Principal(id.clone()), &amount);
    }

    fn read_total_supply(env: &Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    fn write_total_supply(env: &Env, amount: i128) {
        env.storage().instance().set(&DataKey::TotalSupply, &amount);
    }

    fn move_balance(env: &Env, from: &Address, to: &Address, amount: i128) {
        let from_balance = Self::read_balance(env, from);
        if from_balance < amount {
            panic_with_error!(env, Error::InsufficientBalance);
        }
        Self::write_balance(env, from, from_balance - amount);
        let to_balance = Self::read_balance(env, to);
        Self::write_balance(env, to, add_or_panic(env, to_balance, amount));
    }

    fn read_allowance(env: &Env, from: &Address, spender: &Address) -> AllowanceValue {
        let key = DataKey::Allowance(from.clone(), spender.clone());
        match env.storage().temporary().get::<_, AllowanceValue>(&key) {
            Some(allowance) if allowance.expiration_ledger >= env.ledger().sequence() => allowance,
            _ => AllowanceValue {
                amount: 0,
                expiration_ledger: 0,
            },
        }
    }

    fn spend_allowance(env: &Env, from: &Address, spender: &Address, amount: i128) {
        let allowance = Self::read_allowance(env, from, spender);
        if allowance.amount < amount {
            panic_with_error!(env, Error::InsufficientAllowance);
        }
        env.storage().temporary().set(
            &DataKey::Allowance(from.clone(), spender.clone()),
            &AllowanceValue {
                amount: allowance.amount - amount,
                expiration_ledger: allowance.expiration_ledger,
            },
        );
    }
}

impl StandardizedYield for SyWrapper {
    fn deposit(env: &Env, from: Address, amount: i128) -> i128 {
        require_init(env);
        from.require_auth();
        if let Err(error) = Self::require_positive_amount(amount) {
            panic_with_error!(env, error);
        }

        let config = match Self::read_config(env) {
            Ok(config) => config,
            Err(error) => panic_with_error!(env, error),
        };

        // Pull the underlying into the vault before minting shares.
        pull_underlying(env, &config.underlying, &from, amount);

        let exchange_rate = <Self as StandardizedYield>::exchange_rate(env);
        let shares = mul_div_or_panic(env, amount, WAD, exchange_rate);
        if shares <= 0 {
            panic_with_error!(env, Error::InvalidAmount);
        }

        let current_shares = Self::read_balance(env, &from);
        let current_principal = Self::read_principal(env, &from);
        let total_shares = Self::read_total_supply(env);

        Self::write_balance(env, &from, add_or_panic(env, current_shares, shares));
        Self::write_principal(env, &from, add_or_panic(env, current_principal, amount));
        Self::write_total_supply(env, add_or_panic(env, total_shares, shares));

        shares
    }

    fn redeem(env: &Env, from: Address, sy_amount: i128) -> i128 {
        require_init(env);
        from.require_auth();
        if let Err(error) = Self::require_positive_amount(sy_amount) {
            panic_with_error!(env, error);
        }

        let config = match Self::read_config(env) {
            Ok(config) => config,
            Err(error) => panic_with_error!(env, error),
        };

        let exchange_rate = <Self as StandardizedYield>::exchange_rate(env);
        let current_shares = Self::read_balance(env, &from);
        let current_principal = Self::read_principal(env, &from);
        let total_shares = Self::read_total_supply(env);

        if sy_amount > current_shares {
            panic_with_error!(env, Error::InsufficientBalance);
        }

        let underlying_out = mul_div_or_panic(env, sy_amount, exchange_rate, WAD);
        let principal_out = if current_shares == 0 {
            0
        } else {
            mul_div_or_panic(env, current_principal, sy_amount, current_shares)
        };

        Self::write_balance(env, &from, sub_or_panic(env, current_shares, sy_amount));
        Self::write_principal(
            env,
            &from,
            sub_or_panic(env, current_principal, principal_out),
        );
        Self::write_total_supply(env, sub_or_panic(env, total_shares, sy_amount));

        // Return the underlying from the vault to the holder.
        push_underlying(env, &config.underlying, &from, underlying_out);

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
        let shares = Self::read_balance(env, &holder);
        let principal = Self::read_principal(env, &holder);
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

/// Pulls `amount` of the underlying from `from` into this vault.
fn pull_underlying(env: &Env, underlying: &Address, from: &Address, amount: i128) {
    let vault = MuxedAddress::from(&env.current_contract_address());
    token::TokenClient::new(env, underlying).transfer(from, &vault, &amount);
}

/// Sends `amount` of the underlying from this vault back to `to`.
fn push_underlying(env: &Env, underlying: &Address, to: &Address, amount: i128) {
    if amount <= 0 {
        return;
    }
    let vault = env.current_contract_address();
    let to_muxed = MuxedAddress::from(to);
    env.authorize_as_current_contract(vec![
        env,
        InvokerContractAuthEntry::Contract(SubContractInvocation {
            context: ContractContext {
                contract: underlying.clone(),
                fn_name: Symbol::new(env, "transfer"),
                args: vec![
                    env,
                    vault.clone().into_val(env),
                    to_muxed.clone().into_val(env),
                    amount.into_val(env),
                ],
            },
            sub_invocations: vec![env],
        }),
    ]);
    token::TokenClient::new(env, underlying).transfer(&vault, &to_muxed, &amount);
}

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
        env: Env,
        client: SyWrapperClient<'static>,
        admin: Address,
        underlying: Address,
        alice: Address,
        bob: Address,
    }

    const MINT: i128 = 1_000 * WAD;

    fn fixture() -> Fixture {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let underlying = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let contract_id = env.register(SyWrapper, ());
        let client = SyWrapperClient::new(&env, &contract_id);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        token::StellarAssetClient::new(&env, &underlying).mint(&alice, &MINT);

        Fixture {
            env,
            client,
            admin,
            underlying,
            alice,
            bob,
        }
    }

    fn initialize(fixture: &Fixture) {
        fixture
            .client
            .initialize(&fixture.admin, &fixture.underlying);
    }

    fn underlying_balance(fixture: &Fixture, holder: &Address) -> i128 {
        token::TokenClient::new(&fixture.env, &fixture.underlying).balance(holder)
    }

    #[test]
    fn initialize_sets_initial_exchange_rate() {
        let fixture = fixture();
        initialize(&fixture);
        assert_eq!(
            fixture.client.config(),
            Config {
                admin: fixture.admin.clone(),
                underlying: fixture.underlying.clone(),
            }
        );
        assert_eq!(fixture.client.exchange_rate(), WAD);
        assert_eq!(fixture.client.total_supply(), 0);
        assert_eq!(fixture.client.decimals(), 7);
    }

    #[test]
    fn deposit_pulls_underlying_and_mints_shares() {
        let fixture = fixture();
        initialize(&fixture);

        let minted = fixture.client.deposit(&fixture.alice, &(100 * WAD));

        assert_eq!(minted, 100 * WAD);
        assert_eq!(fixture.client.balance(&fixture.alice), 100 * WAD);
        assert_eq!(fixture.client.total_supply(), 100 * WAD);
        // The vault now custodies the underlying; alice paid it in.
        assert_eq!(
            underlying_balance(&fixture, &fixture.client.address),
            100 * WAD
        );
        assert_eq!(
            underlying_balance(&fixture, &fixture.alice),
            MINT - 100 * WAD
        );
    }

    #[test]
    fn sy_transfers_move_shares() {
        let fixture = fixture();
        initialize(&fixture);
        fixture.client.deposit(&fixture.alice, &(100 * WAD));

        fixture
            .client
            .transfer(&fixture.alice, &fixture.bob, &(40 * WAD));
        assert_eq!(fixture.client.balance(&fixture.alice), 60 * WAD);
        assert_eq!(fixture.client.balance(&fixture.bob), 40 * WAD);
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
        assert_eq!(fixture.client.balance(&fixture.alice), 60 * WAD);
        assert_eq!(fixture.client.total_supply(), 60 * WAD);
        assert_eq!(fixture.client.accrued_yield(&fixture.alice), 6 * WAD);
        // Alice received the underlying; the vault paid it out.
        assert_eq!(
            underlying_balance(&fixture, &fixture.alice),
            MINT - 100 * WAD + 44 * WAD
        );
        assert_eq!(
            underlying_balance(&fixture, &fixture.client.address),
            56 * WAD
        );
    }

    // M2: public SY methods must reject calls before initialize.
    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn deposit_before_initialize_fails() {
        let fixture = fixture();
        fixture.client.deposit(&fixture.alice, &(100 * WAD));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn redeem_before_initialize_fails() {
        let fixture = fixture();
        fixture.client.redeem(&fixture.alice, &(10 * WAD));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn exchange_rate_before_initialize_fails() {
        let fixture = fixture();
        fixture.client.exchange_rate();
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn accrued_yield_before_initialize_fails() {
        let fixture = fixture();
        fixture.client.accrued_yield(&fixture.alice);
    }

    // M3: share math must reject i128 overflow. A tiny exchange rate inflates
    // shares past i128 on deposit; a huge rate overflows the underlying-out
    // product on redeem.
    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn deposit_share_math_overflow_is_rejected() {
        let fixture = fixture();
        initialize(&fixture);
        fixture.client.set_exchange_rate(&fixture.admin, &1);
        fixture.client.deposit(&fixture.alice, &(1_000 * WAD));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn redeem_underlying_math_overflow_is_rejected() {
        let fixture = fixture();
        initialize(&fixture);
        fixture.client.deposit(&fixture.alice, &(1_000 * WAD));
        fixture.client.set_exchange_rate(&fixture.admin, &i128::MAX);
        fixture.client.redeem(&fixture.alice, &(1_000 * WAD));
    }
}
