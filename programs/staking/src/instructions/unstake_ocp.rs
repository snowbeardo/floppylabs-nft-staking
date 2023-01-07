use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar;

use crate::fees_wallet;
use crate::errors::StakingError;
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

    /// The fee paying account
    #[account(mut)]
    /// CHECK: TBD
    pub fee_payer_account: AccountInfo<'info>,

    /// The fee receiving account
    #[account(mut, address = fees_wallet::ID)]
    /// CHECK: TBD
    pub fee_receiver_account: AccountInfo<'info>,    

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

    /// CHECK: This is not dangerous because the ID is checked with instructions sysvar
    #[account(address = sysvar::instructions::id())]
    pub instructions: UncheckedAccount<'info>,
}

/// Unstake the staked_nft
pub fn handler(ctx: Context<UnstakeOcp>) -> Result<()> {
    let staking = &mut ctx.accounts.staking;

    // Charge fees if the project is not fees exempt
    if !staking.fees_exempt {
        let fee_payer_account = &mut ctx.accounts.fee_payer_account;
        let fee_payer_account_lamports = fee_payer_account.lamports();
        **fee_payer_account.lamports.borrow_mut() = fee_payer_account_lamports
            .checked_sub(fees_wallet::FEES_LAMPORTS)
            .ok_or(StakingError::InvalidFee)?;

        // Send fees to receiver account
        let fee_receiver_account = &mut ctx.accounts.fee_receiver_account;
        let fee_receiver_account_lamports = fee_receiver_account.lamports();
        **fee_receiver_account.lamports.borrow_mut() = fee_receiver_account_lamports
            .checked_add(fees_wallet::FEES_LAMPORTS)
            .ok_or(StakingError::InvalidFee)?;
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

    msg!("Unstaked token");

    Ok(())
}
