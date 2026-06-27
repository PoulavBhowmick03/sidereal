// SPDX-License-Identifier: Apache-2.0

#![cfg_attr(target_family = "wasm", no_std)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, vec, Address, Env,
    String, Symbol, Val,
};

const WAD: i128 = 1_000_000_000_000_000_000;

/// Display decimals for YT, matching SY and the 7-decimal underlying.
const DECIMALS: u32 = 7;

/// TTL policy, matching the AMM: bump when within 30 days of expiry, extend to
/// 120 days. A 90-day market that is touched periodically never archives.
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
    /// SY exchange rate the holder's yield was last settled at. Persistent,
    /// holder-keyed: the contract is single-maturity, so maturity is implicit.
    Checkpoint(Address),
    /// SY shares accrued to the holder but not yet claimed, carried across
    /// transfers. Persistent, holder-keyed.
    AccruedYield(Address),
    /// SY rate frozen at maturity. After maturity YT stops accruing new yield;
    /// settlement uses this snapshot so post-maturity rate moves add nothing.
    MaturityRate,
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

    /// The SY rate the holder's yield was last settled at. Zero means the
    /// holder has never been settled (no YT minted to them yet).
    pub fn checkpoint(env: Env, holder: Address) -> Result<i128, Error> {
        Self::read_config(&env)?;
        Ok(Self::read_checkpoint(&env, &holder).unwrap_or(0))
    }

    /// SY shares already banked to the holder but not yet claimed.
    pub fn accrued_yield(env: Env, holder: Address) -> Result<i128, Error> {
        Self::read_config(&env)?;
        Ok(Self::read_accrued(&env, &holder))
    }

    /// Total SY shares claimable by `holder` right now: already-banked yield
    /// plus what a settle at the current SY rate would add. The contract reads
    /// the rate from the SY contract itself, so no caller can supply a fake one.
    pub fn preview_claim_yield(env: Env, holder: Address) -> Result<i128, Error> {
        let config = Self::read_config(&env)?;
        let rate = Self::effective_rate(&env, &config);
        let banked = Self::read_accrued(&env, &holder);
        let pending = Self::pending_yield(&env, &holder, rate)?;
        banked.checked_add(pending).ok_or(Error::MathOverflow)
    }

    /// Settles `holder` to the current SY rate, then consumes (zeroes) and
    /// returns their banked yield in SY shares. Restricted to the tokenizer,
    /// which calls this from its own `claim_yield` and then pays the returned SY
    /// out of escrow. This moves no tokens itself; it is the bookkeeping half of
    /// a claim, paired with the tokenizer's escrow transfer.
    pub fn settle_and_consume(env: Env, holder: Address) -> Result<i128, Error> {
        let config = Self::read_config(&env)?;
        config.tokenizer.require_auth();
        Self::bump_instance_ttl(&env);
        Self::settle(&env, &holder);
        let owed = Self::read_accrued(&env, &holder);
        if owed > 0 {
            Self::write_accrued(&env, &holder, 0);
        }
        Ok(owed)
    }

    // --- Minter-privileged supply control (only the tokenizer) -------------

    /// Mints `amount` YT to `to`. Restricted to the tokenizer recorded at
    /// initialization, which mints YT when a holder splits SY. The recipient is
    /// settled first, so a fresh holder's checkpoint starts at the current rate
    /// and an existing holder's prior yield is banked before the balance grows.
    pub fn mint(env: Env, to: Address, amount: i128) {
        let config = Self::read_config_or_panic(&env);
        config.tokenizer.require_auth();
        Self::require_amount_or_panic(&env, amount);
        Self::bump_instance_ttl(&env);

        Self::settle(&env, &to);

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
        Self::settle(&env, &from);
        Self::settle(&env, &to);
        Self::move_balance(&env, &from, &to, amount);
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        Self::require_amount_or_panic(&env, amount);
        Self::bump_instance_ttl(&env);
        Self::spend_allowance(&env, &from, &spender, amount);
        Self::settle(&env, &from);
        Self::settle(&env, &to);
        Self::move_balance(&env, &from, &to, amount);
    }

    /// Burns `amount` YT from `from`. The tokenizer burns YT on recombine;
    /// holders may also burn their own balance. The holder is settled first so
    /// their accrued yield is banked before the balance shrinks.
    pub fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        Self::require_amount_or_panic(&env, amount);
        Self::bump_instance_ttl(&env);
        Self::settle(&env, &from);
        Self::burn_balance(&env, &from, amount);
    }

    pub fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        Self::require_amount_or_panic(&env, amount);
        Self::bump_instance_ttl(&env);
        Self::spend_allowance(&env, &from, &spender, amount);
        Self::settle(&env, &from);
        Self::burn_balance(&env, &from, amount);
    }

    // --- yield engine ------------------------------------------------------

    /// Reads the live SY exchange rate (asset per share, WAD scaled) from the
    /// SY contract recorded at initialization. The contract reads it itself so
    /// no caller can supply a manipulated rate.
    fn current_rate(env: &Env, config: &Config) -> i128 {
        let args: soroban_sdk::Vec<Val> = vec![env];
        env.invoke_contract(&config.sy_token, &Symbol::new(env, "exchange_rate"), args)
    }

    /// The rate yield settles against: the live SY rate before maturity, and the
    /// rate frozen at maturity afterwards, so YT stops accruing new yield once
    /// the term ends. The first post-maturity settlement snapshots it. (A
    /// read-only simulation that triggers the snapshot does not persist it, so
    /// the value is fixed by the first state-committing settle.)
    fn effective_rate(env: &Env, config: &Config) -> i128 {
        let raw = Self::current_rate(env, config);
        if env.ledger().timestamp() < config.maturity {
            return raw;
        }
        if let Some(rate) = env
            .storage()
            .instance()
            .get::<_, i128>(&DataKey::MaturityRate)
        {
            return rate;
        }
        env.storage().instance().set(&DataKey::MaturityRate, &raw);
        raw
    }

    /// SY shares `holder` would accrue if settled at `rate` right now, without
    /// writing anything. Zero before the holder is first settled.
    fn pending_yield(env: &Env, holder: &Address, rate: i128) -> Result<i128, Error> {
        let last = match Self::read_checkpoint(env, holder) {
            Some(c) => c,
            None => return Ok(0),
        };
        if rate <= last {
            return Ok(0);
        }
        let balance = Self::read_balance(env, holder);
        if balance <= 0 {
            return Ok(0);
        }
        Self::owed_shares(balance, last, rate)
    }

    /// Banks `holder`'s accrued yield up to the current rate and advances their
    /// checkpoint. Bookkeeping only: it never moves SY. A fresh holder simply
    /// starts accruing from the current rate. On a rate dip the checkpoint is
    /// held (not lowered), so no yield is paid for the dip and the holder
    /// resumes accruing only once the rate climbs back above it.
    fn settle(env: &Env, holder: &Address) {
        let config = Self::read_config_or_panic(env);
        let rate = Self::effective_rate(env, &config);

        let last = match Self::read_checkpoint(env, holder) {
            Some(c) => c,
            None => {
                Self::write_checkpoint(env, holder, rate);
                return;
            }
        };

        if rate <= last {
            return;
        }

        let balance = Self::read_balance(env, holder);
        if balance > 0 {
            let owed = match Self::owed_shares(balance, last, rate) {
                Ok(value) => value,
                Err(error) => panic_with_error!(env, error),
            };
            if owed > 0 {
                let prev = Self::read_accrued(env, holder);
                Self::write_accrued(env, holder, Self::add_or_panic(env, prev, owed));
            }
        }
        Self::write_checkpoint(env, holder, rate);
    }

    /// Yield owed for a balance held from rate `c` to rate `r`, in SY shares:
    ///   balance * (r - c) / (c * r) * WAD   ==   balance * (1/c - 1/r) * WAD
    /// This telescopes across intermediate settlements, so settling at every
    /// transfer banks exactly the same total as one settle at the end. Computed
    /// in a fixed order with checked math to stay within i128 under the testnet
    /// input bounds, rounding down (favoring the escrow).
    fn owed_shares(balance: i128, c: i128, r: i128) -> Result<i128, Error> {
        // asset yield measured at the checkpoint basis: balance * (r - c) / c
        let delta = r.checked_sub(c).ok_or(Error::MathOverflow)?;
        let asset_yield = balance
            .checked_mul(delta)
            .ok_or(Error::MathOverflow)?
            .checked_div(c)
            .ok_or(Error::MathOverflow)?;
        // convert to SY shares at the current rate: asset_yield * WAD / r
        asset_yield
            .checked_mul(WAD)
            .ok_or(Error::MathOverflow)?
            .checked_div(r)
            .ok_or(Error::MathOverflow)
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

    fn read_checkpoint(env: &Env, holder: &Address) -> Option<i128> {
        env.storage()
            .persistent()
            .get(&DataKey::Checkpoint(holder.clone()))
    }

    fn write_checkpoint(env: &Env, holder: &Address, rate: i128) {
        let key = DataKey::Checkpoint(holder.clone());
        env.storage().persistent().set(&key, &rate);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_EXTEND_TO_LEDGERS);
    }

    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD_LEDGERS, TTL_EXTEND_TO_LEDGERS);
    }

    fn read_accrued(env: &Env, holder: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::AccruedYield(holder.clone()))
            .unwrap_or(0)
    }

    fn write_accrued(env: &Env, holder: &Address, amount: i128) {
        let key = DataKey::AccruedYield(holder.clone());
        env.storage().persistent().set(&key, &amount);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_EXTEND_TO_LEDGERS);
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
    use sidereal_sy_wrapper::{SyWrapper, SyWrapperClient};
    use soroban_sdk::testutils::{Address as _, Ledger};

    const NOW: u64 = 1_770_000_000;
    const MATURITY: u64 = NOW + 90 * 24 * 60 * 60;
    const RATE_1_00: i128 = WAD;
    const RATE_1_05: i128 = 1_050_000_000_000_000_000;
    const RATE_1_10: i128 = 1_100_000_000_000_000_000;

    struct Fixture {
        env: Env,
        client: YtTokenClient<'static>,
        sy: SyWrapperClient<'static>,
        admin: Address,
        alice: Address,
        bob: Address,
    }

    fn fixture(now: u64) -> Fixture {
        let env = Env::default();
        env.ledger().set_timestamp(now);
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let tokenizer = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        // A real SY wrapper provides the exchange rate the YT yield engine reads.
        let sy_id = env.register(SyWrapper, ());
        let sy = SyWrapperClient::new(&env, &sy_id);
        let underlying = Address::generate(&env);
        sy.initialize(&admin, &underlying);

        let contract_id = env.register(YtToken, ());
        let client = YtTokenClient::new(&env, &contract_id);
        client.initialize(&admin, &tokenizer, &sy_id, &MATURITY);

        Fixture {
            env,
            client,
            sy,
            admin,
            alice,
            bob,
        }
    }

    #[test]
    fn mint_extends_instance_ttl() {
        use soroban_sdk::testutils::storage::Instance as _;
        let f = fixture(NOW);
        // A mint is a mutating entrypoint, so it must bump the instance TTL to
        // the 120-day window. Read the live TTL from inside the contract frame.
        f.client.mint(&f.alice, &1_000);
        let ttl = f.env.as_contract(&f.client.address, || {
            f.env.storage().instance().get_ttl()
        });
        assert!(
            ttl >= TTL_EXTEND_TO_LEDGERS,
            "instance TTL {} should be extended to at least {}",
            ttl,
            TTL_EXTEND_TO_LEDGERS
        );
    }

    #[test]
    fn mint_settles_fresh_holder_to_current_rate() {
        let f = fixture(NOW);
        f.sy.set_exchange_rate(&f.admin, &RATE_1_05);
        f.client.mint(&f.alice, &(100 * WAD));

        // Checkpoint starts at the rate when YT was first minted, so prior
        // history is not retroactively claimable.
        assert_eq!(f.client.checkpoint(&f.alice), RATE_1_05);
        assert_eq!(f.client.accrued_yield(&f.alice), 0);
    }

    #[test]
    fn claim_banks_yield_using_the_telescoping_formula() {
        let f = fixture(NOW);
        // Split at 1.05, not 1.00, to exercise the correct (r-c)/(c*r) form.
        f.sy.set_exchange_rate(&f.admin, &RATE_1_05);
        f.client.mint(&f.alice, &(100 * WAD));

        f.sy.set_exchange_rate(&f.admin, &RATE_1_10);
        let claimable = f.client.settle_and_consume(&f.alice);

        // owed = 100 * (1/1.05 - 1/1.10) * WAD = 100 * 0.0432900 = 4.329 SY.
        // A naive (r-c)/WAD form would wrongly bank 100*0.05 = 5.0 SY.
        let expected = (100 * WAD) * (RATE_1_10 - RATE_1_05) / RATE_1_05 * WAD / RATE_1_10;
        assert!((claimable - expected).abs() <= 2, "claimable {}", claimable);
        assert!(
            (claimable - 4_329_004_329_004_329_000).abs() <= 1_000_000,
            "approx 4.329 SY, got {}",
            claimable
        );
        assert_eq!(f.client.checkpoint(&f.alice), RATE_1_10);
    }

    #[test]
    fn first_claim_at_mint_rate_accrues_nothing() {
        let f = fixture(NOW);
        f.client.mint(&f.alice, &(100 * WAD)); // minted at rate 1.00
        let claimable = f.client.settle_and_consume(&f.alice);
        assert_eq!(claimable, 0);
        assert_eq!(f.client.checkpoint(&f.alice), RATE_1_00);
    }

    #[test]
    fn yield_is_conserved_across_a_transfer() {
        let f = fixture(NOW);
        f.client.mint(&f.alice, &(100 * WAD)); // at 1.00

        // Rate rises, Alice accrues, then sends half to Bob without claiming.
        f.sy.set_exchange_rate(&f.admin, &RATE_1_10);
        f.client.transfer(&f.alice, &f.bob, &(50 * WAD));

        // Alice keeps the yield she earned on 100 over 1.00 -> 1.10. Bob starts
        // fresh at 1.10, so he has nothing yet.
        let alice_pending = f.client.preview_claim_yield(&f.alice);
        let bob_pending = f.client.preview_claim_yield(&f.bob);
        let expected_alice = (100 * WAD) * (RATE_1_10 - RATE_1_00) / RATE_1_00 * WAD / RATE_1_10;
        assert!((alice_pending - expected_alice).abs() <= 2);
        assert_eq!(bob_pending, 0, "Bob earns only from 1.10 forward");

        // Rate rises again; now both earn on their post-transfer balances.
        f.sy.set_exchange_rate(&f.admin, &(RATE_1_10 + WAD / 10));
        let r2 = RATE_1_10 + WAD / 10;
        let alice2 = f.client.preview_claim_yield(&f.alice);
        let bob2 = f.client.preview_claim_yield(&f.bob);

        // Conservation: Alice's total + Bob's total equals the yield a single
        // 100 balance would have earned from 1.00 to r2.
        let single = (100 * WAD) * (r2 - RATE_1_00) / RATE_1_00 * WAD / r2;
        assert!(
            (alice2 + bob2 - single).abs() <= 4,
            "alice {} + bob {} vs single {}",
            alice2,
            bob2,
            single
        );
    }

    #[test]
    fn mint_increases_balance_and_supply() {
        let f = fixture(NOW);
        f.client.mint(&f.alice, &1_000);
        assert_eq!(f.client.balance(&f.alice), 1_000);
        assert_eq!(f.client.total_supply(), 1_000);
        assert_eq!(f.client.symbol(), String::from_str(&f.env, "sYT"));
    }

    #[test]
    fn transfer_moves_balance() {
        let f = fixture(NOW);
        f.client.mint(&f.alice, &1_000);
        f.client.transfer(&f.alice, &f.bob, &400);
        assert_eq!(f.client.balance(&f.alice), 600);
        assert_eq!(f.client.balance(&f.bob), 400);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #7)")]
    fn transfer_rejects_insufficient_balance() {
        let f = fixture(NOW);
        f.client.mint(&f.alice, &100);
        f.client.transfer(&f.alice, &f.bob, &101);
    }

    #[test]
    fn approve_and_transfer_from_spend_allowance() {
        let f = fixture(NOW);
        f.client.mint(&f.alice, &1_000);
        f.client
            .approve(&f.alice, &f.bob, &500, &(NOW as u32 + 1_000));
        f.client
            .transfer_from(&f.bob, &f.alice, &f.bob, &300);
        assert_eq!(f.client.balance(&f.alice), 700);
        assert_eq!(f.client.balance(&f.bob), 300);
        assert_eq!(f.client.allowance(&f.alice, &f.bob), 200);
    }

    #[test]
    fn burn_reduces_balance_and_supply() {
        let f = fixture(NOW);
        f.client.mint(&f.alice, &1_000);
        f.client.burn(&f.alice, &400);
        assert_eq!(f.client.balance(&f.alice), 600);
        assert_eq!(f.client.total_supply(), 600);
    }
}
