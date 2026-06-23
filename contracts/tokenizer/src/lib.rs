// SPDX-License-Identifier: Apache-2.0

#![cfg_attr(target_family = "wasm", no_std)]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env};

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Config {
    pub admin: Address,
    pub sy_token: Address,
    pub pt_token: Address,
    pub yt_token: Address,
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
    AmountMismatch = 5,
    Matured = 6,
}

#[contract]
pub struct Tokenizer;

#[contractimpl]
impl Tokenizer {
    pub fn initialize(
        env: Env,
        admin: Address,
        sy_token: Address,
        pt_token: Address,
        yt_token: Address,
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
            sy_token,
            pt_token,
            yt_token,
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

    pub fn preview_split(env: Env, sy_amount: i128) -> Result<(i128, i128), Error> {
        Self::require_live(&env)?;
        Self::require_positive_amount(sy_amount)?;

        Ok((sy_amount, sy_amount))
    }

    pub fn preview_recombine(env: Env, pt_amount: i128, yt_amount: i128) -> Result<i128, Error> {
        Self::require_live(&env)?;
        Self::require_positive_amount(pt_amount)?;
        Self::require_positive_amount(yt_amount)?;

        if pt_amount != yt_amount {
            return Err(Error::AmountMismatch);
        }

        Ok(pt_amount)
    }

    fn read_config(env: &Env) -> Result<Config, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }

    fn require_live(env: &Env) -> Result<(), Error> {
        let config = Self::read_config(env)?;
        if env.ledger().timestamp() >= config.maturity {
            return Err(Error::Matured);
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
        client: TokenizerClient<'static>,
        admin: Address,
        sy_token: Address,
        pt_token: Address,
        yt_token: Address,
    }

    fn fixture(now: u64) -> Fixture {
        let env = Env::default();
        env.ledger().set_timestamp(now);
        env.mock_all_auths();

        let contract_id = env.register(Tokenizer, ());
        let client = TokenizerClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let sy_token = Address::generate(&env);
        let pt_token = Address::generate(&env);
        let yt_token = Address::generate(&env);

        Fixture {
            env,
            client,
            admin,
            sy_token,
            pt_token,
            yt_token,
        }
    }

    fn initialize(fixture: &Fixture) {
        fixture.client.initialize(
            &fixture.admin,
            &fixture.sy_token,
            &fixture.pt_token,
            &fixture.yt_token,
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
                sy_token: fixture.sy_token,
                pt_token: fixture.pt_token,
                yt_token: fixture.yt_token,
                maturity: MATURITY,
            }
        );
        assert_eq!(fixture.client.maturity(), MATURITY);
        assert!(!fixture.client.is_matured());
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn initialize_rejects_past_maturity() {
        let fixture = fixture(NOW);

        fixture.client.initialize(
            &fixture.admin,
            &fixture.sy_token,
            &fixture.pt_token,
            &fixture.yt_token,
            &NOW,
        );
    }

    #[test]
    fn preview_split_returns_equal_pt_and_yt() {
        let fixture = fixture(NOW);
        initialize(&fixture);

        assert_eq!(fixture.client.preview_split(&100), (100, 100));
    }

    #[test]
    fn preview_recombine_returns_sy_for_equal_pt_and_yt() {
        let fixture = fixture(NOW);
        initialize(&fixture);

        assert_eq!(fixture.client.preview_recombine(&100, &100), 100);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn preview_recombine_rejects_mismatched_pt_and_yt() {
        let fixture = fixture(NOW);
        initialize(&fixture);

        fixture.client.preview_recombine(&100, &99);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn preview_split_rejects_matured_market() {
        let fixture = fixture(NOW);
        initialize(&fixture);

        fixture.env.ledger().set_timestamp(MATURITY);

        fixture.client.preview_split(&100);
    }
}
