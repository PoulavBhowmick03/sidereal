// SPDX-License-Identifier: Apache-2.0

#![cfg_attr(target_family = "wasm", no_std)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, String,
};

/// Display decimals for PT, matching SY and the 7-decimal underlying.
const DECIMALS: u32 = 7;

/// TTL policy, matching the AMM: bump when within 30 days of expiry, extend to
/// 120 days, so a periodically-touched 90-day market never archives.
const LEDGERS_PER_DAY: u32 = 17_280;
const TTL_THRESHOLD_LEDGERS: u32 = 30 * LEDGERS_PER_DAY;
const TTL_EXTEND_TO_LEDGERS: u32 = 120 * LEDGERS_PER_DAY;

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Config {
    pub admin: Address,
    pub tokenizer: Address,
    pub sy_token: Address,
    pub maturity: u64,
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
    TotalSupply,
    Balance(Address),
    /// (owner, spender)
    Allowance(Address, Address),
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
#[contracterror]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidMaturity = 3,
    InvalidAmount = 4,
    LiveMarket = 5,
    InsufficientBalance = 6,
    InsufficientAllowance = 7,
    MathOverflow = 8,
    InvalidExpiration = 9,
}

#[contract]
pub struct PtToken;

#[contractimpl]
impl PtToken {
    pub fn initialize(
        env: Env,
        admin: Address,
        tokenizer: Address,
        sy_token: Address,
        maturity: u64,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();

        if maturity <= env.ledger().timestamp() {
            return Err(Error::InvalidMaturity);
        }

        let config = Config {
            admin,
            tokenizer,
            sy_token,
            maturity,
        };
        env.storage().instance().set(&DataKey::Config, &config);

        Ok(())
    }

    pub fn config(env: Env) -> Result<Config, Error> {
        Self::read_config(&env)
    }

    pub fn maturity(env: Env) -> Result<u64, Error> {
        Ok(Self::read_config(&env)?.maturity)
    }

    pub fn is_matured(env: Env) -> Result<bool, Error> {
        let config = Self::read_config(&env)?;
        Ok(env.ledger().timestamp() >= config.maturity)
    }

    pub fn redeemable_sy(env: Env, pt_amount: i128) -> Result<i128, Error> {
        Self::require_matured(&env)?;
        Self::require_positive_amount(pt_amount)?;

        Ok(pt_amount)
    }

    // --- Minter-privileged supply control (only the tokenizer) -------------

    /// Mints `amount` PT to `to`. Restricted to the tokenizer recorded at
    /// initialization, which mints PT when a holder splits SY.
    pub fn mint(env: Env, to: Address, amount: i128) {
        let config = Self::read_config_or_panic(&env);
        config.tokenizer.require_auth();
        Self::require_amount_or_panic(&env, amount);
        Self::bump_instance_ttl(&env);

        let balance = Self::read_balance(&env, &to);
        Self::write_balance(&env, &to, Self::add_or_panic(&env, balance, amount));
        let supply = Self::read_total_supply(&env);
        env.storage().instance().set(
            &DataKey::TotalSupply,
            &Self::add_or_panic(&env, supply, amount),
        );
    }

