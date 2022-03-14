use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

use crate::{Staking, InitializeStakingBumps};

#[derive(Accounts)]
#[instruction(bumps: InitializeStakingBumps)]
pub struct InitializeStaking<'info> {
    /// The unique identifier.
    /// Allows reusing this program for other projects without redeploying
    pub staking_key: AccountInfo<'info>,

    /// The Staking state account
    #[account(
        init,
        payer = owner,
        seeds = [
            b"staking",
            staking_key.key().as_ref()
        ],
        bump = bumps.staking,
    )]
    pub staking: Account<'info, Staking>,

    /// The account owner of staking tokens, staking rewards and community funds
    #[account(
        seeds = [
            b"escrow",
            staking_key.key().as_ref()
        ],
        bump = bumps.escrow,
    )]
    pub escrow: AccountInfo<'info>,

    /// The mint of the staking reward token
    pub mint: AccountInfo<'info>,

    /// The account that will hold the rewards token
    #[account(
        init,
        payer = owner,
        seeds = [
            b"rewards",
            staking_key.key().as_ref(),
            mint.key().as_ref()
        ],
        bump = bumps.rewards,
        token::mint = mint,
        token::authority = escrow
    )]
    pub rewards_account: Account<'info, TokenAccount>,

    /// The wallet owning the staking program
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The program for interacting with the token.
    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,

    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

/// Initializes the staking parameters
pub fn handler(
    ctx: Context<InitializeStaking>,
    bumps: InitializeStakingBumps,
    daily_rewards: u64,
    start: i64,
    root: [u8; 32],
) -> ProgramResult {
    msg!("Init Staking");

    let staking = &mut ctx.accounts.staking;
    staking.key = ctx.accounts.staking_key.key();
    staking.owner = ctx.accounts.owner.key();
    staking.bumps = bumps;
    staking.escrow = ctx.accounts.escrow.key();
    staking.mint = ctx.accounts.mint.key();
    staking.rewards_account = ctx.accounts.rewards_account.key();
    staking.daily_rewards = daily_rewards;
    staking.start = start;
    staking.root = root;

    msg!("Staking initialized");

    Ok(())
}
