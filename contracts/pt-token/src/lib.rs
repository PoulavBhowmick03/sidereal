// SPDX-License-Identifier: Apache-2.0

#![cfg_attr(target_family = "wasm", no_std)]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env};

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

    pub fn redeem_at_maturity(env: Env, from: Address, pt_amount: i128) -> Result<i128, Error> {
        from.require_auth();
        Self::redeemable_sy(env, pt_amount)
    }

    fn read_config(env: &Env) -> Result<Config, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
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

        Fixture {
            env,
            client,
            admin,
            tokenizer,
            sy_token,
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
                admin: fixture.admin,
                tokenizer: fixture.tokenizer,
                sy_token: fixture.sy_token,
                maturity: MATURITY,
            }
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
        assert_eq!(fixture.client.redeem_at_maturity(&fixture.admin, &250), 250);
    }
}
