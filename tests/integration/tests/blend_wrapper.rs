// SPDX-License-Identifier: Apache-2.0

//! Blend-backed SY integration coverage using a Soroban pool test double.

use sidereal_blend_adapter::{
    assets_from_b_tokens, b_tokens_from_assets, derived_exchange_rate, Positions, Request, Reserve,
    ReserveConfig, ReserveData, BLEND_SCALAR_12, REQUEST_SUPPLY, REQUEST_WITHDRAW,
};
use sidereal_pt_token::{PtToken, PtTokenClient};
use sidereal_sy_wrapper::{Error as SyError, SyWrapper, SyWrapperClient};
use sidereal_tokenizer::{Tokenizer, TokenizerClient};
use sidereal_yt_token::{YtToken, YtTokenClient};
use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger as _},
    token, vec, Address, Env, IntoVal, Map, Symbol, Vec,
};

const WAD: i128 = 1_000_000_000_000_000_000;
const UNIT: i128 = 10_000_000;
const MATURITY: u64 = 1_000_000;

#[derive(Clone)]
#[contracttype]
struct MockConfig {
    underlying: Address,
    b_rate: i128,
}

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Config,
    Supply(Address),
}

#[contract]
struct MockBlendPool;

#[contractimpl]
impl MockBlendPool {
    pub fn initialize(env: Env, underlying: Address) {
        env.storage().instance().set(
            &DataKey::Config,
            &MockConfig {
                underlying,
                b_rate: BLEND_SCALAR_12,
            },
        );
    }

    pub fn set_b_rate(env: Env, b_rate: i128) {
        let mut config: MockConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        config.b_rate = b_rate;
        env.storage().instance().set(&DataKey::Config, &config);
    }

    pub fn get_reserve_list(env: Env) -> Vec<Address> {
        let config: MockConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        vec![&env, config.underlying]
    }

    pub fn get_reserve(env: Env, asset: Address) -> Reserve {
        let config: MockConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        assert_eq!(asset, config.underlying);
        reserve(&env, config)
    }

    pub fn get_positions(env: Env, address: Address) -> Positions {
        positions(&env, supply_balance(&env, &address))
    }

    pub fn submit(
        env: Env,
        from: Address,
        spender: Address,
        to: Address,
        requests: Vec<Request>,
    ) -> Positions {
        spender.require_auth();
        if from != spender {
            from.require_auth();
        }

        let config: MockConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        let mut supply = supply_balance(&env, &from);
        for request in requests {
            assert_eq!(request.address, config.underlying);
            if request.request_type == REQUEST_SUPPLY {
                env.invoke_contract::<()>(
                    &config.underlying,
                    &Symbol::new(&env, "transfer"),
                    vec![
                        &env,
                        spender.clone().into_val(&env),
                        env.current_contract_address().into_val(&env),
                        request.amount.into_val(&env),
                    ],
                );
                supply += b_tokens_from_assets(request.amount, config.b_rate).unwrap();
            } else if request.request_type == REQUEST_WITHDRAW {
                let requested_b = request
                    .amount
                    .checked_mul(BLEND_SCALAR_12)
                    .and_then(|value| value.checked_add(config.b_rate - 1))
                    .unwrap()
                    / config.b_rate;
                let burned_b = requested_b.min(supply);
                let assets_out = if burned_b == requested_b {
                    request.amount
                } else {
                    assets_from_b_tokens(burned_b, config.b_rate).unwrap()
                };
                supply -= burned_b;
                authorize_pool_transfer(&env, &config.underlying, &to, assets_out);
                env.invoke_contract::<()>(
                    &config.underlying,
                    &Symbol::new(&env, "transfer"),
                    vec![
                        &env,
                        env.current_contract_address().into_val(&env),
                        to.clone().into_val(&env),
                        assets_out.into_val(&env),
                    ],
                );
            } else {
                panic!("unsupported request type");
            }
        }
        env.storage()
            .persistent()
            .set(&DataKey::Supply(from), &supply);
        positions(&env, supply)
    }
}

fn reserve(env: &Env, config: MockConfig) -> Reserve {
    Reserve {
        asset: config.underlying,
        config: ReserveConfig {
            c_factor: 0,
            decimals: 7,
            enabled: true,
            index: 0,
            l_factor: 0,
            max_util: 0,
            r_base: 0,
            r_one: 0,
            r_three: 0,
            r_two: 0,
            reactivity: 0,
            supply_cap: i128::MAX,
            util: 0,
        },
        data: ReserveData {
            b_rate: config.b_rate,
            b_supply: 0,
            backstop_credit: 0,
            d_rate: BLEND_SCALAR_12,
            d_supply: 0,
            ir_mod: 0,
            last_time: env.ledger().timestamp(),
        },
        scalar: UNIT,
    }
}

