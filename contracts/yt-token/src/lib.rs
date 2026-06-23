// SPDX-License-Identifier: Apache-2.0

#![cfg_attr(target_family = "wasm", no_std)]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env};

const WAD: i128 = 1_000_000_000_000_000_000;

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
enum DataKey {
    Config,
    Holder(Address, u64),
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

    pub fn checkpoint(env: Env, holder: Address) -> Result<i128, Error> {
        let config = Self::read_config(&env)?;
        Ok(env
            .storage()
            .instance()
            .get(&DataKey::Holder(holder, config.maturity))
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
        env.storage()
            .instance()
            .set(&DataKey::Holder(holder, config.maturity), &exchange_rate);

        Ok(())
    }

    pub fn preview_claim_yield(
        env: Env,
        holder: Address,
        yt_balance: i128,
        current_exchange_rate: i128,
    ) -> Result<i128, Error> {
        let config = Self::read_config(&env)?;
        Self::require_positive_amount(yt_balance)?;
        Self::require_exchange_rate(current_exchange_rate)?;

        let last_rate = env
            .storage()
            .instance()
            .get(&DataKey::Holder(holder, config.maturity))
            .unwrap_or(current_exchange_rate);
        if current_exchange_rate < last_rate {
            return Err(Error::ExchangeRateRegression);
        }

        let rate_delta = current_exchange_rate - last_rate;
        Ok((rate_delta * yt_balance) / WAD)
    }

    pub fn claim_yield(
        env: Env,
        holder: Address,
        yt_balance: i128,
        current_exchange_rate: i128,
    ) -> Result<i128, Error> {
        holder.require_auth();

        let config = Self::read_config(&env)?;
        let accrued = Self::preview_claim_yield(
            env.clone(),
            holder.clone(),
            yt_balance,
            current_exchange_rate,
        )?;

        env.storage().instance().set(
            &DataKey::Holder(holder, config.maturity),
            &current_exchange_rate,
        );

        Ok(accrued)
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
        if exchange_rate < WAD {
            return Err(Error::InvalidExchangeRate);
        }

        Ok(())
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

        let accrued =
            fixture
                .client
                .claim_yield(&fixture.alice, &(100 * WAD), &1_020_000_000_000_000_000);

        assert_eq!(accrued, 0);
        assert_eq!(
            fixture.client.checkpoint(&fixture.alice),
            1_020_000_000_000_000_000
        );
    }

    #[test]
    fn claim_uses_exchange_rate_delta_times_balance() {
        let fixture = fixture(NOW);
        initialize(&fixture);
        fixture
            .client
            .seed_checkpoint(&fixture.admin, &fixture.alice, &1_010_000_000_000_000_000);

        let accrued =
            fixture
                .client
                .claim_yield(&fixture.alice, &(200 * WAD), &1_030_000_000_000_000_000);

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
        fixture
            .client
            .seed_checkpoint(&fixture.admin, &fixture.alice, &1_020_000_000_000_000_000);

        assert_eq!(
            fixture.client.preview_claim_yield(
                &fixture.alice,
                &(100 * WAD),
                &1_030_000_000_000_000_000,
            ),
            WAD
        );
        assert_eq!(
            fixture.client.preview_claim_yield(
                &fixture.bob,
                &(100 * WAD),
                &1_030_000_000_000_000_000,
            ),
            0
        );
    }
}
