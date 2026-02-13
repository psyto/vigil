use solana_program::{
    account_info::AccountInfo, clock::Clock, entrypoint::ProgramResult, msg,
    program_error::ProgramError, pubkey::Pubkey, sysvar::Sysvar,
};

use matcher_common::{verify_lp_pda as verify_lp_pda_common, verify_init_preconditions, write_header, write_exec_price, compute_exec_price};

use crate::errors::YieldMatcherError;
use crate::state::*;

/// Tag 0x02: Initialize restaking yield matcher context
/// Accounts:
///   [0] LP PDA (signer)
///   [1] Matcher context account (writable, 320 bytes)
/// Data layout:
///   [0]    tag (0x02)
///   [1]    mode (u8: 0=AllNCN, 1=SingleNCN)
///   [2..6] base_spread_bps (u32 LE)
///   [6..10] yield_vol_spread_bps (u32 LE)
///   [10..14] max_spread_bps (u32 LE)
///   [14..18] impact_k_bps (u32 LE)
///   [18..34] liquidity_notional_e6 (u128 LE)
///   [34..50] max_fill_abs (u128 LE)
///   [50..82] ncn_yield_feed pubkey (32 bytes)
///   [82..114] ncn_performance_feed pubkey (32 bytes)
pub fn process_init(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    if data.len() < 114 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let lp_pda = &accounts[0];
    let ctx_account = &accounts[1];

    // Verify writable, sized, and not already initialized
    verify_init_preconditions(ctx_account, YIELD_MATCHER_MAGIC, "YIELD-MATCHER")?;

    let mut ctx_data = ctx_account.try_borrow_mut_data()?;

    // Write standard header (return data, magic, version, mode, padding, LP PDA)
    write_header(&mut ctx_data, YIELD_MATCHER_MAGIC, data[1], lp_pda.key);

    // Spread params
    ctx_data[BASE_SPREAD_OFFSET..BASE_SPREAD_OFFSET + 4].copy_from_slice(&data[2..6]);
    ctx_data[YIELD_VOL_SPREAD_OFFSET..YIELD_VOL_SPREAD_OFFSET + 4].copy_from_slice(&data[6..10]);
    ctx_data[MAX_SPREAD_OFFSET..MAX_SPREAD_OFFSET + 4].copy_from_slice(&data[10..14]);
    ctx_data[IMPACT_K_OFFSET..IMPACT_K_OFFSET + 4].copy_from_slice(&data[14..18]);

    // Initialize yield data to zero
    ctx_data[CURRENT_YIELD_OFFSET..CURRENT_YIELD_OFFSET + 8].copy_from_slice(&0u64.to_le_bytes());
    ctx_data[YIELD_MARK_PRICE_OFFSET..YIELD_MARK_PRICE_OFFSET + 8].copy_from_slice(&0u64.to_le_bytes());
    ctx_data[LAST_UPDATE_SLOT_OFFSET..LAST_UPDATE_SLOT_OFFSET + 8].copy_from_slice(&0u64.to_le_bytes());
    ctx_data[YIELD_REGIME_OFFSET] = 2; // Normal
    ctx_data[YIELD_REGIME_OFFSET + 1..YIELD_REGIME_OFFSET + 8].fill(0); // padding
    ctx_data[YIELD_7D_AVG_OFFSET..YIELD_7D_AVG_OFFSET + 8].copy_from_slice(&0u64.to_le_bytes());
    ctx_data[YIELD_30D_AVG_OFFSET..YIELD_30D_AVG_OFFSET + 8].copy_from_slice(&0u64.to_le_bytes());

    // Liquidity + max fill
    ctx_data[LIQUIDITY_OFFSET..LIQUIDITY_OFFSET + 16].copy_from_slice(&data[18..34]);
    ctx_data[MAX_FILL_OFFSET..MAX_FILL_OFFSET + 16].copy_from_slice(&data[34..50]);

    // Oracle accounts
    ctx_data[NCN_YIELD_FEED_OFFSET..NCN_YIELD_FEED_OFFSET + 32].copy_from_slice(&data[50..82]);
    ctx_data[NCN_PERFORMANCE_FEED_OFFSET..NCN_PERFORMANCE_FEED_OFFSET + 32].copy_from_slice(&data[82..114]);

    // Zero reserved
    ctx_data[272..CTX_SIZE].fill(0);

    let base_spread_val = u32::from_le_bytes(
        data[2..6].try_into().map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let yield_vol_val = u32::from_le_bytes(
        data[6..10].try_into().map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let max_spread_val = u32::from_le_bytes(
        data[10..14].try_into().map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    msg!(
        "INIT: lp_pda={} mode={} base_spread={} yield_vol_spread={} max_spread={}",
        lp_pda.key,
        data[1],
        base_spread_val,
        yield_vol_val,
        max_spread_val,
    );

    Ok(())
}

/// Tag 0x00: Execute match — compute yield-regime-adjusted execution price
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

    // Verify LP PDA signature, magic, and PDA match
    verify_lp_pda_common(lp_pda, ctx_account, YIELD_MATCHER_MAGIC, "YIELD-MATCHER")?;

    // Read pricing parameters
    let ctx_data = ctx_account.try_borrow_data()?;
    let base_spread = u32::from_le_bytes(
        ctx_data[BASE_SPREAD_OFFSET..BASE_SPREAD_OFFSET + 4]
            .try_into().map_err(|_| ProgramError::InvalidAccountData)?,
    );
    let yield_vol_spread = u32::from_le_bytes(
        ctx_data[YIELD_VOL_SPREAD_OFFSET..YIELD_VOL_SPREAD_OFFSET + 4]
            .try_into().map_err(|_| ProgramError::InvalidAccountData)?,
    );
    let max_spread = u32::from_le_bytes(
        ctx_data[MAX_SPREAD_OFFSET..MAX_SPREAD_OFFSET + 4]
            .try_into().map_err(|_| ProgramError::InvalidAccountData)?,
    );
    let yield_mark = u64::from_le_bytes(
        ctx_data[YIELD_MARK_PRICE_OFFSET..YIELD_MARK_PRICE_OFFSET + 8]
            .try_into().map_err(|_| ProgramError::InvalidAccountData)?,
    );
    let regime = YieldRegime::from_u8(ctx_data[YIELD_REGIME_OFFSET]);

    // Reject if yield mark price not set
    if yield_mark == 0 {
        msg!("YIELD-MATCHER: Yield mark price not set -- oracle sync required");
        return Err(YieldMatcherError::OracleNotSynced.into());
    }

    // Check oracle staleness (reject if > 100 slots old)
    let last_update = u64::from_le_bytes(
        ctx_data[LAST_UPDATE_SLOT_OFFSET..LAST_UPDATE_SLOT_OFFSET + 8]
            .try_into().map_err(|_| ProgramError::InvalidAccountData)?,
    );
    let clock = Clock::get()?;
    if clock.slot.saturating_sub(last_update) > 100 {
        msg!("YIELD-MATCHER: Oracle stale -- last update slot {}, current {}", last_update, clock.slot);
        return Err(YieldMatcherError::OracleStale.into());
    }

    // Dynamic spread based on yield regime
    let regime_multiplier = regime.spread_multiplier();
    let adjusted_yield_vol = (yield_vol_spread as u64)
        .checked_mul(regime_multiplier)
        .ok_or(YieldMatcherError::ArithmeticOverflow)?
        / 100;

    let total_spread = std::cmp::min(
        (base_spread as u64).saturating_add(adjusted_yield_vol),
        max_spread as u64,
    );

    // Compute execution price using shared utility
    let exec_price = compute_exec_price(yield_mark, total_spread)?;

    drop(ctx_data);

    // Write execution price to return buffer using shared utility
    let mut ctx_data = ctx_account.try_borrow_mut_data()?;
    write_exec_price(&mut ctx_data, exec_price);

    msg!(
        "MATCH: price={} spread={} regime={:?} yield_mark={}",
        exec_price,
        total_spread,
        regime,
        yield_mark
    );

    Ok(())
}

/// Tag 0x03: Sync oracle — keeper reads NCN oracle and updates matcher context
/// Accounts:
///   [0] Matcher context account (writable)
///   [1] NcnYieldFeed account (read)
///   [2] NcnPerformanceFeed account (read)
/// Data layout:
///   [0]    tag (0x03)
///   [1..9] current_yield_bps (u64 LE) — from keeper reading NCN oracle
///   [9..17] yield_mark_price_e6 (u64 LE) — yield * 1e6
///   [17]   regime (u8)
///   [18..26] yield_7d_avg_bps (u64 LE)
///   [26..34] yield_30d_avg_bps (u64 LE)
pub fn process_oracle_sync(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    if data.len() < 34 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let ctx_account = &accounts[0];
    let ncn_yield_feed = &accounts[1];
    let ncn_performance_feed = &accounts[2];

    if !ctx_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    // Verify context is initialized
    {
        let ctx_data = ctx_account.try_borrow_data()?;
        if !verify_magic(&ctx_data) {
            return Err(ProgramError::UninitializedAccount);
        }

        // Verify passed accounts match stored oracle accounts
        let stored_yield_feed = Pubkey::new_from_array(
            ctx_data[NCN_YIELD_FEED_OFFSET..NCN_YIELD_FEED_OFFSET + 32]
                .try_into().map_err(|_| ProgramError::InvalidAccountData)?,
        );
        let stored_perf_feed = Pubkey::new_from_array(
            ctx_data[NCN_PERFORMANCE_FEED_OFFSET..NCN_PERFORMANCE_FEED_OFFSET + 32]
                .try_into().map_err(|_| ProgramError::InvalidAccountData)?,
        );
        if *ncn_yield_feed.key != stored_yield_feed {
            msg!("YIELD-MATCHER: NcnYieldFeed mismatch");
            return Err(YieldMatcherError::OracleAccountMismatch.into());
        }
        if *ncn_performance_feed.key != stored_perf_feed {
            msg!("YIELD-MATCHER: NcnPerformanceFeed mismatch");
            return Err(YieldMatcherError::OracleAccountMismatch.into());
        }
    }

    let current_yield = u64::from_le_bytes(
        data[1..9].try_into().map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let yield_mark = u64::from_le_bytes(
        data[9..17].try_into().map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let regime = data[17];
    let yield_7d = u64::from_le_bytes(
        data[18..26].try_into().map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let yield_30d = u64::from_le_bytes(
        data[26..34].try_into().map_err(|_| ProgramError::InvalidInstructionData)?,
    );

    // Validate regime
    if regime > 4 {
        return Err(YieldMatcherError::InvalidRegime.into());
    }

    let clock = Clock::get()?;

    let mut ctx_data = ctx_account.try_borrow_mut_data()?;
    let old_yield = u64::from_le_bytes(
        ctx_data[CURRENT_YIELD_OFFSET..CURRENT_YIELD_OFFSET + 8]
            .try_into().map_err(|_| ProgramError::InvalidAccountData)?,
    );

    ctx_data[CURRENT_YIELD_OFFSET..CURRENT_YIELD_OFFSET + 8].copy_from_slice(&current_yield.to_le_bytes());
    ctx_data[YIELD_MARK_PRICE_OFFSET..YIELD_MARK_PRICE_OFFSET + 8].copy_from_slice(&yield_mark.to_le_bytes());
    ctx_data[LAST_UPDATE_SLOT_OFFSET..LAST_UPDATE_SLOT_OFFSET + 8].copy_from_slice(&clock.slot.to_le_bytes());
    ctx_data[YIELD_REGIME_OFFSET] = regime;
    ctx_data[YIELD_7D_AVG_OFFSET..YIELD_7D_AVG_OFFSET + 8].copy_from_slice(&yield_7d.to_le_bytes());
    ctx_data[YIELD_30D_AVG_OFFSET..YIELD_30D_AVG_OFFSET + 8].copy_from_slice(&yield_30d.to_le_bytes());

    msg!(
        "ORACLE_SYNC: old_yield={} new_yield={} mark={} regime={}",
        old_yield,
        current_yield,
        yield_mark,
        regime
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::state::*;
    use matcher_common::compute_exec_price;

    // Helper: replicate the pricing math from process_match for unit-testing
    fn calc_exec_price(
        base_spread: u32,
        yield_vol_spread: u32,
        max_spread: u32,
        regime: YieldRegime,
        yield_mark: u64,
    ) -> u64 {
        let regime_multiplier = regime.spread_multiplier();
        let adjusted_yield_vol = (yield_vol_spread as u64) * regime_multiplier / 100;
        let total_spread = std::cmp::min(
            (base_spread as u64).saturating_add(adjusted_yield_vol),
            max_spread as u64,
        );
        compute_exec_price(yield_mark, total_spread).unwrap()
    }

    // -----------------------------------------------------------------------
    // 1. Normal regime — typical restaking yield of ~8% (800 bps, mark = 800_000_000)
    // -----------------------------------------------------------------------
    #[test]
    fn test_normal_regime_pricing() {
        let price = calc_exec_price(20, 30, 200, YieldRegime::Normal, 800_000_000);
        // adjusted_yield_vol = 30 * 100 / 100 = 30
        // total_spread = min(20 + 30, 200) = 50
        // exec_price   = 800_000_000 * 10050 / 10000 = 804_000_000
        assert_eq!(price, 804_000_000);
    }

    // -----------------------------------------------------------------------
    // 2. Extreme regime — slashing event, yield instability
    // -----------------------------------------------------------------------
    #[test]
    fn test_extreme_regime_pricing() {
        let price = calc_exec_price(20, 30, 200, YieldRegime::Extreme, 800_000_000);
        // adjusted_yield_vol = 30 * 250 / 100 = 75
        // total_spread = min(20 + 75, 200) = 95
        // exec_price   = 800_000_000 * 10095 / 10000 = 807_600_000
        assert_eq!(price, 807_600_000);
    }

    // -----------------------------------------------------------------------
    // 3. VeryLow regime — stable staking yield
    // -----------------------------------------------------------------------
    #[test]
    fn test_very_low_regime_pricing() {
        let price = calc_exec_price(20, 30, 200, YieldRegime::VeryLow, 800_000_000);
        // adjusted_yield_vol = 30 * 50 / 100 = 15
        // total_spread = min(20 + 15, 200) = 35
        // exec_price   = 800_000_000 * 10035 / 10000 = 802_800_000
        assert_eq!(price, 802_800_000);
    }

    // -----------------------------------------------------------------------
    // 4. Spread capping (total_spread exceeds max_spread)
    // -----------------------------------------------------------------------
    #[test]
    fn test_spread_capping() {
        let price = calc_exec_price(100, 200, 150, YieldRegime::Extreme, 800_000_000);
        // adjusted_yield_vol = 200 * 250 / 100 = 500
        // total_spread = min(100 + 500, 150) = 150
        // exec_price   = 800_000_000 * 10150 / 10000 = 812_000_000
        assert_eq!(price, 812_000_000);
    }

    // -----------------------------------------------------------------------
    // 5. YieldRegime::from_u8
    // -----------------------------------------------------------------------
    #[test]
    fn test_regime_from_u8() {
        assert_eq!(YieldRegime::from_u8(0), YieldRegime::VeryLow);
        assert_eq!(YieldRegime::from_u8(1), YieldRegime::Low);
        assert_eq!(YieldRegime::from_u8(2), YieldRegime::Normal);
        assert_eq!(YieldRegime::from_u8(3), YieldRegime::High);
        assert_eq!(YieldRegime::from_u8(4), YieldRegime::Extreme);
        // Out-of-range defaults to Normal
        assert_eq!(YieldRegime::from_u8(5), YieldRegime::Normal);
    }

    // -----------------------------------------------------------------------
    // 6. YieldRegime::spread_multiplier
    // -----------------------------------------------------------------------
    #[test]
    fn test_regime_spread_multiplier() {
        assert_eq!(YieldRegime::VeryLow.spread_multiplier(), 50);
        assert_eq!(YieldRegime::Low.spread_multiplier(), 75);
        assert_eq!(YieldRegime::Normal.spread_multiplier(), 100);
        assert_eq!(YieldRegime::High.spread_multiplier(), 150);
        assert_eq!(YieldRegime::Extreme.spread_multiplier(), 250);
    }

    // -----------------------------------------------------------------------
    // 7. Low yield scenario (e.g., 2% APY = 200 bps, mark = 200_000_000)
    // -----------------------------------------------------------------------
    #[test]
    fn test_low_yield_pricing() {
        let price = calc_exec_price(15, 25, 300, YieldRegime::Low, 200_000_000);
        // adjusted_yield_vol = 25 * 75 / 100 = 18 (truncated)
        // total_spread = min(15 + 18, 300) = 33
        // exec_price   = 200_000_000 * 10033 / 10000 = 200_660_000
        assert_eq!(price, 200_660_000);
    }

    // -----------------------------------------------------------------------
    // 8. High yield scenario (e.g., 20% APY = 2000 bps, mark = 2_000_000_000)
    // -----------------------------------------------------------------------
    #[test]
    fn test_high_yield_high_regime() {
        let price = calc_exec_price(20, 40, 200, YieldRegime::High, 2_000_000_000);
        // adjusted_yield_vol = 40 * 150 / 100 = 60
        // total_spread = min(20 + 60, 200) = 80
        // exec_price   = 2_000_000_000 * 10080 / 10000 = 2_016_000_000
        assert_eq!(price, 2_016_000_000);
    }

    // -----------------------------------------------------------------------
    // 9. Zero spread scenario
    // -----------------------------------------------------------------------
    #[test]
    fn test_zero_spread() {
        let price = calc_exec_price(0, 0, 200, YieldRegime::Normal, 500_000_000);
        // total_spread = 0
        // exec_price = 500_000_000
        assert_eq!(price, 500_000_000);
    }
}