    // --- SEP-41 token interface -------------------------------------------

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
        String::from_str(&env, "Sidereal Principal Token")
    }

    pub fn symbol(env: Env) -> String {
        String::from_str(&env, "sPT")
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
        Self::bump_instance_ttl(&env);
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
        Self::bump_instance_ttl(&env);
        Self::move_balance(&env, &from, &to, amount);
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        Self::require_amount_or_panic(&env, amount);
        Self::bump_instance_ttl(&env);
        Self::spend_allowance(&env, &from, &spender, amount);
        Self::move_balance(&env, &from, &to, amount);
    }

    /// Burns `amount` PT from `from`. The tokenizer burns PT on recombine and
    /// redemption; holders may also burn their own balance.
    pub fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        Self::require_amount_or_panic(&env, amount);
        Self::bump_instance_ttl(&env);
        Self::burn_balance(&env, &from, amount);
    }

    pub fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        Self::require_amount_or_panic(&env, amount);
        Self::bump_instance_ttl(&env);
        Self::spend_allowance(&env, &from, &spender, amount);
        Self::burn_balance(&env, &from, amount);
    }

    // --- internal helpers --------------------------------------------------

    fn read_config(env: &Env) -> Result<Config, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }

    fn read_config_or_panic(env: &Env) -> Config {
        match Self::read_config(env) {
            Ok(config) => config,
            Err(error) => panic_with_error!(env, error),
        }
    }

    fn require_matured(env: &Env) -> Result<(), Error> {
        let config = Self::read_config(env)?;
        if env.ledger().timestamp() < config.maturity {
            return Err(Error::LiveMarket);
        }

        Ok(())
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

    fn read_balance(env: &Env, id: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(id.clone()))
            .unwrap_or(0)
    }

    fn write_balance(env: &Env, id: &Address, amount: i128) {
        let key = DataKey::Balance(id.clone());
        env.storage().persistent().set(&key, &amount);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_EXTEND_TO_LEDGERS);
    }

    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD_LEDGERS, TTL_EXTEND_TO_LEDGERS);
    }

    fn read_total_supply(env: &Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    fn move_balance(env: &Env, from: &Address, to: &Address, amount: i128) {
        let from_balance = Self::read_balance(env, from);
        if from_balance < amount {
            panic_with_error!(env, Error::InsufficientBalance);
        }
        Self::write_balance(env, from, from_balance - amount);
        let to_balance = Self::read_balance(env, to);
        Self::write_balance(env, to, Self::add_or_panic(env, to_balance, amount));
    }

    fn burn_balance(env: &Env, from: &Address, amount: i128) {
        let from_balance = Self::read_balance(env, from);
        if from_balance < amount {
            panic_with_error!(env, Error::InsufficientBalance);
        }
        Self::write_balance(env, from, from_balance - amount);
        let supply = Self::read_total_supply(env);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(supply - amount));
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

    fn add_or_panic(env: &Env, lhs: i128, rhs: i128) -> i128 {
        match lhs.checked_add(rhs) {
            Some(value) => value,
            None => panic_with_error!(env, Error::MathOverflow),
        }
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    const NOW: u64 = 1_770_000_000;
    const MATURITY: u64 = NOW + 90 * 24 * 60 * 60;

    struct Fixture {
        env: Env,
        client: PtTokenClient<'static>,
        admin: Address,
        tokenizer: Address,
        sy_token: Address,
        alice: Address,
        bob: Address,
    }

    fn fixture(now: u64) -> Fixture {
        let env = Env::default();
        env.ledger().set_timestamp(now);
        env.mock_all_auths();

        let contract_id = env.register(PtToken, ());
        let client = PtTokenClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let tokenizer = Address::generate(&env);
        let sy_token = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        Fixture {
            env,
            client,
            admin,
            tokenizer,
            sy_token,
            alice,
            bob,
        }
    }

    fn initialize(fixture: &Fixture) {
        fixture.client.initialize(
            &fixture.admin,
            &fixture.tokenizer,
            &fixture.sy_token,
            &MATURITY,
        );
    }

    #[test]
    fn initialize_stores_config() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        assert_eq!(
            fixture.client.config(),
            Config {
                admin: fixture.admin.clone(),
                tokenizer: fixture.tokenizer.clone(),
                sy_token: fixture.sy_token.clone(),
                maturity: MATURITY,
            }
        );
        assert_eq!(fixture.client.decimals(), 7);
        assert_eq!(
            fixture.client.symbol(),
            String::from_str(&fixture.env, "sPT")
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn redeem_rejects_before_maturity() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture.client.redeemable_sy(&100);
    }

    #[test]
    fn redeem_returns_one_to_one_sy_after_maturity() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture.env.ledger().set_timestamp(MATURITY);
        assert_eq!(fixture.client.redeemable_sy(&100), 100);
    }

    #[test]
    fn mint_increases_balance_and_supply() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture.client.mint(&fixture.alice, &1_000);
        assert_eq!(fixture.client.balance(&fixture.alice), 1_000);
        assert_eq!(fixture.client.total_supply(), 1_000);
    }

    #[test]
    fn mint_requires_the_tokenizer_to_authorize() {
        use soroban_sdk::testutils::AuthorizedFunction;
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture.client.mint(&fixture.alice, &1_000);
        // The recorded authorization for mint is the tokenizer, not the admin.
        let auths = fixture.env.auths();
        let (authorizer, invocation) = &auths[0];
        assert_eq!(authorizer, &fixture.tokenizer);
        assert!(matches!(
            &invocation.function,
            AuthorizedFunction::Contract(_)
        ));
    }

    #[test]
    fn transfer_moves_balance() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture.client.mint(&fixture.alice, &1_000);
        fixture.client.transfer(&fixture.alice, &fixture.bob, &400);
        assert_eq!(fixture.client.balance(&fixture.alice), 600);
        assert_eq!(fixture.client.balance(&fixture.bob), 400);
        assert_eq!(fixture.client.total_supply(), 1_000);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn transfer_rejects_insufficient_balance() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture.client.mint(&fixture.alice, &100);
        fixture.client.transfer(&fixture.alice, &fixture.bob, &101);
    }

    #[test]
    fn approve_and_transfer_from_spend_allowance() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture.client.mint(&fixture.alice, &1_000);
        fixture
            .client
            .approve(&fixture.alice, &fixture.bob, &500, &(NOW as u32 + 1_000));
        assert_eq!(fixture.client.allowance(&fixture.alice, &fixture.bob), 500);

        fixture
            .client
            .transfer_from(&fixture.bob, &fixture.alice, &fixture.bob, &300);
        assert_eq!(fixture.client.balance(&fixture.alice), 700);
        assert_eq!(fixture.client.balance(&fixture.bob), 300);
        assert_eq!(fixture.client.allowance(&fixture.alice, &fixture.bob), 200);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #7)")]
    fn transfer_from_rejects_over_allowance() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture.client.mint(&fixture.alice, &1_000);
        fixture
            .client
            .approve(&fixture.alice, &fixture.bob, &100, &(NOW as u32 + 1_000));
        fixture
            .client
            .transfer_from(&fixture.bob, &fixture.alice, &fixture.bob, &101);
    }

    #[test]
    fn burn_reduces_balance_and_supply() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture.client.mint(&fixture.alice, &1_000);
        fixture.client.burn(&fixture.alice, &400);
        assert_eq!(fixture.client.balance(&fixture.alice), 600);
        assert_eq!(fixture.client.total_supply(), 600);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn burn_rejects_insufficient_balance() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture.client.mint(&fixture.alice, &100);
        fixture.client.burn(&fixture.alice, &101);
    }
}
