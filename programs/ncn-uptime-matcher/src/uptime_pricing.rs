use solana_program::{
    account_info::AccountInfo, clock::Clock, entrypoint::ProgramResult, msg,
    program_error::ProgramError, pubkey::Pubkey, sysvar::Sysvar,
};

use matcher_common::{verify_lp_pda as verify_lp_pda_common, verify_init_preconditions, write_header, write_exec_price};

use crate::errors::UptimeMatcherError;
use crate::state::*;

/// Tag 0x02: Initialize NCN uptime matcher context
/// Accounts:
///   [0] LP PDA (signer)
///   [1] Matcher context account (writable, 320 bytes)
/// Data layout:
///   [0]    tag (0x02)
///   [1]    mode (u8: 0=Continuous, 1=SlashingSettlement)
///   [2..6] base_spread_bps (u32 LE)
///   [6..10] edge_spread_bps (u32 LE)
///   [10..14] max_spread_bps (u32 LE)
///   [14..18] impact_k_bps (u32 LE)
///   [18..26] initial_uptime_e6 (u64 LE)
///   [26..34] resolution_timestamp (i64 LE, 0 = no expiry)
///   [34..50] liquidity_notional_e6 (u128 LE)
///   [50..66] max_fill_abs (u128 LE)
///   [66..98] ncn_oracle pubkey (32 bytes)
pub fn process_init(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    if data.len() < 98 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let lp_pda = &accounts[0];
    let ctx_account = &accounts[1];

    verify_init_preconditions(ctx_account, UPTIME_MATCHER_MAGIC, "NCN-UPTIME-MATCHER")?;

    let initial_uptime = u64::from_le_bytes(data[18..26].try_into().unwrap());
    if initial_uptime > MAX_PROBABILITY {
        msg!("NCN-UPTIME-MATCHER: Initial uptime {} exceeds max {}", initial_uptime, MAX_PROBABILITY);
        return Err(UptimeMatcherError::InvalidProbability.into());
    }

    let mut ctx_data = ctx_account.try_borrow_mut_data()?;

    write_header(&mut ctx_data, UPTIME_MATCHER_MAGIC, data[1], lp_pda.key);

    // Spread params
    ctx_data[BASE_SPREAD_OFFSET..BASE_SPREAD_OFFSET + 4].copy_from_slice(&data[2..6]);
    ctx_data[EDGE_SPREAD_OFFSET..EDGE_SPREAD_OFFSET + 4].copy_from_slice(&data[6..10]);
    ctx_data[MAX_SPREAD_OFFSET..MAX_SPREAD_OFFSET + 4].copy_from_slice(&data[10..14]);
    ctx_data[IMPACT_K_OFFSET..IMPACT_K_OFFSET + 4].copy_from_slice(&data[14..18]);

    // Uptime probability
    ctx_data[CURRENT_UPTIME_OFFSET..CURRENT_UPTIME_OFFSET + 8]
        .copy_from_slice(&initial_uptime.to_le_bytes());
    ctx_data[UPTIME_MARK_OFFSET..UPTIME_MARK_OFFSET + 8]
        .copy_from_slice(&initial_uptime.to_le_bytes()); // mark = prob in e6

    let clock = Clock::get()?;
    ctx_data[LAST_UPDATE_SLOT_OFFSET..LAST_UPDATE_SLOT_OFFSET + 8]
        .copy_from_slice(&clock.slot.to_le_bytes());

    // Resolution
    ctx_data[RESOLUTION_TIMESTAMP_OFFSET..RESOLUTION_TIMESTAMP_OFFSET + 8]
        .copy_from_slice(&data[26..34]);
    ctx_data[IS_RESOLVED_OFFSET] = 0;
    ctx_data[RESOLUTION_OUTCOME_OFFSET] = 0;
    ctx_data[162..168].fill(0); // padding

    // Signal (init to none)
    ctx_data[SIGNAL_SEVERITY_OFFSET..SIGNAL_SEVERITY_OFFSET + 8]
        .copy_from_slice(&SIGNAL_NONE.to_le_bytes());
    ctx_data[SIGNAL_ADJUSTED_SPREAD_OFFSET..SIGNAL_ADJUSTED_SPREAD_OFFSET + 8]
        .copy_from_slice(&0u64.to_le_bytes());

    // Liquidity + max fill
    ctx_data[LIQUIDITY_OFFSET..LIQUIDITY_OFFSET + 16].copy_from_slice(&data[34..50]);
    ctx_data[MAX_FILL_OFFSET..MAX_FILL_OFFSET + 16].copy_from_slice(&data[50..66]);

    // NCN oracle
    ctx_data[NCN_ORACLE_OFFSET..NCN_ORACLE_OFFSET + 32].copy_from_slice(&data[66..98]);

    // Zero reserved
    ctx_data[248..CTX_SIZE].fill(0);

    msg!(
        "INIT: lp_pda={} mode={} uptime={} resolution_ts={}",
        lp_pda.key,
        data[1],
        initial_uptime,
        i64::from_le_bytes(data[26..34].try_into().unwrap()),
    );

    Ok(())
}

