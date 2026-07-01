// SPDX-License-Identifier: Apache-2.0

#![cfg_attr(target_family = "wasm", no_std)]

use sidereal_blend_adapter::{
    assets_from_b_tokens, derived_exchange_rate, BlendPoolClient, Request, REQUEST_SUPPLY,
    REQUEST_WITHDRAW,
};
use sidereal_shared_types::StandardizedYield;
use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contracterror, contractimpl, contracttype, panic_with_error, token, vec, Address,
    Env, IntoVal, MuxedAddress, String, Symbol,
};

const WAD: i128 = 1_000_000_000_000_000_000;

/// Display decimals for SY, matching the 7-decimal underlying.
const DECIMALS: u32 = 7;

/// TTL policy, matching the AMM: bump when within 30 days of expiry, extend to
/// 120 days, so a periodically-touched vault never archives mid-term.
const LEDGERS_PER_DAY: u32 = 17_280;
const TTL_THRESHOLD_LEDGERS: u32 = 30 * LEDGERS_PER_DAY;
const TTL_EXTEND_TO_LEDGERS: u32 = 120 * LEDGERS_PER_DAY;

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Config {
    pub admin: Address,
    pub underlying: Address,
    pub pool: Option<Address>,
    pub reserve_index: u32,
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
    ReadOnlyExchangeRate = 9,
    InvalidBlendReserve = 10,
}

#[contract]
pub struct SyWrapper;

#[contractimpl]
impl SyWrapper {
    pub fn initialize(env: Env, admin: Address, underlying: Address) -> Result<(), Error> {
        Self::initialize_with_config(
            &env,
            admin,
            underlying,
            None,
            0,
        )
    }

    /// Initializes a production wrapper whose custody and exchange rate are
    /// backed by a Blend v2 plain-supply position.
    pub fn initialize_blend(
        env: Env,
        admin: Address,
        underlying: Address,
        pool: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        let pool_client = BlendPoolClient::new(&env, &pool);
        let reserves = pool_client.get_reserve_list();
        let mut reserve_index = None;
        for (index, asset) in reserves.iter().enumerate() {
            if asset == underlying {
                reserve_index = Some(index as u32);
                break;
            }
        }
        let reserve_index = reserve_index.ok_or(Error::InvalidBlendReserve)?;
        let reserve = pool_client.get_reserve(&underlying);
        if reserve.config.index != reserve_index || reserve.config.decimals != DECIMALS {
            return Err(Error::InvalidBlendReserve);
        }

        Self::write_initial_config(
            &env,
            Config {
                admin,
                underlying,
                pool: Some(pool),
                reserve_index,
            },
        );
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
        if config.pool.is_some() {
            return Err(Error::ReadOnlyExchangeRate);
        }
        Self::require_exchange_rate(exchange_rate)?;
        Self::bump_instance_ttl(&env);

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

    // --- internal helpers --------------------------------------------------

    fn read_config(env: &Env) -> Result<Config, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }

    fn initialize_with_config(
        env: &Env,
        admin: Address,
        underlying: Address,
        pool: Option<Address>,
        reserve_index: u32,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        Self::write_initial_config(
            env,
            Config {
                admin,
                underlying,
                pool,
                reserve_index,
            },
        );
        Ok(())
    }

    fn write_initial_config(env: &Env, config: Config) {
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::ExchangeRate, &WAD);
        env.storage().instance().set(&DataKey::TotalSupply, &0_i128);
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

