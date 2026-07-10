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
    /// `consume` was asked to remove more than the holder's banked balance. This
    /// is a tokenizer-side invariant violation (it only consumes what a prior
    /// `settle` reported as banked), surfaced as an error rather than a silent
    /// underflow.
    ConsumeExceedsBanked = 11,
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
    ///
    /// Before maturity this is a point-in-time read of the live rate, so the
    /// executed `claim_yield` amount may differ if the rate moves between this
    /// quote and submission. After maturity it uses the tokenizer's frozen
    /// maturity rate (see `preview_rate`), so it no longer tracks live accrual.
    pub fn preview_claim_yield(env: Env, holder: Address) -> Result<i128, Error> {
        let config = Self::read_config(&env)?;
        let rate = Self::preview_rate(&env, &config);
        let banked = Self::read_accrued(&env, &holder);
        let pending = Self::pending_yield(&env, &holder, rate)?;
        banked.checked_add(pending).ok_or(Error::MathOverflow)
    }

    /// Settles `holder` at the `rate` supplied by the tokenizer and returns their
    /// current banked total in SY shares WITHOUT zeroing it. Restricted to the
    /// tokenizer. Moves no tokens; it is the first half of a claim.
    ///
    /// This is deliberately split from `consume` (they used to be one
    /// `settle_and_consume` that zeroed the whole ledger). All-or-nothing consume
    /// could not express a partial payment, but the tokenizer now caps a claim to
    /// the escrow surplus over the senior PT reservation. So it `settle`s to learn
    /// the owed total, decides how much the surplus can cover, and `consume`s only
    /// that. Whatever it does not consume stays banked and is claimable later.
    ///
    /// The rate is passed in, not read here, on purpose. The tokenizer is already
    /// on the call stack when it invokes this (claim_yield -> here), so yt cannot
    /// call back into the tokenizer to fetch the canonical maturity rate: Soroban
    /// prohibits re-entering a contract already on the stack. The tokenizer instead
    /// computes its single canonical rate (live before maturity, its frozen
    /// snapshot after) and hands it down. Trusting it is safe because this
    /// entrypoint is gated on the tokenizer's own auth, so no other caller can
    /// supply a rate.
    pub fn settle(env: Env, holder: Address, rate: i128) -> Result<i128, Error> {
        let config = Self::read_config(&env)?;
        config.tokenizer.require_auth();
        Self::bump_instance_ttl(&env);
        Self::settle_into_ledger(&env, &holder, rate);
        Ok(Self::read_accrued(&env, &holder))
    }

    /// Subtracts exactly `amount` SY shares from `holder`'s banked ledger.
    /// Restricted to the tokenizer, which calls this after `settle` and pushes the
    /// same `amount` of SY out of escrow itself. Moves no tokens. `amount == 0` is
    /// a no-op; `amount` must be `<= banked` (the tokenizer only ever consumes what
    /// a prior `settle` reported), enforced so the ledger can never go negative.
    /// The remainder stays banked and claimable later once escrow can cover it.
    pub fn consume(env: Env, holder: Address, amount: i128) -> Result<(), Error> {
        let config = Self::read_config(&env)?;
        config.tokenizer.require_auth();
        if amount < 0 {
            return Err(Error::InvalidAmount);
        }
        Self::bump_instance_ttl(&env);
        let banked = Self::read_accrued(&env, &holder);
        if amount > banked {
            return Err(Error::ConsumeExceedsBanked);
        }
        if amount > 0 {
            Self::write_accrued(&env, &holder, banked - amount);
        }
        Ok(())
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

        // Mint is only reached through the tokenizer's `split`, which runs
        // pre-maturity with the tokenizer on the call stack, so this cannot
        // route through `committing_rate` (calling back into the tokenizer
        // would re-enter). A plain live read is equivalent here: `split`
        // observed this same rate itself in this same transaction, so the
        // freeze already has it on record.
        let rate = Self::current_rate(&env, &config);
        Self::settle_into_ledger(&env, &to, rate);

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
        Self::write_allowance(&env, &from, &spender, amount, expiration_ledger);
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        Self::require_amount_or_panic(&env, amount);
        Self::bump_instance_ttl(&env);
        let config = Self::read_config_or_panic(&env);
        let rate = Self::committing_rate(&env, &config);
        Self::settle_into_ledger(&env, &from, rate);
        Self::settle_into_ledger(&env, &to, rate);
        Self::move_balance(&env, &from, &to, amount);
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        Self::require_amount_or_panic(&env, amount);
        Self::bump_instance_ttl(&env);
        Self::spend_allowance(&env, &from, &spender, amount);
        let config = Self::read_config_or_panic(&env);
        let rate = Self::committing_rate(&env, &config);
        Self::settle_into_ledger(&env, &from, rate);
        Self::settle_into_ledger(&env, &to, rate);
        Self::move_balance(&env, &from, &to, amount);
    }

    /// Burns `amount` YT from `from`, on a holder's own direct call. The
    /// holder is settled first so their accrued yield is banked before the
    /// balance shrinks, at a rate observed through the tokenizer. The
    /// tokenizer's recombine burns through `burn_settled` instead, passing the
    /// rate down, because it is on the call stack here and cannot be called
    /// back into.
    ///
    /// This can drop YT total_supply below PT total_supply by design — not a
    /// bug. No economic path reads YT total_supply; the tokenizer's escrow,
    /// PT-senior cap, and pro-rata math read only `pt_total_supply`.
    pub fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        Self::require_amount_or_panic(&env, amount);
        Self::bump_instance_ttl(&env);
        let config = Self::read_config_or_panic(&env);
        let rate = Self::committing_rate(&env, &config);
        Self::settle_into_ledger(&env, &from, rate);
        Self::burn_balance(&env, &from, amount);
    }

    /// Burns `amount` YT from `from`, settling them first at the `rate`
    /// supplied by the tokenizer. Restricted to the tokenizer, which calls
    /// this from `recombine` while it is on the call stack: yt cannot call
    /// back into it to observe a rate, so the tokenizer hands down the same
    /// rate it observed in that transaction. Trusting the argument is safe
    /// because of the auth gate, the same model as `settle` and `consume`.
    /// The holder's own authorization is enforced by `recombine` itself.
    pub fn burn_settled(env: Env, from: Address, amount: i128, rate: i128) -> Result<(), Error> {
        let config = Self::read_config(&env)?;
        config.tokenizer.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        Self::bump_instance_ttl(&env);
        Self::settle_into_ledger(&env, &from, rate);
        Self::burn_balance(&env, &from, amount);
        Ok(())
    }

    pub fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        Self::require_amount_or_panic(&env, amount);
        Self::bump_instance_ttl(&env);
        Self::spend_allowance(&env, &from, &spender, amount);
        let config = Self::read_config_or_panic(&env);
        let rate = Self::committing_rate(&env, &config);
        Self::settle_into_ledger(&env, &from, rate);
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

    /// The rate a state-committing settle uses on a path yt is entered
    /// DIRECTLY by a holder (transfer, transfer_from, burn, burn_from). Both
    /// branches go through the tokenizer, never a raw SY read, so every rate
    /// this contract banks yield at is also on record for the maturity freeze:
    ///
    /// - Before maturity: the tokenizer's permissionless `observe_rate`, which
    ///   reads the live SY rate, records it as the freeze's latest
    ///   pre-maturity observation, and returns it. Without this, a direct YT
    ///   transfer could bank yield at a rate the freeze never saw, and the
    ///   first post-maturity touch could then freeze an older, lower rate,
    ///   starving YT of yield its ledger already recognized.
    /// - After maturity: the tokenizer's `freeze_maturity_rate`, the single
    ///   canonical frozen rate. yt keeps no maturity snapshot of its own.
    ///
    /// This must never run while the tokenizer is on the call stack, or the
    /// cross-contract call would re-enter it (prohibited). The callers here
    /// are entered directly by a holder, never by the tokenizer: the
    /// tokenizer-driven paths receive the rate as an argument instead
    /// (`settle`, `consume`, `burn_settled`) or take a plain live read that
    /// the tokenizer observed itself in the same transaction (`mint`).
    fn committing_rate(env: &Env, config: &Config) -> i128 {
        let args: soroban_sdk::Vec<Val> = vec![env];
        if env.ledger().timestamp() < config.maturity {
            return env.invoke_contract(
                &config.tokenizer,
                &Symbol::new(env, "observe_rate"),
                args,
            );
        }
        env.invoke_contract(
            &config.tokenizer,
            &Symbol::new(env, "freeze_maturity_rate"),
            args,
        )
    }

    /// The rate for a read-only yield preview. Before maturity, the live SY
    /// rate. After maturity, the tokenizer's canonical frozen rate once it has
    /// been snapshotted, else the live SY rate as a best estimate (the value the
    /// first post-maturity action will freeze). This never writes, so it is safe
    /// to run in a simulation, and it reads the tokenizer without freezing.
    fn preview_rate(env: &Env, config: &Config) -> i128 {
        if env.ledger().timestamp() < config.maturity {
            return Self::current_rate(env, config);
        }
        let args: soroban_sdk::Vec<Val> = vec![env];
        let frozen: i128 = env.invoke_contract(
            &config.tokenizer,
            &Symbol::new(env, "maturity_rate"),
            args,
        );
        if frozen > 0 {
            frozen
        } else {
            Self::current_rate(env, config)
        }
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

    /// Banks `holder`'s accrued yield up to `rate` and advances their
    /// checkpoint. Bookkeeping only: it never moves SY. A fresh holder simply
    /// starts accruing from `rate`. On a rate dip the checkpoint is held (not
    /// lowered), so no yield is paid for the dip and the holder resumes accruing
    /// only once the rate climbs back above it. The caller sources `rate` (live
    /// before maturity, the tokenizer's canonical frozen rate after) so this
    /// function makes no cross-contract call of its own.
    ///
    /// Named `settle_into_ledger` to distinguish it from the public `settle`
    /// entrypoint, which wraps this and returns the banked total without zeroing.
    fn settle_into_ledger(env: &Env, holder: &Address, rate: i128) {
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

    /// Writes the allowance and, when the allowance is live (amount > 0),
    /// extends the temporary entry's own TTL so it survives until
    /// `expiration_ledger`. A freshly created temporary entry only lives for
    /// the network minimum temporary TTL; bumping the instance TTL does not
    /// keep per-entry temporary storage alive, so without this extension the
    /// allowance archives long before the requested expiration.
    fn write_allowance(
        env: &Env,
        from: &Address,
        spender: &Address,
        amount: i128,
        expiration_ledger: u32,
    ) {
        let key = DataKey::Allowance(from.clone(), spender.clone());
        env.storage().temporary().set(
            &key,
            &AllowanceValue {
                amount,
                expiration_ledger,
            },
        );
        if amount > 0 {
            // Callers guarantee expiration_ledger >= the current sequence
            // whenever amount > 0 (approve validates it; spend_allowance only
            // reaches here through a live, unexpired allowance).
            let live_for = expiration_ledger - env.ledger().sequence();
            env.storage()
                .temporary()
                .extend_ttl(&key, live_for, live_for);
        }
    }

    fn spend_allowance(env: &Env, from: &Address, spender: &Address, amount: i128) {
        let allowance = Self::read_allowance(env, from, spender);
        if allowance.amount < amount {
            panic_with_error!(env, Error::InsufficientAllowance);
        }
        Self::write_allowance(
            env,
            from,
            spender,
            allowance.amount - amount,
            allowance.expiration_ledger,
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
    use sidereal_tokenizer::{Tokenizer, TokenizerClient};
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
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        // A real SY wrapper provides the exchange rate the YT yield engine reads.
        let sy_id = env.register(SyWrapper, ());
        let sy = SyWrapperClient::new(&env, &sy_id);
        let underlying = Address::generate(&env);
        sy.initialize(&admin, &underlying);

        // A real tokenizer too: direct holder paths (transfer, burn) resolve
        // their settle rate through the tokenizer's observe_rate and
        // freeze_maturity_rate, so a placeholder address cannot serve. The PT
        // address it records is a placeholder; the rate paths never touch PT.
        let tokenizer_id = env.register(Tokenizer, ());
        let pt_placeholder = Address::generate(&env);

        let contract_id = env.register(YtToken, ());
        let client = YtTokenClient::new(&env, &contract_id);
        client.initialize(&admin, &tokenizer_id, &sy_id, &MATURITY);
        TokenizerClient::new(&env, &tokenizer_id).initialize(
            &admin,
            &sy_id,
            &pt_placeholder,
            &contract_id,
            &MATURITY,
        );

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
        // Pre-maturity, the tokenizer would settle at the live SY rate; pass it.
        // `settle` banks and reports the owed total without zeroing the ledger.
        let claimable = f.client.settle(&f.alice, &RATE_1_10);

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
        // The ledger still holds the banked total: settle does not consume it.
        assert_eq!(f.client.accrued_yield(&f.alice), claimable);
    }

    #[test]
    fn consume_removes_only_the_requested_amount() {
        let f = fixture(NOW);
        f.sy.set_exchange_rate(&f.admin, &RATE_1_05);
        f.client.mint(&f.alice, &(100 * WAD));
        f.sy.set_exchange_rate(&f.admin, &RATE_1_10);

        let banked = f.client.settle(&f.alice, &RATE_1_10);
        assert!(banked > 0);

        // Consume half; the remainder must stay banked and claimable later.
        let part = banked / 2;
        f.client.consume(&f.alice, &part);
        assert_eq!(f.client.accrued_yield(&f.alice), banked - part);

        // A second settle at the same rate adds nothing (checkpoint held), so the
        // remainder is still exactly what was left.
        let still = f.client.settle(&f.alice, &RATE_1_10);
        assert_eq!(still, banked - part);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #11)")]
    fn consume_more_than_banked_is_rejected() {
        let f = fixture(NOW);
        f.sy.set_exchange_rate(&f.admin, &RATE_1_05);
        f.client.mint(&f.alice, &(100 * WAD));
        f.sy.set_exchange_rate(&f.admin, &RATE_1_10);
        let banked = f.client.settle(&f.alice, &RATE_1_10);
        f.client.consume(&f.alice, &(banked + 1));
    }

    #[test]
    fn first_claim_at_mint_rate_accrues_nothing() {
        let f = fixture(NOW);
        f.client.mint(&f.alice, &(100 * WAD)); // minted at rate 1.00
        let claimable = f.client.settle(&f.alice, &RATE_1_00);
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
            .approve(&f.alice, &f.bob, &500, &1_000);
        f.client
            .transfer_from(&f.bob, &f.alice, &f.bob, &300);
        assert_eq!(f.client.balance(&f.alice), 700);
        assert_eq!(f.client.balance(&f.bob), 300);
        assert_eq!(f.client.allowance(&f.alice, &f.bob), 200);
    }

    #[test]
    fn allowance_entry_ttl_covers_requested_expiration() {
        use soroban_sdk::testutils::storage::Temporary as _;

        let f = fixture(NOW);
        f.client.mint(&f.alice, &1_000);

        // Model mainnet-like conditions: the network minimum temporary-entry
        // TTL is far shorter than the requested allowance lifetime.
        const START_SEQ: u32 = 1_000;
        const MIN_TEMP_TTL: u32 = 1_600;
        const EXPIRATION: u32 = START_SEQ + 500_000;
        f.env.ledger().set_sequence_number(START_SEQ);
        f.env.ledger().set_min_temp_entry_ttl(MIN_TEMP_TTL);

        f.client.approve(&f.alice, &f.bob, &500, &EXPIRATION);

        // The test host never archives entries on a sequence jump, so reading
        // the allowance back after a jump would pass even without the fix.
        // Assert the entry's own TTL instead: it must cover the requested
        // expiration ledger, not just the minimum it gets at creation.
        let key = DataKey::Allowance(f.alice.clone(), f.bob.clone());
        let ttl = f.env.as_contract(&f.client.address, || {
            f.env.storage().temporary().get_ttl(&key)
        });
        assert!(
            START_SEQ + ttl >= EXPIRATION,
            "allowance TTL {} from sequence {} must cover expiration {}",
            ttl,
            START_SEQ,
            EXPIRATION
        );

        // Jump well past the minimum temporary TTL but before expiration; the
        // allowance must still be readable and spendable.
        const JUMPED: u32 = START_SEQ + MIN_TEMP_TTL + 100_000;
        f.env.ledger().set_sequence_number(JUMPED);
        assert_eq!(f.client.allowance(&f.alice, &f.bob), 500);
        f.client.transfer_from(&f.bob, &f.alice, &f.bob, &300);
        assert_eq!(f.client.allowance(&f.alice, &f.bob), 200);
        assert_eq!(f.client.balance(&f.bob), 300);

        // The reduced allowance written back by transfer_from must also keep
        // a TTL covering the stored expiration ledger.
        let ttl = f.env.as_contract(&f.client.address, || {
            f.env.storage().temporary().get_ttl(&key)
        });
        assert!(
            JUMPED + ttl >= EXPIRATION,
            "post-spend allowance TTL {} from sequence {} must cover expiration {}",
            ttl,
            JUMPED,
            EXPIRATION
        );
    }

    #[test]
    fn burn_reduces_balance_and_supply() {
        let f = fixture(NOW);
        f.client.mint(&f.alice, &1_000);
        f.client.burn(&f.alice, &400);
        assert_eq!(f.client.balance(&f.alice), 600);
        assert_eq!(f.client.total_supply(), 600);
    }

    /// burn_settled trusts its rate argument, so it must be callable by the
    /// tokenizer alone. With auth enforcement on and no tokenizer signature,
    /// the call must fail rather than let an arbitrary caller settle a holder
    /// at a rate of their choosing and burn their balance.
    #[test]
    fn burn_settled_is_gated_on_the_tokenizer() {
        let f = fixture(NOW);
        f.client.mint(&f.alice, &1_000);
        // Switch from mock-all to enforcing mode with no authorizations.
        f.env.set_auths(&[]);
        let result = f.client.try_burn_settled(&f.alice, &400, &WAD);
        assert!(
            result.is_err(),
            "burn_settled without the tokenizer's authorization must fail"
        );
        f.env.mock_all_auths();
        assert_eq!(f.client.balance(&f.alice), 1_000, "nothing was burned");
    }
}
