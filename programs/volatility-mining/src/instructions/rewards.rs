use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::VolatilityMiningError;

pub fn claim_rewards(
    ctx: Context<ClaimRewards>,
) -> Result<()> {
    let lp_stake = &mut ctx.accounts.lp_stake;
    let epoch_snapshot = &mut ctx.accounts.epoch_snapshot;

    require!(lp_stake.is_active, VolatilityMiningError::LpNotActive);
    require!(epoch_snapshot.is_finalized, VolatilityMiningError::EpochNotComplete);
    require!(epoch_snapshot.total_reward_weight > 0, VolatilityMiningError::NoRewardsToClaim);
    require!(lp_stake.current_epoch_weight > 0, VolatilityMiningError::NoRewardsToClaim);

    // Calculate LP's share: (lp_weight * total_rewards) / total_weight
    let lp_reward = (lp_stake.current_epoch_weight as u128)
        .checked_mul(epoch_snapshot.total_rewards as u128)
        .ok_or(VolatilityMiningError::MathOverflow)?
        .checked_div(epoch_snapshot.total_reward_weight)
        .ok_or(VolatilityMiningError::MathOverflow)? as u64;

    require!(lp_reward > 0, VolatilityMiningError::NoRewardsToClaim);

    // Transfer tokens from vault to owner
    let config = &ctx.accounts.mining_config;
    let seeds = &[b"mining_config".as_ref(), &[config.bump]];
    let signer_seeds = &[&seeds[..]];

    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.reward_vault.to_account_info(),
            to: ctx.accounts.owner_token_account.to_account_info(),
            authority: ctx.accounts.mining_config.to_account_info(),
        },
        signer_seeds,
    );
    token::transfer(transfer_ctx, lp_reward)?;

    // Update state
    lp_stake.last_claim_epoch = epoch_snapshot.epoch;
    lp_stake.total_claimed = lp_stake.total_claimed
        .checked_add(lp_reward)
        .ok_or(VolatilityMiningError::MathOverflow)?;
    lp_stake.current_epoch_weight = 0;

    epoch_snapshot.total_claimed = epoch_snapshot.total_claimed
        .checked_add(lp_reward)
        .ok_or(VolatilityMiningError::MathOverflow)?;

    Ok(())
}

pub fn fund_rewards(
    ctx: Context<FundRewards>,
    amount: u64,
) -> Result<()> {
    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.funder_token_account.to_account_info(),
            to: ctx.accounts.reward_vault.to_account_info(),
            authority: ctx.accounts.funder.to_account_info(),
        },
    );
    token::transfer(transfer_ctx, amount)?;

    Ok(())
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(
        constraint = owner.key() == lp_stake.owner @ VolatilityMiningError::Unauthorized
    )]
    pub owner: Signer<'info>,

    #[account(
        constraint = mining_config.is_active @ VolatilityMiningError::MiningNotActive
    )]
    pub mining_config: Account<'info, MiningConfig>,

    #[account(mut)]
    pub lp_stake: Account<'info, LpStake>,

    #[account(mut)]
    pub epoch_snapshot: Account<'info, EpochSnapshot>,

    #[account(
        mut,
        constraint = reward_vault.key() == mining_config.reward_vault
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FundRewards<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(
        mut,
        constraint = reward_vault.key() == mining_config.reward_vault
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub funder_token_account: Account<'info, TokenAccount>,

    pub mining_config: Account<'info, MiningConfig>,

    pub token_program: Program<'info, Token>,
}