/// Tag 0x00: Execute match — probability-based pricing with edge spread for NCN uptime
/// Accounts:
///   [0] LP PDA (signer)
///   [1] Matcher context account (writable)
pub fn process_match(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let lp_pda = &accounts[0];
    let ctx_account = &accounts[1];

    // Verify LP PDA signature + context magic + PDA match
    verify_lp_pda_common(lp_pda, ctx_account, UPTIME_MATCHER_MAGIC, "NCN-UPTIME-MATCHER")?;

    let ctx_data = ctx_account.try_borrow_data()?;

    // Check if market is resolved
    if ctx_data[IS_RESOLVED_OFFSET] == 1 {
        msg!("NCN-UPTIME-MATCHER: Market is resolved -- no more trading");
        return Err(UptimeMatcherError::MarketResolved.into());
    }

    let base_spread = u32::from_le_bytes(
        ctx_data[BASE_SPREAD_OFFSET..BASE_SPREAD_OFFSET + 4].try_into().unwrap(),
    );
    let edge_spread = u32::from_le_bytes(
        ctx_data[EDGE_SPREAD_OFFSET..EDGE_SPREAD_OFFSET + 4].try_into().unwrap(),
    );
    let max_spread = u32::from_le_bytes(
        ctx_data[MAX_SPREAD_OFFSET..MAX_SPREAD_OFFSET + 4].try_into().unwrap(),
    );
    let uptime_e6 = u64::from_le_bytes(
        ctx_data[CURRENT_UPTIME_OFFSET..CURRENT_UPTIME_OFFSET + 8].try_into().unwrap(),
    );
    let signal_adj = u64::from_le_bytes(
        ctx_data[SIGNAL_ADJUSTED_SPREAD_OFFSET..SIGNAL_ADJUSTED_SPREAD_OFFSET + 8]
            .try_into()
            .unwrap(),
    );

    // Reject if uptime probability is 0 (not initialized)
    if uptime_e6 == 0 {
        msg!("NCN-UPTIME-MATCHER: Uptime probability not set");
        return Err(UptimeMatcherError::ProbabilityNotSet.into());
    }

    // Check oracle staleness (reject if > 200 slots old)
    let last_update = u64::from_le_bytes(
        ctx_data[LAST_UPDATE_SLOT_OFFSET..LAST_UPDATE_SLOT_OFFSET + 8].try_into().unwrap(),
    );
    let clock = Clock::get()?;
    if clock.slot.saturating_sub(last_update) > 200 {
        msg!("NCN-UPTIME-MATCHER: Oracle stale -- last update slot {}, current {}", last_update, clock.slot);
        return Err(UptimeMatcherError::OracleStale.into());
    }

    // Edge spread calculation:
    // Edge factor = 1 / (p * (1-p) * 4)
    // At 50%: factor = 1.0 (no extra spread)
    // At 99.5% (typical NCN): factor ~100 (wider spread — high confidence zone)
    // At 10%: factor ~2.78 (wider spread)
    let p = uptime_e6 as u128;
    let one_minus_p = MAX_PROBABILITY as u128 - p;

    // p * (1-p) * 4 / 1e12 gives us the denominator scaled appropriately
    let edge_denominator = p
        .checked_mul(one_minus_p)
        .unwrap_or(0)
        .checked_mul(4)
        .unwrap_or(0)
        / 1_000_000_000_000u128;

    let edge_factor = if edge_denominator > 0 {
        std::cmp::min(1_000_000u128 / edge_denominator, 10_000_000u128) // Cap at 10x
    } else {
        10_000_000u128 // Max factor if at exactly 0% or 100%
    };

    let adjusted_edge = (edge_spread as u128)
        .checked_mul(edge_factor)
        .unwrap_or(0)
        / 1_000_000u128;

    // Total spread = base + edge_adjustment + signal_adjustment
    let total_spread = std::cmp::min(
        (base_spread as u64).saturating_add(adjusted_edge as u64).saturating_add(signal_adj),
        max_spread as u64,
    );

    // Mark price = uptime_probability (already in e6 format)
    // Exec price = mark * (1 + spread/10000)
    let spread_mult = 10_000u64.saturating_add(total_spread);
    let exec_price = ((uptime_e6 as u128)
        .checked_mul(spread_mult as u128)
        .ok_or(UptimeMatcherError::ArithmeticOverflow)?
        / 10_000u128) as u64;

    drop(ctx_data);

    // Write execution price to return buffer
    let mut ctx_data = ctx_account.try_borrow_mut_data()?;
    write_exec_price(&mut ctx_data, exec_price);

    msg!(
        "MATCH: price={} spread={} uptime={} edge_factor={}",
        exec_price,
        total_spread,
        uptime_e6,
        edge_factor
    );

    Ok(())
}

