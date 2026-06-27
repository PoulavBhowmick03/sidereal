// SPDX-License-Identifier: Apache-2.0

#![cfg_attr(target_family = "wasm", no_std)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, String,
};

const WAD: i128 = 1_000_000_000_000_000_000;

/// Display decimals for YT, matching SY and the 7-decimal underlying.
const DECIMALS: u32 = 7;

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
    /// Last exchange rate a holder has claimed yield against, per (holder, maturity).
    Checkpoint(Address, u64),
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
#[contracterror]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidMaturity = 3,
    InvalidAmount = 4,
    InvalidExchangeRate = 5,
    ExchangeRateRegression = 6,
    InsufficientBalance = 7,
    InsufficientAllowance = 8,
    MathOverflow = 9,
    InvalidExpiration = 10,
}

#[contract]
pub struct YtToken;

#[contractimpl]
impl YtToken {
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

    // --- Yield accounting --------------------------------------------------

    pub fn checkpoint(env: Env, holder: Address) -> Result<i128, Error> {
        let config = Self::read_config(&env)?;
        Ok(env
            .storage()
            .instance()
            .get(&DataKey::Checkpoint(holder, config.maturity))
            .unwrap_or(0))
    }

    pub fn seed_checkpoint(
        env: Env,
        admin: Address,
        holder: Address,
        exchange_rate: i128,
    ) -> Result<(), Error> {
        let config = Self::read_config(&env)?;
        admin.require_auth();
        if admin != config.admin {
            return Err(Error::NotInitialized);
        }

        Self::require_exchange_rate(exchange_rate)?;
        env.storage().instance().set(
            &DataKey::Checkpoint(holder, config.maturity),
            &exchange_rate,
        );

        Ok(())
    }

    /// Yield accrued to `holder` since their last checkpoint, computed against
    /// the holder's real YT balance.
    pub fn preview_claim_yield(
        env: Env,
        holder: Address,
        current_exchange_rate: i128,
    ) -> Result<i128, Error> {
        let config = Self::read_config(&env)?;
        Self::require_exchange_rate(current_exchange_rate)?;

        let yt_balance = Self::read_balance(&env, &holder);
        let last_rate = env
            .storage()
            .instance()
            .get(&DataKey::Checkpoint(holder, config.maturity))
            .unwrap_or(current_exchange_rate);
        if current_exchange_rate < last_rate {
            return Err(Error::ExchangeRateRegression);
        }

        let rate_delta = current_exchange_rate - last_rate;
        let scaled = rate_delta
            .checked_mul(yt_balance)
            .ok_or(Error::MathOverflow)?;
        Ok(scaled / WAD)
    }

    pub fn claim_yield(
        env: Env,
        holder: Address,
        current_exchange_rate: i128,
    ) -> Result<i128, Error> {
        holder.require_auth();

        let config = Self::read_config(&env)?;
        let accrued =
            Self::preview_claim_yield(env.clone(), holder.clone(), current_exchange_rate)?;

        env.storage().instance().set(
            &DataKey::Checkpoint(holder, config.maturity),
            &current_exchange_rate,
        );

        Ok(accrued)
    }

    // --- Minter-privileged supply control (only the tokenizer) -------------

    /// Mints `amount` YT to `to`. Restricted to the tokenizer recorded at
    /// initialization, which mints YT when a holder splits SY.
    pub fn mint(env: Env, to: Address, amount: i128) {
        let config = Self::read_config_or_panic(&env);
        config.tokenizer.require_auth();
        Self::require_amount_or_panic(&env, amount);

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
        String::from_str(&env, "Sidereal Yield Token")
    }

    pub fn symbol(env: Env) -> String {
        String::from_str(&env, "sYT")
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

    /// Burns `amount` YT from `from`. The tokenizer burns YT on recombine;
    /// holders may also burn their own balance.
    pub fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        Self::require_amount_or_panic(&env, amount);
        Self::burn_balance(&env, &from, amount);
    }

    pub fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        Self::require_amount_or_panic(&env, amount);
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

    fn require_exchange_rate(exchange_rate: i128) -> Result<(), Error> {
        if exchange_rate < WAD {
            return Err(Error::InvalidExchangeRate);
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
        env.storage()
            .persistent()
            .set(&DataKey::Balance(id.clone()), &amount);
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
        client: YtTokenClient<'static>,
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

        let contract_id = env.register(YtToken, ());
        let client = YtTokenClient::new(&env, &contract_id);
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
    fn first_claim_seeds_checkpoint_without_accruing_prior_yield() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture.client.mint(&fixture.alice, &(100 * WAD));

        let accrued = fixture
            .client
            .claim_yield(&fixture.alice, &1_020_000_000_000_000_000);

        assert_eq!(accrued, 0);
        assert_eq!(
            fixture.client.checkpoint(&fixture.alice),
            1_020_000_000_000_000_000
        );
    }

    #[test]
    fn claim_uses_exchange_rate_delta_times_real_balance() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture.client.mint(&fixture.alice, &(200 * WAD));
        fixture
            .client
            .seed_checkpoint(&fixture.admin, &fixture.alice, &1_010_000_000_000_000_000);

        let accrued = fixture
            .client
            .claim_yield(&fixture.alice, &1_030_000_000_000_000_000);

        assert_eq!(accrued, 4 * WAD);
        assert_eq!(
            fixture.client.checkpoint(&fixture.alice),
            1_030_000_000_000_000_000
        );
    }

    #[test]
    fn checkpoints_are_isolated_per_holder() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture.client.mint(&fixture.alice, &(100 * WAD));
        fixture.client.mint(&fixture.bob, &(100 * WAD));
        fixture
            .client
            .seed_checkpoint(&fixture.admin, &fixture.alice, &1_020_000_000_000_000_000);

        assert_eq!(
            fixture
                .client
                .preview_claim_yield(&fixture.alice, &1_030_000_000_000_000_000),
            WAD
        );
        assert_eq!(
            fixture
                .client
                .preview_claim_yield(&fixture.bob, &1_030_000_000_000_000_000),
            0
        );
    }

    #[test]
    fn mint_increases_balance_and_supply() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture.client.mint(&fixture.alice, &1_000);
        assert_eq!(fixture.client.balance(&fixture.alice), 1_000);
        assert_eq!(fixture.client.total_supply(), 1_000);
        assert_eq!(
            fixture.client.symbol(),
            String::from_str(&fixture.env, "sYT")
        );
    }

    #[test]
    fn transfer_moves_balance() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture.client.mint(&fixture.alice, &1_000);
        fixture.client.transfer(&fixture.alice, &fixture.bob, &400);
        assert_eq!(fixture.client.balance(&fixture.alice), 600);
        assert_eq!(fixture.client.balance(&fixture.bob), 400);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #7)")]
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
        fixture
            .client
            .transfer_from(&fixture.bob, &fixture.alice, &fixture.bob, &300);
        assert_eq!(fixture.client.balance(&fixture.alice), 700);
        assert_eq!(fixture.client.balance(&fixture.bob), 300);
        assert_eq!(fixture.client.allowance(&fixture.alice, &fixture.bob), 200);
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
}
