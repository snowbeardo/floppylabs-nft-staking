use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::Staking;

#[derive(Accounts)]
pub struct WithdrawRewards<'info> {
    /// The Staking state account
    #[account(
        seeds = [
            b"staking",
            staking.key.as_ref()
        ],
        bump = staking.bumps.staking,
        has_one = rewards_account,
        has_one = owner,
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

    /// The mint of the rewards token
    pub mint: AccountInfo<'info>,

    /// The account that will holds the rewards token
    #[account(
        mut,
        seeds = [
            b"rewards".as_ref(),
            staking.key.as_ref(),
            mint.key().as_ref()
        ],
        bump = staking.bumps.rewards
    )]
    pub rewards_account: Account<'info, TokenAccount>,

    /// The wallet that will own the staking
    pub owner: Signer<'info>,

    /// The old staking rewards account
    #[account(
        mut,
        has_one = mint,
        constraint = owner_account.owner == owner.key()
    )]
    pub owner_account: Account<'info, TokenAccount>,

    /// The program for interacting with the token.
    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,
}

/// Lets owner withdraw some rewards from the escrow without changing the token
pub fn handler(ctx: Context<WithdrawRewards>, amount: u64) -> ProgramResult {
    let staking = &ctx.accounts.staking;

    // Transfer all tokens left to the owner
    let seeds = &[
        b"escrow".as_ref(),
        staking.key.as_ref(),
        &[staking.bumps.escrow],
    ];
    let signer = &[&seeds[..]];
    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.rewards_account.to_account_info(),
            to: ctx.accounts.owner_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        },
        signer,
    );
    token::transfer(transfer_ctx, amount)?;

    msg!("Rewards withdrawn");

    Ok(())
}
