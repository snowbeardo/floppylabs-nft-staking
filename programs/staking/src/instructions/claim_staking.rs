use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{Staking, StakedNft};

#[derive(Accounts)]
pub struct ClaimStaking<'info> {
    /// The staking state
    #[account(
        seeds = [
            b"staking",
            staking.key.as_ref()
        ],
        bump = staking.bumps.staking,
        has_one = mint,
        has_one = rewards_account
    )]
    pub staking: Account<'info, Staking>,

    /// The account holding staking tokens, staking rewards and community funds
    #[account(
        mut,
        seeds = [
            b"escrow",
            staking.key.as_ref()
        ],
        bump = staking.bumps.escrow
    )]
    pub escrow: AccountInfo<'info>,

    /// The account representing the staked NFT
    #[account(
        mut,
        seeds = [
            b"staked_nft".as_ref(),
            staked_nft.mint.as_ref()
        ],
        bump = staked_nft.bumps.staked_nft,
        has_one = staker
    )]
    pub staked_nft: Account<'info, StakedNft>,

    /// The owner of the staked token
    #[account(mut)]
    pub staker: Signer<'info>,

    /// The mint of the reward token
    #[account(mut)]
    pub mint: AccountInfo<'info>,

    /// The user account receiving rewards
    #[account(
        mut, 
        constraint = 
            staker_account.owner == staker.key() &&
            staker_account.mint == mint.key()
    )]
    pub staker_account: Account<'info, TokenAccount>,

    /// The account that will hold the rewards token
    #[account(
        mut,
        seeds = [
            b"rewards",
            staking.key.as_ref(),
            staking.mint.as_ref()
        ],
        bump = staking.bumps.rewards,
    )]
    pub rewards_account: Account<'info, TokenAccount>,

    /// The program for interacting with the token
    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,

    /// Clock account used to know the time
    pub clock: Sysvar<'info, Clock>,

    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

/// Claims rewards for a staked token
pub fn handler(ctx: Context<ClaimStaking>) -> ProgramResult {
    let staking = &ctx.accounts.staking;
    let staked_nft = &mut ctx.accounts.staked_nft;

    let rarity_multiplier = staked_nft.rarity_multiplier;
    let seconds_elapsed = ctx.accounts.clock.unix_timestamp - staked_nft.last_claim;
    let daily_rewards_adjusted = staking.daily_rewards * rarity_multiplier;
    let rewards_amount = daily_rewards_adjusted * (seconds_elapsed as u64) / 86400;
    
    staked_nft.last_claim = ctx.accounts.clock.unix_timestamp;

    let seeds = &[
        b"escrow".as_ref(),
        staking.key.as_ref(),
        &[staking.bumps.escrow],
    ];
    let signer = &[&seeds[..]];

    let context = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.rewards_account.to_account_info(),
            to: ctx.accounts.staker_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        },
        signer,
    );
    token::transfer(context, rewards_amount)?;

    msg!("Rewards claimed");

    Ok(())
}
