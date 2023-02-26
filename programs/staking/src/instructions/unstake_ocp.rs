use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar;
use anchor_lang::system_program;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::fees_wallet;
use crate::{StakedNft, Staking};

#[derive(Accounts)]
pub struct UnstakeOcp<'info> {
    /// The Staking state account
    #[account(
        mut,
        seeds = [
            b"staking",
            staking.key.as_ref()
        ],
        bump = staking.bumps.staking
    )]
    pub staking: Box<Account<'info, Staking>>,

    /// The account holding staking tokens, staking rewards and community funds
    #[account(
        seeds = [
            b"escrow",
            staking.key.as_ref()
        ],
        bump = staking.bumps.escrow
    )]
    /// CHECK: TBD
    pub escrow: AccountInfo<'info>,

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
    pub rewards_account: Box<Account<'info, TokenAccount>>,

    /// The account representing the staked NFT
    #[account(
        mut,
        close = staker,
        has_one = mint,
        has_one = staker
    )]
    pub staked_nft: Box<Account<'info, StakedNft>>,

    /// The owner of the staked NFT
    #[account(mut)]
    pub staker: Signer<'info>,

    /// The mint of the staked NFT
    #[account(mut)]
    /// CHECK: TBD
    pub mint: AccountInfo<'info>,

    /// The mint of the reward token
    #[account(mut)]
    /// CHECK: TBD
    pub rewards_mint: AccountInfo<'info>,

    /// The user account receiving rewards
    #[account(
        mut,
        constraint =
            staker_rewards_account.owner == staker.key() &&
            staker_rewards_account.mint == rewards_mint.key()
    )]
    pub staker_rewards_account: Box<Account<'info, TokenAccount>>,

    /// The fee receiving account
    #[account(mut, address = fees_wallet::ID)]
    /// CHECK: TBD
    pub fee_receiver_account: AccountInfo<'info>,

    pub system_program: Program<'info, System>,

    /// CHECK: checked in cpi
    pub ocp_policy: UncheckedAccount<'info>,

    /// CHECK: checked in cpi
    pub metadata: UncheckedAccount<'info>,

    /// CHECK: checked in cpi
    #[account(mut)]
    pub ocp_mint_state: UncheckedAccount<'info>,

    /// CHECK: checked in cpi
    #[account(address = open_creator_protocol::id())]
    pub ocp_program: UncheckedAccount<'info>,

    /// CHECK: checked in cpi
    pub cmt_program: UncheckedAccount<'info>,

    /// Clock account used to know the time
    pub clock: Sysvar<'info, Clock>,

    /// The program for interacting with the token
    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,

    /// CHECK: This is not dangerous because the ID is checked with instructions sysvar
    #[account(address = sysvar::instructions::id())]
    pub instructions: UncheckedAccount<'info>,
}

/// Unstake the staked_nft
pub fn handler(ctx: Context<UnstakeOcp>) -> Result<()> {
    let staking = &mut ctx.accounts.staking;
    let staked_nft = &mut ctx.accounts.staked_nft;

    // Charge fees if the project is not fees exempt
    if !staking.fees_exempt {
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.staker.to_account_info(),
                to: ctx.accounts.fee_receiver_account.clone(),
            });
        system_program::transfer(cpi_context, fees_wallet::FEES_LAMPORTS)?;
    }

    // Update staking data
    staking.nfts_staked -= 1;

    let seeds = &[
        b"escrow".as_ref(),
        staking.key.as_ref(),
        &[staking.bumps.escrow],
    ];
    let signer = &[&seeds[..]];

    // Unlock OCP (actual unstaking)
    //open_creator_protocol::cpi::unlock(ctx.accounts.unlock_context(signer))?;
    let unlock_context:CpiContext<open_creator_protocol::cpi::accounts::UnlockCtx> =
        CpiContext::new_with_signer(
            ctx.accounts.ocp_program.to_account_info(),
        open_creator_protocol::cpi::accounts::UnlockCtx {
            policy: ctx.accounts.ocp_policy.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            metadata: ctx.accounts.metadata.to_account_info(),
            mint_state: ctx.accounts.ocp_mint_state.to_account_info(),
            from: ctx.accounts.escrow.to_account_info(),
            cmt_program: ctx.accounts.cmt_program.to_account_info(),
            instructions: ctx.accounts.instructions.to_account_info(),
        },
            signer,
        );

    open_creator_protocol::cpi::unlock(unlock_context)?;

    // Claim rewards
    let rarity_multiplier = staked_nft.rarity_multiplier;
    let seconds_elapsed = ctx.accounts.clock.unix_timestamp - staked_nft.last_claim;
    let daily_rewards_adjusted = staking.daily_rewards * rarity_multiplier / 100;
    let rewards_amount = daily_rewards_adjusted * (seconds_elapsed as u64) / 86400;

    staked_nft.last_claim = ctx.accounts.clock.unix_timestamp;

    let context = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.rewards_account.to_account_info(),
            to: ctx.accounts.staker_rewards_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        },
        signer,
    );

    if ctx.accounts.rewards_account.amount < rewards_amount {
        msg!("Rewards not claimed, not enough funds");
    } else {
        token::transfer(context, rewards_amount)?;
    }

    msg!("Unstaked token");

    Ok(())
}