fn positions(env: &Env, supply: i128) -> Positions {
    let mut supplies = Map::new(env);
    if supply > 0 {
        supplies.set(0, supply);
    }
    Positions {
        collateral: Map::new(env),
        liabilities: Map::new(env),
        supply: supplies,
    }
}

fn supply_balance(env: &Env, address: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Supply(address.clone()))
        .unwrap_or(0)
}

fn authorize_pool_transfer(env: &Env, underlying: &Address, to: &Address, amount: i128) {
    let pool = env.current_contract_address();
    env.authorize_as_current_contract(vec![
        env,
        InvokerContractAuthEntry::Contract(SubContractInvocation {
            context: ContractContext {
                contract: underlying.clone(),
                fn_name: Symbol::new(env, "transfer"),
                args: vec![
                    env,
                    pool.into_val(env),
                    to.clone().into_val(env),
                    amount.into_val(env),
                ],
            },
            sub_invocations: vec![env],
        }),
    ]);
}

#[test]
fn blend_supply_rate_growth_yield_claim_and_withdraw_round_trip() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1);

    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let underlying = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let pool = env.register(MockBlendPool, ());
    let sy = env.register(SyWrapper, ());
    let pt = env.register(PtToken, ());
    let yt = env.register(YtToken, ());
    let tokenizer = env.register(Tokenizer, ());

    let pool_client = MockBlendPoolClient::new(&env, &pool);
    pool_client.initialize(&underlying);
    let sy_client = SyWrapperClient::new(&env, &sy);
    sy_client.initialize_blend(&admin, &underlying, &pool);
    PtTokenClient::new(&env, &pt).initialize(&admin, &tokenizer, &sy, &MATURITY);
    YtTokenClient::new(&env, &yt).initialize(&admin, &tokenizer, &sy, &MATURITY);
    let tokenizer_client = TokenizerClient::new(&env, &tokenizer);
    tokenizer_client.initialize(&admin, &sy, &pt, &yt, &MATURITY);

    token::StellarAssetClient::new(&env, &underlying).mint(&alice, &(100 * UNIT));
    let initial_b_rate = 1_055_791_870_000;
    pool_client.set_b_rate(&initial_b_rate);
    let expected_b_tokens = b_tokens_from_assets(100 * UNIT, initial_b_rate).unwrap();
    let expected_shares = assets_from_b_tokens(expected_b_tokens, initial_b_rate).unwrap();
    assert!(
        expected_shares < 100 * UNIT,
        "Blend rounding must be exercised"
    );
    assert_eq!(sy_client.deposit(&alice, &(100 * UNIT)), expected_shares);
    assert_eq!(sy_client.exchange_rate(), WAD);
    assert_eq!(
        token::TokenClient::new(&env, &underlying).balance(&pool),
        100 * UNIT
    );
    assert_eq!(
        pool_client.get_positions(&sy).supply.get(0),
        Some(expected_b_tokens)
    );

    tokenizer_client.split(&alice, &expected_shares);
    pool_client.set_b_rate(&1_100_000_000_000);
    token::StellarAssetClient::new(&env, &underlying).mint(&pool, &(10 * UNIT));
    let expected_rate = derived_exchange_rate(
        assets_from_b_tokens(expected_b_tokens, 1_100_000_000_000).unwrap(),
        expected_shares,
    )
    .unwrap();
    assert!(expected_rate > WAD);
    assert_eq!(sy_client.exchange_rate(), expected_rate);
    assert!(matches!(
        sy_client.try_set_exchange_rate(&admin, &WAD),
        Err(Ok(SyError::ReadOnlyExchangeRate))
    ));

    let claimed = tokenizer_client.claim_yield(&alice);
    assert!(claimed > 0);
    let principal = tokenizer_client.recombine(&alice, &expected_shares, &expected_shares);
    assert!(principal > 0);
    let sy_to_redeem = sy_client.balance(&alice);
    assert_eq!(sy_to_redeem, claimed + principal);

    let redeemed = sy_client.redeem(&alice, &sy_to_redeem);
    assert!(redeemed > 100 * UNIT);
    assert_eq!(token::TokenClient::new(&env, &underlying).balance(&sy), 0);
    assert!(pool_client
        .get_positions(&sy)
        .supply
        .get(0)
        .unwrap_or(0)
        < expected_b_tokens);
}
