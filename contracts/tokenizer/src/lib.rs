// SPDX-License-Identifier: Apache-2.0

#![cfg_attr(target_family = "wasm", no_std)]

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contracterror, contractimpl, contracttype, token, vec, Address, Env, IntoVal,
    MuxedAddress, Symbol, Val, Vec,
};

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Config {
    pub admin: Address,
    pub sy_token: Address,
    pub pt_token: Address,
    pub yt_token: Address,
    pub maturity: u64,
}

/// A holder's PT and YT balances, read from the real token contracts.
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Position {
    pub pt_balance: i128,
    pub yt_balance: i128,
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
    LiveMarket = 8,
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

    /// PT and YT balances the holder currently owns, read from the token
    /// contracts.
    pub fn position(env: Env, holder: Address) -> Result<Position, Error> {
        let config = Self::read_config(&env)?;
        Ok(Position {
            pt_balance: token_balance(&env, &config.pt_token, &holder),
            yt_balance: token_balance(&env, &config.yt_token, &holder),
        })
    }

    /// SY the tokenizer custodies, equal to the outstanding PT (and YT) supply.
    pub fn escrowed_sy(env: Env) -> Result<i128, Error> {
        let config = Self::read_config(&env)?;
        Ok(token_balance(
            &env,
            &config.sy_token,
            &env.current_contract_address(),
        ))
    }

    /// Pulls `sy_amount` SY from `from` into the tokenizer and mints equal PT
    /// and YT to `from`.
    pub fn split(env: Env, from: Address, sy_amount: i128) -> Result<(i128, i128), Error> {
        from.require_auth();
        Self::require_live(&env)?;
        Self::require_positive_amount(sy_amount)?;
        let config = Self::read_config(&env)?;

        pull_token(&env, &config.sy_token, &from, sy_amount);
        mint_token(&env, &config.pt_token, &from, sy_amount);
        mint_token(&env, &config.yt_token, &from, sy_amount);

        Ok((sy_amount, sy_amount))
    }

    /// Burns equal PT and YT from `from` and returns the SY one-to-one.
    pub fn recombine(
        env: Env,
        from: Address,
        pt_amount: i128,
        yt_amount: i128,
    ) -> Result<i128, Error> {
        from.require_auth();
        Self::require_live(&env)?;
        Self::require_positive_amount(pt_amount)?;
        Self::require_positive_amount(yt_amount)?;

        if pt_amount != yt_amount {
            return Err(Error::AmountMismatch);
        }

        let config = Self::read_config(&env)?;

        burn_token(&env, &config.pt_token, &from, pt_amount);
        burn_token(&env, &config.yt_token, &from, yt_amount);
        push_token(&env, &config.sy_token, &from, pt_amount);

        Ok(pt_amount)
    }

    /// After maturity, burns `pt_amount` PT from `from` and returns SY 1:1. YT
    /// is worthless past maturity.
    pub fn redeem_at_maturity(env: Env, from: Address, pt_amount: i128) -> Result<i128, Error> {
        from.require_auth();
        Self::require_matured(&env)?;
        Self::require_positive_amount(pt_amount)?;
        let config = Self::read_config(&env)?;

        burn_token(&env, &config.pt_token, &from, pt_amount);
        push_token(&env, &config.sy_token, &from, pt_amount);

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

fn token_balance(env: &Env, token_id: &Address, who: &Address) -> i128 {
    token::TokenClient::new(env, token_id).balance(who)
}

/// Pulls `amount` of `token_id` from `from` into the tokenizer (holder-authorized).
fn pull_token(env: &Env, token_id: &Address, from: &Address, amount: i128) {
    let to = MuxedAddress::from(&env.current_contract_address());
    token::TokenClient::new(env, token_id).transfer(from, &to, &amount);
}

/// Burns `amount` of `token_id` from `from` (holder-authorized).
fn burn_token(env: &Env, token_id: &Address, from: &Address, amount: i128) {
    token::TokenClient::new(env, token_id).burn(from, &amount);
}

/// Mints `amount` of `token_id` to `to`, authorizing the call as the tokenizer
/// since the token gates mint on the tokenizer's address.
fn mint_token(env: &Env, token_id: &Address, to: &Address, amount: i128) {
    let args: Vec<Val> = vec![env, to.into_val(env), amount.into_val(env)];
    authorize_self_call(env, token_id, "mint", args.clone());
    env.invoke_contract::<()>(token_id, &Symbol::new(env, "mint"), args);
}

/// Sends `amount` of `token_id` from the tokenizer to `to`, authorizing the
/// transfer as the tokenizer (it is moving its own custodied balance).
fn push_token(env: &Env, token_id: &Address, to: &Address, amount: i128) {
    let me = env.current_contract_address();
    let to_muxed = MuxedAddress::from(to);
    let args: Vec<Val> = vec![
        env,
        me.clone().into_val(env),
        to_muxed.clone().into_val(env),
        amount.into_val(env),
    ];
    authorize_self_call(env, token_id, "transfer", args);
    token::TokenClient::new(env, token_id).transfer(&me, &to_muxed, &amount);
}

/// Authorizes a sub-invocation of `token_id` as the current contract, so a
/// callee's `require_auth` on the tokenizer's address succeeds.
fn authorize_self_call(env: &Env, token_id: &Address, fn_name: &str, args: Vec<Val>) {
    env.authorize_as_current_contract(vec![
        env,
        InvokerContractAuthEntry::Contract(SubContractInvocation {
            context: ContractContext {
                contract: token_id.clone(),
                fn_name: Symbol::new(env, fn_name),
                args,
            },
            sub_invocations: vec![env],
        }),
    ]);
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
                admin: fixture.admin.clone(),
                sy_token: fixture.sy_token.clone(),
                pt_token: fixture.pt_token.clone(),
                yt_token: fixture.yt_token.clone(),
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

    // The split/recombine/redeem flows move real tokens and are covered
    // end to end in tests/integration. Here we only assert the init gating.

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn split_before_initialize_fails() {
        let fixture = fixture(NOW);
        fixture.client.split(&fixture.admin, &100);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn recombine_before_initialize_fails() {
        let fixture = fixture(NOW);
        fixture.client.recombine(&fixture.admin, &10, &10);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn redeem_at_maturity_before_initialize_fails() {
        let fixture = fixture(NOW);
        fixture.client.redeem_at_maturity(&fixture.admin, &10);
    }
}
