// SPDX-License-Identifier: Apache-2.0

#![cfg_attr(target_family = "wasm", no_std)]

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contracterror, contractimpl, contracttype, token, vec, Address, Env, I256, IntoVal,
    MuxedAddress, Symbol, Val, Vec,
};

const WAD: i128 = 1_000_000_000_000_000_000;

/// TTL policy, matching the AMM: bump when within 30 days of expiry, extend to
/// 120 days, so a periodically-touched market never archives mid-term.
const LEDGERS_PER_DAY: u32 = 17_280;
const TTL_THRESHOLD_LEDGERS: u32 = 30 * LEDGERS_PER_DAY;
const TTL_EXTEND_TO_LEDGERS: u32 = 120 * LEDGERS_PER_DAY;

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
    /// SY rate frozen at maturity, used for all post-maturity redemption so
    /// later rate moves cannot change what PT redeems for.
    MaturityRate,
    /// The most recent SY rate read by a pre-maturity mutating operation (or a
    /// permissionless `observe_rate` poke). The maturity freeze uses this
    /// observation instead of a live post-maturity read, so yield that a live
    /// source (Blend has no maturity concept) keeps accruing after maturity can
    /// never leak into redemption, no matter how late the first post-maturity
    /// call arrives.
    LastObservedRate,
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
    MathOverflow = 7,
    LiveMarket = 8,
    /// Retired: no entrypoint gates on escrow coverage anymore (shortfalls are
    /// priced pro-rata at redemption instead). Kept so code 9 stays reserved.
    Insolvent = 9,
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

    /// Permissionless: before maturity, read the live SY rate and record it as
    /// the latest observation the maturity freeze may use. Every mutating
    /// operation records one as a side effect; this poke exists so anyone (a
    /// keeper, or a YT holder who wants the freeze to credit yield accrued
    /// right up to maturity) can refresh the observation on an otherwise idle
    /// market without moving tokens. Returns the observed rate.
    pub fn observe_rate(env: Env) -> Result<i128, Error> {
        let config = Self::read_config(&env)?;
        Self::require_live(&env, &config)?;
        Self::bump_instance_ttl(&env);
        Ok(observe_live_rate(&env, &config))
    }

    /// Permissionless: after maturity, snapshot and return the SY rate used for
    /// all redemption. Any caller may poke this so the maturity rate is captured
    /// promptly; redemption also snapshots it lazily on first use. Idempotent
    /// once set. The snapshot is the last rate observed at or before maturity,
    /// never a live post-maturity read (see `effective_rate`), so the timing of
    /// this call cannot move value between PT and YT.
    pub fn freeze_maturity_rate(env: Env) -> Result<i128, Error> {
        let config = Self::read_config(&env)?;
        if env.ledger().timestamp() < config.maturity {
            return Err(Error::LiveMarket);
        }
        Ok(effective_rate(&env, &config))
    }

    /// The frozen maturity rate, or 0 if not yet snapshotted.
    pub fn maturity_rate(env: Env) -> Result<i128, Error> {
        Self::read_config(&env)?;
        Ok(env
            .storage()
            .instance()
            .get(&DataKey::MaturityRate)
            .unwrap_or(0))
    }

    /// PT and YT minted for `sy_amount` SY at the current rate, in asset units.
    pub fn preview_split(env: Env, sy_amount: i128) -> Result<(i128, i128), Error> {
        let config = Self::read_config(&env)?;
        Self::require_live(&env, &config)?;
        Self::require_positive_amount(sy_amount)?;

        let rate = current_rate(&env, &config.sy_token);
        let face = mul_div_floor(&env, sy_amount, rate, WAD)?;
        Ok((face, face))
    }

    /// SY shares returned for recombining equal PT and YT (asset units) at the
    /// current rate. This is the principal only; any accrued YT yield is settled
    /// separately into the holder's claim ledger. Mirrors `recombine` exactly,
    /// including the pro-rata escrow cap, so the preview never overquotes
    /// during a rate-regression shortfall.
    ///
    /// Point-in-time read of the live Blend SY rate: if the rate moves between
    /// this quote and submission, the executed `recombine` share count can
    /// differ. The underlying value redeemed does not — `recombine` always
    /// returns `pt_face` worth of principal regardless of rate, so a moved rate
    /// changes the SY share count, not what it's worth. `recombine` has no
    /// on-chain `min_sy_out` floor by design; a caller needing an exact share
    /// count should compare this preview to its bound client-side before
    /// submitting.
    pub fn preview_recombine(env: Env, pt_amount: i128, yt_amount: i128) -> Result<i128, Error> {
        let config = Self::read_config(&env)?;
        Self::require_live(&env, &config)?;
        Self::require_positive_amount(pt_amount)?;
        Self::require_positive_amount(yt_amount)?;

        if pt_amount != yt_amount {
            return Err(Error::AmountMismatch);
        }

        let rate = current_rate(&env, &config.sy_token);
        let full = mul_div_floor(&env, pt_amount, WAD, rate)?;
        let escrow_shares = token_balance(&env, &config.sy_token, &env.current_contract_address());
        let pt_supply = pt_total_supply(&env, &config.pt_token);
        let pro_rata = mul_div_floor(&env, escrow_shares, pt_amount, pt_supply)?;
        Ok(if full < pro_rata { full } else { pro_rata })
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

    /// Pulls `sy_amount` SY from `from` into escrow and mints equal PT and YT,
    /// denominated in asset units: `face = sy_amount * rate / WAD`. At rate 1.00
    /// this equals `sy_amount`. PT is the fixed principal claim; YT is the yield
    /// claim. The escrow holds the SY shares; their asset value at the current
    /// rate equals the PT face exactly at mint, which is the coverage invariant.
    pub fn split(env: Env, from: Address, sy_amount: i128) -> Result<(i128, i128), Error> {
        from.require_auth();
        let config = Self::read_config(&env)?;
        Self::require_live(&env, &config)?;
        Self::require_positive_amount(sy_amount)?;
        Self::bump_instance_ttl(&env);

        let rate = observe_live_rate(&env, &config);
        let face = mul_div_floor(&env, sy_amount, rate, WAD)?;
        Self::require_positive_amount(face)?;

        pull_token(&env, &config.sy_token, &from, sy_amount);
        mint_token(&env, &config.pt_token, &from, face);
        mint_token(&env, &config.yt_token, &from, face);

        // No solvency gate here. Split is collateral-neutral: it adds `sy_amount`
        // SY to escrow (asset value `face` at the current rate) and mints exactly
        // `face` of PT, so escrow coverage moves by an equal amount on both sides
        // and cannot worsen. Gating it only bricked new mints on a market that was
        // already underwater, which is not how Pendle behaves: minting PT/YT never
        // reverts on collateralization (PendleYieldToken._mintPY has no such
        // check). Any shortfall is priced at redemption by the pro-rata cap in
        // `recombine` and `redeem_at_maturity`, not blocked at mint.
        Ok((face, face))
    }

    /// Burns equal PT and YT (asset units) from `from` and returns principal in SY
    /// shares: `pt_amount * WAD / rate`, capped to the holder's pro-rata share of
    /// escrow under a shortfall (identical cap to `redeem_at_maturity`). Burning the
    /// YT settles the holder's accrued yield first (the YT burn hook banks it into
    /// the holder's claim ledger), so recombine returns only principal and the
    /// banked yield stays owed and covered by the remaining escrow. Never reverts on
    /// collateralization: a shortfall is priced as a haircut, matching Pendle.
    pub fn recombine(
        env: Env,
        from: Address,
        pt_amount: i128,
        yt_amount: i128,
    ) -> Result<i128, Error> {
        from.require_auth();
        let config = Self::read_config(&env)?;
        Self::require_live(&env, &config)?;
        Self::require_positive_amount(pt_amount)?;
        Self::require_positive_amount(yt_amount)?;

        if pt_amount != yt_amount {
            return Err(Error::AmountMismatch);
        }

        Self::bump_instance_ttl(&env);
        let rate = observe_live_rate(&env, &config);
        let full = mul_div_floor(&env, pt_amount, WAD, rate)?;

        // Cap the principal returned to the holder's pro-rata share of escrow, the
        // same guard `redeem_at_maturity` uses. When escrow fully covers PT this is
        // the full principal (`pro_rata >= full`), so solvent recombine is
        // unchanged; under a rate regression it is a fair haircut that preserves the
        // escrow/PT ratio for holders who have not yet exited. This replaces the old
        // hard solvency revert: like Pendle, recombine never blocks a redemption on
        // collateralization, it prices the shortfall instead. The YT burn above
        // settles the holder's accrued yield into their claim ledger first, so that
        // yield is not lost to the haircut.
        let escrow_shares = token_balance(&env, &config.sy_token, &env.current_contract_address());
        let pt_supply = pt_total_supply(&env, &config.pt_token);
        let pro_rata = mul_div_floor(&env, escrow_shares, pt_amount, pt_supply)?;
        let sy_equivalent = if full < pro_rata { full } else { pro_rata };
        Self::require_positive_amount(sy_equivalent)?;

        burn_token(&env, &config.pt_token, &from, pt_amount);
        // YT burns through the tokenizer-gated `burn_settled` with the rate
        // observed above: yt cannot call back into this contract for a rate
        // while it is on the stack, and handing the same observation down
        // keeps the yield banked by the settle consistent with what the
        // maturity freeze has on record.
        burn_settled_yt(&env, &config.yt_token, &from, yt_amount, rate);
        push_token(&env, &config.sy_token, &from, sy_equivalent);

        Ok(sy_equivalent)
    }

    /// After maturity, burns `pt_amount` PT (asset units) from `from` and returns
    /// principal in SY shares: `pt_amount * WAD / rate`, capped to the holder's
    /// pro-rata share of escrow.
    ///
    /// Insolvency guard: if a rate regression (negative yield, a slash) has left
    /// the escrow unable to cover all PT principal, the payout is capped to
    /// `escrow_shares * pt_amount / pt_supply`, so PT holders share the shortfall
    /// pro-rata rather than letting the first redeemers drain the escrow at the
    /// expense of the last. When solvent, the ideal payout is the smaller of the
    /// two, so this pays principal in full. Capping preserves the escrow/PT ratio,
    /// keeping every later redeemer's share fair.
    ///
    /// The rate read here is the current SY rate; Phase 3 step 9 snapshots a
    /// maturity rate so post-maturity rate moves do not change redemption.
    pub fn redeem_at_maturity(env: Env, from: Address, pt_amount: i128) -> Result<i128, Error> {
        from.require_auth();
        let config = Self::read_config(&env)?;
        Self::require_matured(&env, &config)?;
        Self::require_positive_amount(pt_amount)?;
        Self::bump_instance_ttl(&env);

        let rate = effective_rate(&env, &config);
        let full = mul_div_floor(&env, pt_amount, WAD, rate)?;

        let escrow_shares = token_balance(&env, &config.sy_token, &env.current_contract_address());
        let pt_supply = pt_total_supply(&env, &config.pt_token);
        let pro_rata = mul_div_floor(&env, escrow_shares, pt_amount, pt_supply)?;
        let sy_to_pay = if full < pro_rata { full } else { pro_rata };
        Self::require_positive_amount(sy_to_pay)?;

        burn_token(&env, &config.pt_token, &from, pt_amount);
        push_token(&env, &config.sy_token, &from, sy_to_pay);

        Ok(sy_to_pay)
    }

    /// Pays `holder` their accrued YT yield in SY out of escrow, capped so PT
    /// principal is always senior to banked YT yield, and returns the SY amount
    /// paid. Allowed any time, including after maturity, so a holder can always
    /// collect yield earned over the term.
    ///
    /// PT-senior surplus cap. The YT contract settles the holder and reports the
    /// banked total `owed` WITHOUT zeroing it (`settle`). The tokenizer then pays
    /// only `min(owed, surplus)`, where
    ///   `surplus = max(0, escrow_shares - pt_face_reservation)`
    /// and `pt_face_reservation = ceil(pt_supply * WAD / rate)` is the SY escrow
    /// needed to redeem every outstanding PT at its face at `rate`. The
    /// reservation is rounded UP, so PT is never shorted by a rounding notch and
    /// the surplus is the conservative (smaller) amount. It then `consume`s
    /// exactly `pay` from the YT ledger and pushes `pay` SY. Anything owed beyond
    /// `pay` stays banked in the YT ledger, claimable later once the rate
    /// recovers (a transient sub-stroop dip) or, under a permanent slash, capped
    /// there forever by the short escrow: never overpaid, never lost.
    ///
    /// This makes already-banked YT yield JUNIOR to PT principal, correcting the
    /// prior first-come behavior where a YT holder could drain escrow in full
    /// while PT redemption was capped pro-rata, effectively senioring YT over PT.
    pub fn claim_yield(env: Env, holder: Address) -> Result<i128, Error> {
        holder.require_auth();
        let config = Self::read_config(&env)?;
        Self::bump_instance_ttl(&env);

        // Establish the canonical rate here, in the tokenizer, and hand it to
        // the YT contract. Before maturity this is the live SY rate; after
        // maturity `effective_rate` snapshots the frozen `MaturityRate` (or
        // reuses the existing snapshot), the same single value PT redemption
        // uses. YT cannot fetch it itself on this path: the tokenizer is already
        // on the call stack, so a callback into it would re-enter (prohibited).
        // Passing it down also fixes the ordering trap where a YT claim is the
        // first post-maturity action: the freeze happens here, before the YT
        // settle, so both sides settle against the same rate regardless of order.
        let rate = effective_rate(&env, &config);

        // Settle to learn what the holder is owed (their full banked total) at
        // this rate. `settle` banks and returns; it does not zero the ledger, so
        // if the surplus cannot cover all of it the remainder is left banked.
        let owed = settle_yt(&env, &config.yt_token, &holder, rate);

        // PT-senior surplus. Reserve enough escrow to redeem all outstanding PT
        // face at `rate` (rounded UP so PT is never shorted), and pay YT only out
        // of the remainder. `escrow_shares` and `pt_supply` are read the same way
        // `redeem_at_maturity` reads them.
        let escrow_shares =
            token_balance(&env, &config.sy_token, &env.current_contract_address());
        let pt_supply = pt_total_supply(&env, &config.pt_token);
        let pt_face_reservation = mul_div_ceil(&env, pt_supply, WAD, rate)?;
        let surplus = if escrow_shares > pt_face_reservation {
            escrow_shares - pt_face_reservation
        } else {
            0
        };
        let pay = if owed < surplus { owed } else { surplus };

        // Consume exactly what we pay, then push it. The remainder (owed - pay)
        // stays banked automatically because `settle` never zeroed it. Neither
        // `consume` (YT) nor `push_token` (SY) calls back into the tokenizer, so
        // the re-entrancy model is intact: the rate was computed and frozen above
        // and handed down, never fetched by a callee.
        if pay > 0 {
            consume_yt(&env, &config.yt_token, &holder, pay);
            push_token(&env, &config.sy_token, &holder, pay);
        }

        Ok(pay)
    }

    // Note: there is deliberately no `preview_claim_yield` wrapper here. YT's
    // `preview_claim_yield` is read directly (the SDK already calls it on the YT
    // contract). Wrapping it in the tokenizer would re-enter: post-maturity YT's
    // preview reads the canonical rate back from the tokenizer's `maturity_rate`,
    // and a tokenizer -> YT -> tokenizer hop is prohibited re-entry.

    fn read_config(env: &Env) -> Result<Config, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }

    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD_LEDGERS, TTL_EXTEND_TO_LEDGERS);
    }

    fn require_live(env: &Env, config: &Config) -> Result<(), Error> {
        if env.ledger().timestamp() >= config.maturity {
            return Err(Error::Matured);
        }

        Ok(())
    }

    fn require_matured(env: &Env, config: &Config) -> Result<(), Error> {
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

/// Reads the SY exchange rate (asset per share, WAD scaled) from the SY contract.
fn current_rate(env: &Env, sy_token: &Address) -> i128 {
    let args: Vec<Val> = vec![env];
    env.invoke_contract(sy_token, &Symbol::new(env, "exchange_rate"), args)
}

/// `a * b / c`, rounded down (toward zero).
///
/// The product `a * b` is computed through a 256-bit intermediate, so it cannot
/// overflow before the divide even when the final quotient fits i128. The audit
/// flagged that the old i128 `checked_mul` path could spuriously revert on
/// reservation math (`pt_supply * WAD`) whose quotient is small but whose product
/// exceeds i128. Any i128 * i128 product fits in i256 (max ~5.79e76 > ~2.89e76),
/// so `mul` never overflows here; `MathOverflow` is returned only when the true
/// quotient does not fit i128. Callers pass strictly positive `a`, `b`, `c`, so
/// truncation toward zero equals floor.
fn mul_div_floor(env: &Env, a: i128, b: i128, c: i128) -> Result<i128, Error> {
    let prod = I256::from_i128(env, a).mul(&I256::from_i128(env, b));
    prod.div(&I256::from_i128(env, c))
        .to_i128()
        .ok_or(Error::MathOverflow)
}

/// `a * b / c`, rounded up (ceil), for non-negative product and positive divisor.
///
/// Uses `(a * b + c - 1) / c`, computed through the same 256-bit intermediate as
/// `mul_div_floor` so neither the product nor the `+ c - 1` bump can overflow
/// before the divide. Used only for the PT face reservation, where rounding up
/// reserves at least enough escrow to cover all outstanding PT and so can never
/// short a PT holder by a rounding notch. Callers pass strictly positive `a`,
/// `b`, `c`.
fn mul_div_ceil(env: &Env, a: i128, b: i128, c: i128) -> Result<i128, Error> {
    let c256 = I256::from_i128(env, c);
    let prod = I256::from_i128(env, a).mul(&I256::from_i128(env, b));
    let numerator = prod.add(&c256).sub(&I256::from_i128(env, 1));
    numerator
        .div(&c256)
        .to_i128()
        .ok_or(Error::MathOverflow)
}

/// Settles `holder` on the YT contract at `rate` and returns their banked total
/// in SY shares WITHOUT consuming it. Authorizes the call as the tokenizer, since
/// YT gates `settle` on the tokenizer's address.
fn settle_yt(env: &Env, yt_token: &Address, holder: &Address, rate: i128) -> i128 {
    let args: Vec<Val> = vec![env, holder.into_val(env), rate.into_val(env)];
    authorize_self_call(env, yt_token, "settle", args.clone());
    env.invoke_contract(yt_token, &Symbol::new(env, "settle"), args)
}

/// Consumes exactly `amount` SY shares from `holder`'s banked YT ledger (YT
/// asserts `amount <= banked`). Moves no tokens; the tokenizer pushes the SY out
/// of escrow separately. Authorizes the call as the tokenizer, since YT gates
/// `consume` on the tokenizer's address.
fn consume_yt(env: &Env, yt_token: &Address, holder: &Address, amount: i128) {
    let args: Vec<Val> = vec![env, holder.into_val(env), amount.into_val(env)];
    authorize_self_call(env, yt_token, "consume", args.clone());
    env.invoke_contract::<()>(yt_token, &Symbol::new(env, "consume"), args);
}

/// Burns `amount` YT from `from` via the tokenizer-gated `burn_settled`,
/// handing down `rate` so the settle inside the burn banks yield at the same
/// rate this contract observed (yt cannot call back in for one mid-call).
fn burn_settled_yt(env: &Env, yt_token: &Address, from: &Address, amount: i128, rate: i128) {
    let args: Vec<Val> = vec![
        env,
        from.into_val(env),
        amount.into_val(env),
        rate.into_val(env),
    ];
    authorize_self_call(env, yt_token, "burn_settled", args.clone());
    env.invoke_contract::<()>(yt_token, &Symbol::new(env, "burn_settled"), args);
}

/// Outstanding PT supply (asset units) read from the PT contract.
fn pt_total_supply(env: &Env, pt_token: &Address) -> i128 {
    let args: Vec<Val> = vec![env];
    env.invoke_contract(pt_token, &Symbol::new(env, "total_supply"), args)
}

/// Reads the live SY rate and records it as the latest pre-maturity
/// observation. Every mutating pre-maturity operation routes its rate read
/// through here, so the maturity freeze always has a rate that was actually
/// observed before maturity to fall back on.
fn observe_live_rate(env: &Env, config: &Config) -> i128 {
    let rate = current_rate(env, &config.sy_token);
    env.storage()
        .instance()
        .set(&DataKey::LastObservedRate, &rate);
    rate
}

/// The rate to value the escrow at: the live SY rate before maturity, and the
/// rate frozen at maturity afterwards. The freeze does NOT read the live rate
/// after maturity: Blend has no maturity concept and keeps accruing, so a live
/// post-maturity read would let the freeze timing move value between PT and YT
/// (a later snapshot means a higher rate, fewer SY shares per PT, and more for
/// YT). Instead the freeze uses the last rate observed at or before maturity
/// (every mutating operation records one, and anyone can record a fresher one
/// with `observe_rate`), so post-maturity accrual can never reach redemption
/// regardless of when the first post-maturity call lands. The unobserved tail
/// between the last observation and the maturity instant is credited to
/// neither side's advantage deterministically: the frozen rate is at most the
/// true maturity rate, which favors PT, consistent with PT being senior. YT
/// holders can narrow that tail to nothing by poking `observe_rate` shortly
/// before maturity. The live-read fallback below is reachable only for a
/// market that never had a single mutating operation, which has no PT or YT
/// outstanding and therefore nothing to misprice.
fn effective_rate(env: &Env, config: &Config) -> i128 {
    if env.ledger().timestamp() < config.maturity {
        return observe_live_rate(env, config);
    }
    if let Some(rate) = env
        .storage()
        .instance()
        .get::<_, i128>(&DataKey::MaturityRate)
    {
        return rate;
    }
    let rate = env
        .storage()
        .instance()
        .get::<_, i128>(&DataKey::LastObservedRate)
        .unwrap_or_else(|| current_rate(env, &config.sy_token));
    env.storage().instance().set(&DataKey::MaturityRate, &rate);
    rate
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
    use sidereal_sy_wrapper::{SyWrapper, SyWrapperClient};
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

        // A real SY wrapper supplies the exchange rate the tokenizer reads to
        // size mints and redemptions. It defaults to rate 1.00 after init.
        let sy_token = env.register(SyWrapper, ());
        SyWrapperClient::new(&env, &sy_token).initialize(&admin, &Address::generate(&env));

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

    // preview_recombine's happy path reads real escrow and PT supply for its
    // pro-rata cap, so it is covered in tests/integration (economics.rs)
    // against real tokens; the unit fixture's placeholder PT address cannot
    // answer total_supply. Only the argument gating is asserted here.
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