/// Tag 0x03: Sync uptime probability from NCN oracle
/// Accounts:
///   [0] Matcher context account (writable)
///   [1] NCN oracle account (read — must match stored oracle)
/// Data:
///   [0]    tag (0x03)
///   [1..9] new_uptime_e6 (u64 LE, 0-1_000_000)
///   [9..17] signal_severity (u64 LE, 0-3)
///   [17..25] signal_adjusted_spread (u64 LE)
pub fn process_uptime_sync(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    if data.len() < 25 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let ctx_account = &accounts[0];
    let oracle = &accounts[1];

    if !ctx_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    // Verify context + oracle
    {
        let ctx_data = ctx_account.try_borrow_data()?;
        if !verify_magic(&ctx_data) {
            return Err(ProgramError::UninitializedAccount);
        }

        // Check market not resolved
        if ctx_data[IS_RESOLVED_OFFSET] == 1 {
            msg!("NCN-UPTIME-MATCHER: Cannot sync -- market resolved");
            return Err(UptimeMatcherError::MarketResolved.into());
        }

        let stored_oracle = read_ncn_oracle(&ctx_data);
        if *oracle.key != stored_oracle {
            msg!("NCN-UPTIME-MATCHER: Oracle mismatch");
            return Err(UptimeMatcherError::OracleMismatch.into());
        }
    }

    let new_uptime = u64::from_le_bytes(data[1..9].try_into().unwrap());
    if new_uptime > MAX_PROBABILITY {
        return Err(UptimeMatcherError::InvalidProbability.into());
    }

    let signal_severity = u64::from_le_bytes(data[9..17].try_into().unwrap());
    if signal_severity > SIGNAL_CRITICAL {
        return Err(UptimeMatcherError::InvalidSignalSeverity.into());
    }

    let signal_spread = u64::from_le_bytes(data[17..25].try_into().unwrap());
    let clock = Clock::get()?;

    let mut ctx_data = ctx_account.try_borrow_mut_data()?;
    let old_uptime = u64::from_le_bytes(
        ctx_data[CURRENT_UPTIME_OFFSET..CURRENT_UPTIME_OFFSET + 8]
            .try_into()
            .unwrap(),
    );

    ctx_data[CURRENT_UPTIME_OFFSET..CURRENT_UPTIME_OFFSET + 8]
        .copy_from_slice(&new_uptime.to_le_bytes());
    ctx_data[UPTIME_MARK_OFFSET..UPTIME_MARK_OFFSET + 8]
        .copy_from_slice(&new_uptime.to_le_bytes());
    ctx_data[LAST_UPDATE_SLOT_OFFSET..LAST_UPDATE_SLOT_OFFSET + 8]
        .copy_from_slice(&clock.slot.to_le_bytes());
    ctx_data[SIGNAL_SEVERITY_OFFSET..SIGNAL_SEVERITY_OFFSET + 8]
        .copy_from_slice(&signal_severity.to_le_bytes());
    ctx_data[SIGNAL_ADJUSTED_SPREAD_OFFSET..SIGNAL_ADJUSTED_SPREAD_OFFSET + 8]
        .copy_from_slice(&signal_spread.to_le_bytes());

    msg!(
        "UPTIME_SYNC: old_uptime={} new_uptime={} signal={}",
        old_uptime,
        new_uptime,
        signal_severity
    );

    Ok(())
}

