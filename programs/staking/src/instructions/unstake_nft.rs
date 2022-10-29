use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount, Transfer};

use crate::fees_wallet;
use crate::errors::*;
use crate::{StakedNft, Staking};

#[derive(Accounts)]
pub struct UnstakeNft<'info> {
    /// The Staking state account
    #[account(
        mut,
        seeds = [
            b"staking",
            staking.key.as_ref()
        ],
        bump = staking.bumps.staking
    )]
    pub staking: Account<'info, Staking>,

    /// The account holding staking tokens, staking rewards and community funds
    #[account(
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
        close = staker,
        has_one = mint,
        has_one = staker
    )]
    pub staked_nft: Account<'info, StakedNft>,

    /// The owner of the staked NFT
    #[account(mut)]
    pub staker: Signer<'info>,

    /// The mint of the staked NFT
    #[account(mut)]
    pub mint: AccountInfo<'info>,

    /// The account that will hold the unstaked NFT
    #[account(
        mut,
        has_one = mint,
        constraint = staker_account.owner == staker.key()
    )]
    pub staker_account: Account<'info, TokenAccount>,

    /// The account that holds the staked NFT
    #[account(
        mut,
        seeds = [
            b"deposit".as_ref(),
            mint.key().as_ref()
        ],
        bump = staked_nft.bumps.deposit,
        has_one = mint
    )]
    pub deposit_account: Account<'info, TokenAccount>,

    /// The fee paying account
    #[account(mut)]
    pub fee_payer_account: AccountInfo<'info>,

    /// The fee receiving account
    #[account(mut, address = fees_wallet::ID)]
    pub fee_receiver_account: AccountInfo<'info>,

    /// The program for interacting with the token
    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,
}

/// Unstake the staked_nft
pub fn handler(ctx: Context<UnstakeNft>) -> ProgramResult {
    let staking = &mut ctx.accounts.staking;

    // Charge fees if the project is not fees exempt
    if !staking.fees_exempt {
        let fee_payer_account = &mut ctx.accounts.fee_payer_account;
        let fee_payer_account_lamports = fee_payer_account.lamports();
        **fee_payer_account.lamports.borrow_mut() = fee_payer_account_lamports
            .checked_sub(fees_wallet::FEES_LAMPORTS)
            .ok_or(ErrorCode::InvalidFee)?;

        // Send fees to receiver account
        let fee_receiver_account = &mut ctx.accounts.fee_receiver_account;
        let fee_receiver_account_lamports = fee_receiver_account.lamports();
        **fee_receiver_account.lamports.borrow_mut() = fee_receiver_account_lamports
            .checked_add(fees_wallet::FEES_LAMPORTS)
            .ok_or(ErrorCode::InvalidFee)?;
    }

    // Update staking data
    staking.nfts_staked -= 1;

    let seeds = &[
        b"escrow".as_ref(),
        staking.key.as_ref(),
        &[staking.bumps.escrow],
    ];
    let signer = &[&seeds[..]];

    // Return the staked_nft NFT
    let context = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.deposit_account.to_account_info(),
            to: ctx.accounts.staker_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        },
        signer,
    );
    token::transfer(context, 1)?;

    // Close the staking token account
    let close_account_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.deposit_account.to_account_info(),
            destination: ctx.accounts.staker.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        },
        signer,
    );
    token::close_account(close_account_ctx)?;

    msg!("Unstaked token");

    Ok(())
}