    fn read_principal(env: &Env, id: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Principal(id.clone()))
            .unwrap_or(0)
    }

    fn write_principal(env: &Env, id: &Address, amount: i128) {
        let key = DataKey::Principal(id.clone());
        env.storage().persistent().set(&key, &amount);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_EXTEND_TO_LEDGERS);
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

        // Move principal pro-rata with the shares, so accrued_yield (shares*rate
        // - principal) stays correct for both parties. Without this, the
        // recipient reads zero principal (their whole balance shows as yield) and
        // the sender keeps too much. Round the moved principal down, which leaves
        // a stroop of principal with the sender (the conservative direction).
        let from_principal = Self::read_principal(env, from);
        let moved_principal = if from_balance == 0 {
            0
        } else {
            mul_div_or_panic(env, from_principal, amount, from_balance)
        };

        Self::write_balance(env, from, from_balance - amount);
        Self::write_principal(env, from, sub_or_panic(env, from_principal, moved_principal));
        let to_balance = Self::read_balance(env, to);
        Self::write_balance(env, to, add_or_panic(env, to_balance, amount));
        let to_principal = Self::read_principal(env, to);
        Self::write_principal(env, to, add_or_panic(env, to_principal, moved_principal));
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
        Self::bump_instance_ttl(env);

        let config = match Self::read_config(env) {
            Ok(config) => config,
            Err(error) => panic_with_error!(env, error),
        };

        // Price the deposit before its assets enter Blend. For Blend custody,
        // mint against the actual AUM increase after Blend's bToken rounding,
        // not the requested transfer amount. This prevents a new deposit from
        // lowering the rate by creating more SY than the credited position backs.
        let exchange_rate = <Self as StandardizedYield>::exchange_rate(env);
        let aum_before = config
            .pool
            .as_ref()
            .map(|_| blend_assets_under_management(env, &config));

        pull_underlying(env, &config.underlying, &from, amount);
        if config.pool.is_some() {
            blend_submit(env, &config, REQUEST_SUPPLY, amount, false);
        }
        let assets_credited = match aum_before {
            Some(before) => sub_or_panic(
                env,
                blend_assets_under_management(env, &config),
                before,
            ),
            None => amount,
        };
        let shares = mul_div_or_panic(env, assets_credited, WAD, exchange_rate);
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
        Self::bump_instance_ttl(env);

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

        let requested_underlying = mul_div_or_panic(env, sy_amount, exchange_rate, WAD);
        let (shares_to_burn, underlying_out) = if config.pool.is_some() {
            let before = underlying_balance(env, &config.underlying);
            if !blend_submit(env, &config, REQUEST_WITHDRAW, requested_underlying, true) {
                return 0;
            }
            let after = underlying_balance(env, &config.underlying);
            let received = sub_or_panic(env, after, before);
            if received <= 0 {
                return 0;
            }
            let burn = if received >= requested_underlying {
                sy_amount
            } else {
                mul_div_or_panic(env, received, WAD, exchange_rate)
            };
            (burn, received)
        } else {
            (sy_amount, requested_underlying)
        };

        let principal_out = if current_shares == 0 {
            0
        } else {
            mul_div_or_panic(env, current_principal, shares_to_burn, current_shares)
        };

        Self::write_balance(
            env,
            &from,
            sub_or_panic(env, current_shares, shares_to_burn),
        );
        Self::write_principal(
            env,
            &from,
            sub_or_panic(env, current_principal, principal_out),
        );
        Self::write_total_supply(env, sub_or_panic(env, total_shares, shares_to_burn));

        // Return the underlying from the vault to the holder.
        push_underlying(env, &config.underlying, &from, underlying_out);

        underlying_out
    }

    fn exchange_rate(env: &Env) -> i128 {
        require_init(env);
        let config = match Self::read_config(env) {
            Ok(config) => config,
            Err(error) => panic_with_error!(env, error),
        };
        if config.pool.is_some() {
            match derived_exchange_rate(
                blend_assets_under_management(env, &config),
                Self::read_total_supply(env),
            ) {
                Some(value) => value,
                None => panic_with_error!(env, Error::MathOverflow),
            }
        } else {
            env.storage()
                .instance()
                .get(&DataKey::ExchangeRate)
                .unwrap_or(WAD)
        }
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

fn underlying_balance(env: &Env, underlying: &Address) -> i128 {
    token::TokenClient::new(env, underlying).balance(&env.current_contract_address())
}

fn blend_assets_under_management(env: &Env, config: &Config) -> i128 {
    let pool = match &config.pool {
        Some(pool) => pool,
        None => return 0,
    };
    let pool_client = BlendPoolClient::new(env, pool);
    let positions = pool_client.get_positions(&env.current_contract_address());
    let b_tokens = positions.supply.get(config.reserve_index).unwrap_or(0);
    let reserve = pool_client.get_reserve(&config.underlying);
    match assets_from_b_tokens(b_tokens, reserve.data.b_rate) {
        Some(value) => value,
        None => panic_with_error!(env, Error::MathOverflow),
    }
}

/// Submits one plain-supply or withdraw request as the wrapper. The wrapper is
/// the direct invoker of `submit`, so Blend's `spender.require_auth()` is
/// satisfied by invoker auth. Supply separately authorizes the later nested
/// token transfer from the wrapper to the pool. Blend authorizes its own
/// outgoing token transfer during withdraw.
fn blend_submit(
    env: &Env,
    config: &Config,
    request_type: u32,
    amount: i128,
    tolerate_failure: bool,
) -> bool {
    let pool = match &config.pool {
        Some(pool) => pool.clone(),
        None => return true,
    };
    let me = env.current_contract_address();
    let requests = vec![
        env,
        Request {
            address: config.underlying.clone(),
            amount,
            request_type,
        },
    ];
    if request_type == REQUEST_SUPPLY {
        env.authorize_as_current_contract(vec![
            env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: config.underlying.clone(),
                    fn_name: Symbol::new(env, "transfer"),
                    args: vec![
                        env,
                        me.clone().into_val(env),
                        pool.clone().into_val(env),
                        amount.into_val(env),
                    ],
                },
                sub_invocations: vec![env],
            }),
        ]);
    }

    let client = BlendPoolClient::new(env, &pool);
    if tolerate_failure {
        matches!(
            client.try_submit(&me, &me, &me, &requests),
            Ok(Ok(_))
        )
    } else {
        client.submit(&me, &me, &me, &requests);
        true
    }
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
                pool: None,
                reserve_index: 0,
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
    fn transfer_moves_principal_pro_rata_so_yield_stays_correct() {
        let fixture = fixture();
        initialize(&fixture);
        fixture.client.deposit(&fixture.alice, &(100 * WAD));

        // Rate grows 10%, so Alice has 10 of yield on 100 shares. She sends 40
        // shares to Bob. Principal must follow pro-rata (40 of the 100), so
        // neither party's accrued_yield is corrupted by the transfer.
        fixture
            .client
            .set_exchange_rate(&fixture.admin, &1_100_000_000_000_000_000);
        fixture
            .client
            .transfer(&fixture.alice, &fixture.bob, &(40 * WAD));

        // 60 shares * 1.10 - 60 principal = 6 yield; 40 * 1.10 - 40 = 4 yield.
        assert_eq!(fixture.client.accrued_yield(&fixture.alice), 6 * WAD);
        assert_eq!(fixture.client.accrued_yield(&fixture.bob), 4 * WAD);
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