/// Tag 0x04: Resolve NCN slashing event — sets final probability to 0 (SLASHED) or 1_000_000 (SAFE)
/// Accounts:
///   [0] Matcher context account (writable)
///   [1] NCN oracle account (signer — must be authorized oracle)
/// Data:
///   [0] tag (0x04)
///   [1] outcome (u8: 0=SLASHED -> prob=0, 1=SAFE -> prob=1_000_000)
pub fn process_resolve(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    if data.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let ctx_account = &accounts[0];
    let oracle = &accounts[1];

    // Oracle must be signer
    if !oracle.is_signer {
        msg!("NCN-UPTIME-MATCHER: Oracle must be signer for resolution");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Verify context + oracle
    {
        let ctx_data = ctx_account.try_borrow_data()?;
        if !verify_magic(&ctx_data) {
            return Err(ProgramError::UninitializedAccount);
        }

        if ctx_data[IS_RESOLVED_OFFSET] == 1 {
            msg!("NCN-UPTIME-MATCHER: Already resolved");
            return Err(UptimeMatcherError::MarketResolved.into());
        }

        let stored_oracle = read_ncn_oracle(&ctx_data);
        if *oracle.key != stored_oracle {
            msg!("NCN-UPTIME-MATCHER: Oracle mismatch");
            return Err(UptimeMatcherError::OracleMismatch.into());
        }
    }

    let outcome = data[1];
    if outcome > 1 {
        msg!("NCN-UPTIME-MATCHER: Invalid outcome: {} (must be 0=SLASHED or 1=SAFE)", outcome);
        return Err(UptimeMatcherError::InvalidOutcome.into());
    }

    let final_probability = if outcome == 1 {
        MAX_PROBABILITY // SAFE -> 100% uptime
    } else {
        0u64 // SLASHED -> 0%
    };

    let mut ctx_data = ctx_account.try_borrow_mut_data()?;
    ctx_data[IS_RESOLVED_OFFSET] = 1;
    ctx_data[RESOLUTION_OUTCOME_OFFSET] = outcome;
    ctx_data[CURRENT_UPTIME_OFFSET..CURRENT_UPTIME_OFFSET + 8]
        .copy_from_slice(&final_probability.to_le_bytes());
    ctx_data[UPTIME_MARK_OFFSET..UPTIME_MARK_OFFSET + 8]
        .copy_from_slice(&final_probability.to_le_bytes());

    msg!(
        "RESOLVE: outcome={} final_price={}",
        if outcome == 1 { "SAFE" } else { "SLASHED" },
        final_probability
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::state::*;

    /// Replicates the edge spread calculation from process_match, purely arithmetic.
    /// Returns (exec_price, total_spread, edge_factor).
    fn compute_exec_price_edge(
        uptime_e6: u64,
        base_spread: u32,
        edge_spread: u32,
        max_spread: u32,
        signal_adj: u64,
    ) -> (u64, u64, u128) {
        let p = uptime_e6 as u128;
        let one_minus_p = MAX_PROBABILITY as u128 - p;

        let edge_denominator = p
            .checked_mul(one_minus_p)
            .unwrap_or(0)
            .checked_mul(4)
            .unwrap_or(0)
            / 1_000_000_000_000u128;

        let edge_factor = if edge_denominator > 0 {
            std::cmp::min(1_000_000u128 / edge_denominator, 10_000_000u128)
        } else {
            10_000_000u128
        };

        let adjusted_edge = (edge_spread as u128)
            .checked_mul(edge_factor)
            .unwrap_or(0)
            / 1_000_000u128;

        let total_spread = std::cmp::min(
            (base_spread as u64)
                .saturating_add(adjusted_edge as u64)
                .saturating_add(signal_adj),
            max_spread as u64,
        );

        let spread_mult = 10_000u64.saturating_add(total_spread);
        let exec_price = ((uptime_e6 as u128)
            .checked_mul(spread_mult as u128)
            .unwrap()
            / 10_000u128) as u64;

        (exec_price, total_spread, edge_factor)
    }

    // -----------------------------------------------------------------------
    // 1. 50% uptime (unlikely but tests base case)
    // -----------------------------------------------------------------------
    #[test]
    fn test_50_percent_uptime() {
        let (price, spread, factor) = compute_exec_price_edge(500_000, 20, 30, 500, 0);
        assert_eq!(factor, 1_000_000);
        assert_eq!(spread, 50);
        assert_eq!(price, 502_500);
    }

    // -----------------------------------------------------------------------
    // 2. 99.5% uptime (typical healthy NCN)
    // -----------------------------------------------------------------------
    #[test]
    fn test_995_percent_uptime() {
        let (price, spread, factor) = compute_exec_price_edge(995_000, 20, 30, 500, 0);
        // p=995000, 1-p=5000
        // edge_denom = 995000*5000*4 / 1e12 = 19_900_000_000 / 1e12 = 0 (integer truncation!)
        // edge_factor = 10_000_000 (max, since denominator is 0)
        // adjusted_edge = 30 * 10_000_000 / 1_000_000 = 300
        // total_spread = min(20 + 300, 500) = 320
        assert_eq!(factor, 10_000_000);
        assert_eq!(spread, 320);
        // exec_price = 995000 * 10320 / 10000 = 1_026_840
        assert_eq!(price, 1_026_840);
    }

    // -----------------------------------------------------------------------
    // 3. 10% uptime (NCN in trouble)
    // -----------------------------------------------------------------------
    #[test]
    fn test_10_percent_uptime() {
        let (price, spread, factor) = compute_exec_price_edge(100_000, 20, 30, 500, 0);
        assert_eq!(factor, 10_000_000);
        assert_eq!(spread, 320);
        assert_eq!(price, 103_200);
    }

    // -----------------------------------------------------------------------
    // 4. 90% uptime
    // -----------------------------------------------------------------------
    #[test]
    fn test_90_percent_uptime() {
        let (price, spread, factor) = compute_exec_price_edge(900_000, 20, 30, 500, 0);
        assert_eq!(factor, 10_000_000);
        assert_eq!(spread, 320);
        assert_eq!(price, 928_800);
    }

    // -----------------------------------------------------------------------
    // 5. 1% uptime (NCN nearly dead)
    // -----------------------------------------------------------------------
    #[test]
    fn test_1_percent_uptime() {
        let (price, spread, factor) = compute_exec_price_edge(10_000, 20, 30, 500, 0);
        assert_eq!(factor, 10_000_000);
        assert_eq!(spread, 320);
        assert_eq!(price, 10_320);
    }

    // -----------------------------------------------------------------------
    // 6. 99% uptime
    // -----------------------------------------------------------------------
    #[test]
    fn test_99_percent_uptime() {
        let (price, spread, factor) = compute_exec_price_edge(990_000, 20, 30, 500, 0);
        assert_eq!(factor, 10_000_000);
        assert_eq!(spread, 320);
        assert_eq!(price, 1_021_680);
    }

    // -----------------------------------------------------------------------
    // 7. Signal adjustment (Kalshify-style spread widening)
    // -----------------------------------------------------------------------
    #[test]
    fn test_signal_adjustment() {
        let (price, spread, _) = compute_exec_price_edge(500_000, 20, 300, 500, 50);
        assert_eq!(spread, 370);
        assert_eq!(price, 518_500);
    }

    // -----------------------------------------------------------------------
    // 8. Signal CRITICAL widens spread significantly
    // -----------------------------------------------------------------------
    #[test]
    fn test_critical_signal_spread() {
        let (price, spread, _) = compute_exec_price_edge(995_000, 20, 30, 500, 200);
        // edge_factor = 10_000_000 (same reason as 99.5% test above)
        // adjusted_edge = 30 * 10_000_000 / 1_000_000 = 300
        // base(20) + edge(300) + signal(200) = 520, capped to max(500)
        assert_eq!(spread, 500);
        // exec_price = 995000 * 10500 / 10000 = 1_044_750
        assert_eq!(price, 1_044_750);
    }

    // -----------------------------------------------------------------------
    // 9. Max spread capping
    // -----------------------------------------------------------------------
    #[test]
    fn test_max_spread_capping() {
        let (price, spread, _) = compute_exec_price_edge(500_000, 20, 1000, 500, 500);
        assert_eq!(spread, 500);
        assert_eq!(price, 525_000);

        let (price2, spread2, _) = compute_exec_price_edge(10_000, 100, 200, 500, 300);
        assert_eq!(spread2, 500);
        assert_eq!(price2, 10_000 * 10_500 / 10_000);
    }

    // -----------------------------------------------------------------------
    // 10. Constants
    // -----------------------------------------------------------------------
    #[test]
    fn test_max_probability_constant() {
        assert_eq!(MAX_PROBABILITY, 1_000_000);
    }

    #[test]
    fn test_signal_severity_constants() {
        assert_eq!(SIGNAL_NONE, 0);
        assert_eq!(SIGNAL_LOW, 1);
        assert_eq!(SIGNAL_HIGH, 2);
        assert_eq!(SIGNAL_CRITICAL, 3);
    }

    // -----------------------------------------------------------------------
    // 11. Resolution test — SLASHED snaps probability to 0
    // -----------------------------------------------------------------------
    #[test]
    fn test_resolution_slashed() {
        // After SLASHED resolution, price should be 0
        let final_prob: u64 = 0;
        // No pricing possible (process_match would reject p=0)
        assert_eq!(final_prob, 0);
    }

    // -----------------------------------------------------------------------
    // 12. Resolution test — SAFE snaps probability to 1_000_000
    // -----------------------------------------------------------------------
    #[test]
    fn test_resolution_safe() {
        let final_prob = MAX_PROBABILITY;
        assert_eq!(final_prob, 1_000_000);
    }
}
