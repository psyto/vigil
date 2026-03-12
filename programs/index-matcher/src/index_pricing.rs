use solana_program::{
    account_info::AccountInfo, clock::Clock, entrypoint::ProgramResult, msg,
    program_error::ProgramError, pubkey::Pubkey, sysvar::Sysvar,
};

use matcher_common::{verify_lp_pda as verify_lp_pda_common, verify_init_preconditions, write_header, write_exec_price, compute_exec_price};

use crate::errors::IndexMatcherError;
use crate::state::*;

/// Tag 0x02: Initialize index matcher context
/// Accounts:
///   [0] LP PDA (signer)
///   [1] Matcher context account (writable, 320 bytes)
/// Data layout:
///   [0]    tag (0x02)
///   [1]    mode (u8: 0=FullIndex, 1=ExclusionIndex)
///   [2..6] base_spread_bps (u32 LE)
///   [6..10] index_vol_spread_bps (u32 LE)
///   [10..14] max_spread_bps (u32 LE)
///   [14..18] impact_k_bps (u32 LE)
///   [18..22] min_ncn_count (u32 LE)
///   [22..38] liquidity_notional_e6 (u128 LE)
///   [38..54] max_fill_abs (u128 LE)
///   [54..86] aggregated_feed pubkey (32 bytes)
pub fn process_init(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    if data.len() < 86 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let lp_pda = &accounts[0];
    let ctx_account = &accounts[1];

    // Verify writable, sized, and not already initialized
    verify_init_preconditions(ctx_account, INDEX_MATCHER_MAGIC, "INDEX-MATCHER")?;

    let mut ctx_data = ctx_account.try_borrow_mut_data()?;

    // Write standard header (return data, magic, version, mode, padding, LP PDA)
    write_header(&mut ctx_data, INDEX_MATCHER_MAGIC, data[1], lp_pda.key);

    // Spread params
    ctx_data[BASE_SPREAD_OFFSET..BASE_SPREAD_OFFSET + 4].copy_from_slice(&data[2..6]);
    ctx_data[INDEX_VOL_SPREAD_OFFSET..INDEX_VOL_SPREAD_OFFSET + 4].copy_from_slice(&data[6..10]);
    ctx_data[MAX_SPREAD_OFFSET..MAX_SPREAD_OFFSET + 4].copy_from_slice(&data[10..14]);
    ctx_data[IMPACT_K_OFFSET..IMPACT_K_OFFSET + 4].copy_from_slice(&data[14..18]);

    // Min NCN count
    ctx_data[MIN_NCN_COUNT_OFFSET..MIN_NCN_COUNT_OFFSET + 4].copy_from_slice(&data[18..22]);

    // Initialize index data to zero
    ctx_data[WEIGHTED_AVG_APY_OFFSET..WEIGHTED_AVG_APY_OFFSET + 8].copy_from_slice(&0u64.to_le_bytes());
    ctx_data[INDEX_MARK_PRICE_OFFSET..INDEX_MARK_PRICE_OFFSET + 8].copy_from_slice(&0u64.to_le_bytes());
    ctx_data[LAST_UPDATE_SLOT_OFFSET..LAST_UPDATE_SLOT_OFFSET + 8].copy_from_slice(&0u64.to_le_bytes());
    ctx_data[INDEX_REGIME_OFFSET] = 2; // Normal
    ctx_data[TOTAL_RESTAKED_SOL_OFFSET..TOTAL_RESTAKED_SOL_OFFSET + 8].copy_from_slice(&0u64.to_le_bytes());
    ctx_data[NCN_COUNT_OFFSET..NCN_COUNT_OFFSET + 4].copy_from_slice(&0u32.to_le_bytes());

    // Liquidity + max fill
    ctx_data[LIQUIDITY_OFFSET..LIQUIDITY_OFFSET + 16].copy_from_slice(&data[22..38]);
    ctx_data[MAX_FILL_OFFSET..MAX_FILL_OFFSET + 16].copy_from_slice(&data[38..54]);

    // Aggregated feed account
    ctx_data[AGGREGATED_FEED_OFFSET..AGGREGATED_FEED_OFFSET + 32].copy_from_slice(&data[54..86]);

    // Zero reserved
    ctx_data[240..CTX_SIZE].fill(0);

    let base_spread_val = u32::from_le_bytes(
        data[2..6].try_into().map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let index_vol_val = u32::from_le_bytes(
        data[6..10].try_into().map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let max_spread_val = u32::from_le_bytes(
        data[10..14].try_into().map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let min_ncn = u32::from_le_bytes(
        data[18..22].try_into().map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    msg!(
        "INIT: lp_pda={} mode={} base_spread={} index_vol_spread={} max_spread={} min_ncn={}",
        lp_pda.key,
        data[1],
        base_spread_val,
        index_vol_val,
        max_spread_val,
        min_ncn,
    );

    Ok(())
}

/// Tag 0x00: Execute match — compute index-regime-adjusted execution price
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
    verify_lp_pda_common(lp_pda, ctx_account, INDEX_MATCHER_MAGIC, "INDEX-MATCHER")?;

    // Read pricing parameters
    let ctx_data = ctx_account.try_borrow_data()?;
    let base_spread = u32::from_le_bytes(
        ctx_data[BASE_SPREAD_OFFSET..BASE_SPREAD_OFFSET + 4]
            .try_into().map_err(|_| ProgramError::InvalidAccountData)?,
    );
    let index_vol_spread = u32::from_le_bytes(
        ctx_data[INDEX_VOL_SPREAD_OFFSET..INDEX_VOL_SPREAD_OFFSET + 4]
            .try_into().map_err(|_| ProgramError::InvalidAccountData)?,
    );
    let max_spread = u32::from_le_bytes(
        ctx_data[MAX_SPREAD_OFFSET..MAX_SPREAD_OFFSET + 4]
            .try_into().map_err(|_| ProgramError::InvalidAccountData)?,
    );
    let index_mark = u64::from_le_bytes(
        ctx_data[INDEX_MARK_PRICE_OFFSET..INDEX_MARK_PRICE_OFFSET + 8]
            .try_into().map_err(|_| ProgramError::InvalidAccountData)?,
    );
    let regime = IndexRegime::from_u8(ctx_data[INDEX_REGIME_OFFSET]);
    let ncn_count = u32::from_le_bytes(
        ctx_data[NCN_COUNT_OFFSET..NCN_COUNT_OFFSET + 4]
            .try_into().map_err(|_| ProgramError::InvalidAccountData)?,
    );
    let min_ncn_count = u32::from_le_bytes(
        ctx_data[MIN_NCN_COUNT_OFFSET..MIN_NCN_COUNT_OFFSET + 4]
            .try_into().map_err(|_| ProgramError::InvalidAccountData)?,
    );

    // Reject if index mark price not set
    if index_mark == 0 {
        msg!("INDEX-MATCHER: Index mark price not set -- oracle sync required");
        return Err(IndexMatcherError::OracleNotSynced.into());
    }

    // Check oracle staleness (reject if > 150 slots old)
    let last_update = u64::from_le_bytes(
        ctx_data[LAST_UPDATE_SLOT_OFFSET..LAST_UPDATE_SLOT_OFFSET + 8]
            .try_into().map_err(|_| ProgramError::InvalidAccountData)?,
    );
    let clock = Clock::get()?;
    if clock.slot.saturating_sub(last_update) > 150 {
        msg!("INDEX-MATCHER: Oracle stale -- last update slot {}, current {}", last_update, clock.slot);
        return Err(IndexMatcherError::OracleStale.into());
    }

    // Check minimum NCN count
    if ncn_count < min_ncn_count {
        msg!("INDEX-MATCHER: Insufficient NCN count {} < min {}", ncn_count, min_ncn_count);
        return Err(IndexMatcherError::InsufficientNcnCount.into());
    }

    // Dynamic spread based on index regime
    let regime_multiplier = regime.spread_multiplier();
    let adjusted_index_vol = (index_vol_spread as u64)
        .checked_mul(regime_multiplier)
        .ok_or(IndexMatcherError::ArithmeticOverflow)?
        / 100;

    let total_spread = std::cmp::min(
        (base_spread as u64).saturating_add(adjusted_index_vol),
        max_spread as u64,
    );

    // Compute execution price using shared utility
    let exec_price = compute_exec_price(index_mark, total_spread)?;

    drop(ctx_data);

    // Write execution price to return buffer using shared utility
    let mut ctx_data = ctx_account.try_borrow_mut_data()?;
    write_exec_price(&mut ctx_data, exec_price);

    msg!(
        "MATCH: price={} spread={} regime={:?} index_mark={} ncn_count={}",
        exec_price,
        total_spread,
        regime,
        index_mark,
        ncn_count
    );

    Ok(())
}

/// Tag 0x03: Sync index data — keeper reads AggregatedRestakingFeed and updates matcher context
/// Accounts:
///   [0] Matcher context account (writable)
///   [1] AggregatedRestakingFeed account (read)
/// Data layout:
///   [0]    tag (0x03)
///   [1..9] weighted_avg_apy_bps (u64 LE)
///   [9..17] index_mark_price_e6 (u64 LE)
///   [17]   regime (u8)
///   [18..26] total_restaked_sol (u64 LE)
///   [26..30] ncn_count (u32 LE)
pub fn process_index_sync(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    if data.len() < 30 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let ctx_account = &accounts[0];
    let aggregated_feed = &accounts[1];

    if !ctx_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    // Verify context is initialized
    {
        let ctx_data = ctx_account.try_borrow_data()?;
        if !verify_magic(&ctx_data) {
            return Err(ProgramError::UninitializedAccount);
        }

        // Verify passed account matches stored aggregated feed
        let stored_feed = Pubkey::new_from_array(
            ctx_data[AGGREGATED_FEED_OFFSET..AGGREGATED_FEED_OFFSET + 32]
                .try_into().map_err(|_| ProgramError::InvalidAccountData)?,
        );
        if *aggregated_feed.key != stored_feed {
            msg!("INDEX-MATCHER: AggregatedRestakingFeed mismatch");
            return Err(IndexMatcherError::OracleAccountMismatch.into());
        }
    }

    let weighted_avg_apy = u64::from_le_bytes(
        data[1..9].try_into().map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let index_mark = u64::from_le_bytes(
        data[9..17].try_into().map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let regime = data[17];
    let total_restaked_sol = u64::from_le_bytes(
        data[18..26].try_into().map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let ncn_count = u32::from_le_bytes(
        data[26..30].try_into().map_err(|_| ProgramError::InvalidInstructionData)?,
    );

    // Validate regime
    if regime > 4 {
        return Err(IndexMatcherError::InvalidRegime.into());
    }

    let clock = Clock::get()?;

    let mut ctx_data = ctx_account.try_borrow_mut_data()?;
    let old_apy = u64::from_le_bytes(
        ctx_data[WEIGHTED_AVG_APY_OFFSET..WEIGHTED_AVG_APY_OFFSET + 8]
            .try_into().map_err(|_| ProgramError::InvalidAccountData)?,
    );

    ctx_data[WEIGHTED_AVG_APY_OFFSET..WEIGHTED_AVG_APY_OFFSET + 8].copy_from_slice(&weighted_avg_apy.to_le_bytes());
    ctx_data[INDEX_MARK_PRICE_OFFSET..INDEX_MARK_PRICE_OFFSET + 8].copy_from_slice(&index_mark.to_le_bytes());
    ctx_data[LAST_UPDATE_SLOT_OFFSET..LAST_UPDATE_SLOT_OFFSET + 8].copy_from_slice(&clock.slot.to_le_bytes());
    ctx_data[INDEX_REGIME_OFFSET] = regime;
    ctx_data[TOTAL_RESTAKED_SOL_OFFSET..TOTAL_RESTAKED_SOL_OFFSET + 8].copy_from_slice(&total_restaked_sol.to_le_bytes());
    ctx_data[NCN_COUNT_OFFSET..NCN_COUNT_OFFSET + 4].copy_from_slice(&ncn_count.to_le_bytes());

    msg!(
        "INDEX_SYNC: old_apy={} new_apy={} mark={} regime={} ncn_count={}",
        old_apy,
        weighted_avg_apy,
        index_mark,
        regime,
        ncn_count
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
        index_vol_spread: u32,
        max_spread: u32,
        regime: IndexRegime,
        index_mark: u64,
    ) -> u64 {
        let regime_multiplier = regime.spread_multiplier();
        let adjusted_index_vol = (index_vol_spread as u64) * regime_multiplier / 100;
        let total_spread = std::cmp::min(
            (base_spread as u64).saturating_add(adjusted_index_vol),
            max_spread as u64,
        );
        compute_exec_price(index_mark, total_spread).unwrap()
    }

    // -----------------------------------------------------------------------
    // 1. Normal regime — typical index yield of ~7% (700 bps, mark = 700_000_000)
    // -----------------------------------------------------------------------
    #[test]
    fn test_normal_regime_pricing() {
        let price = calc_exec_price(20, 30, 200, IndexRegime::Normal, 700_000_000);
        // adjusted_index_vol = 30 * 100 / 100 = 30
        // total_spread = min(20 + 30, 200) = 50
        // exec_price   = 700_000_000 * 10050 / 10000 = 703_500_000
        assert_eq!(price, 703_500_000);
    }

    // -----------------------------------------------------------------------
    // 2. Extreme regime — correlated NCN instability
    // -----------------------------------------------------------------------
    #[test]
    fn test_extreme_regime_pricing() {
        let price = calc_exec_price(20, 30, 200, IndexRegime::Extreme, 700_000_000);
        // adjusted_index_vol = 30 * 250 / 100 = 75
        // total_spread = min(20 + 75, 200) = 95
        // exec_price   = 700_000_000 * 10095 / 10000 = 706_650_000
        assert_eq!(price, 706_650_000);
    }

    // -----------------------------------------------------------------------
    // 3. VeryLow regime — stable index
    // -----------------------------------------------------------------------
    #[test]
    fn test_very_low_regime_pricing() {
        let price = calc_exec_price(20, 30, 200, IndexRegime::VeryLow, 700_000_000);
        // adjusted_index_vol = 30 * 50 / 100 = 15
        // total_spread = min(20 + 15, 200) = 35
        // exec_price   = 700_000_000 * 10035 / 10000 = 702_450_000
        assert_eq!(price, 702_450_000);
    }

    // -----------------------------------------------------------------------
    // 4. Spread capping (total_spread exceeds max_spread)
    // -----------------------------------------------------------------------
    #[test]
    fn test_spread_capping() {
        let price = calc_exec_price(100, 200, 150, IndexRegime::Extreme, 700_000_000);
        // adjusted_index_vol = 200 * 250 / 100 = 500
        // total_spread = min(100 + 500, 150) = 150
        // exec_price   = 700_000_000 * 10150 / 10000 = 710_500_000
        assert_eq!(price, 710_500_000);
    }

    // -----------------------------------------------------------------------
    // 5. IndexRegime::from_u8
    // -----------------------------------------------------------------------
    #[test]
    fn test_regime_from_u8() {
        assert_eq!(IndexRegime::from_u8(0), IndexRegime::VeryLow);
        assert_eq!(IndexRegime::from_u8(1), IndexRegime::Low);
        assert_eq!(IndexRegime::from_u8(2), IndexRegime::Normal);
        assert_eq!(IndexRegime::from_u8(3), IndexRegime::High);
        assert_eq!(IndexRegime::from_u8(4), IndexRegime::Extreme);
        // Out-of-range defaults to Normal
        assert_eq!(IndexRegime::from_u8(5), IndexRegime::Normal);
    }

    // -----------------------------------------------------------------------
    // 6. IndexRegime::spread_multiplier
    // -----------------------------------------------------------------------
    #[test]
    fn test_regime_spread_multiplier() {
        assert_eq!(IndexRegime::VeryLow.spread_multiplier(), 50);
        assert_eq!(IndexRegime::Low.spread_multiplier(), 75);
        assert_eq!(IndexRegime::Normal.spread_multiplier(), 100);
        assert_eq!(IndexRegime::High.spread_multiplier(), 150);
        assert_eq!(IndexRegime::Extreme.spread_multiplier(), 250);
    }

    // -----------------------------------------------------------------------
    // 7. Zero spread scenario
    // -----------------------------------------------------------------------
    #[test]
    fn test_zero_spread() {
        let price = calc_exec_price(0, 0, 200, IndexRegime::Normal, 500_000_000);
        // total_spread = 0
        // exec_price = 500_000_000
        assert_eq!(price, 500_000_000);
    }

    // -----------------------------------------------------------------------
    // 8. High regime — moderate volatility
    // -----------------------------------------------------------------------
    #[test]
    fn test_high_regime_pricing() {
        let price = calc_exec_price(20, 40, 200, IndexRegime::High, 900_000_000);
        // adjusted_index_vol = 40 * 150 / 100 = 60
        // total_spread = min(20 + 60, 200) = 80
        // exec_price   = 900_000_000 * 10080 / 10000 = 907_200_000
        assert_eq!(price, 907_200_000);
    }
}
