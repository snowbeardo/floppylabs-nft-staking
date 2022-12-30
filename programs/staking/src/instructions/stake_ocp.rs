use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar;
use anchor_spl::token::{self, Token, TokenAccount};

use crate::{Staking, StakedNft, StakedNftBumps};
use crate::merkle_proof;
use crate::errors::StakingError;
use crate::fees_wallet;

#[derive(Accounts)]
#[instruction(bumps: StakedNftBumps)]
pub struct StakeOcp<'info> {
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
        mut,
        seeds = [
            b"escrow",
            staking.key.as_ref()
        ],
        bump = staking.bumps.escrow
    )]
    /// CHECK: TBD
    pub escrow: AccountInfo<'info>,

    /// The account representing the staked NFT
    /// Doesn't use staking.key as one token can only be staked once
    #[account(
        init,
        payer = staker,
        space = 8 + 2 + 32 + 32 + 32 + 8 + 8 + 8,
        seeds = [
            b"staked_nft",
            mint.key().as_ref()
        ],
        bump
    )]
    pub staked_nft: Box<Account<'info, StakedNft>>,

    /// The owner of the NFT being staked
    #[account(mut)]
    pub staker: Signer<'info>,

    /// The mint of the NFT being staked
    #[account(mut)]
    /// CHECK: TBD
    pub mint: AccountInfo<'info>,

    /// The user account that holds the NFT
    #[account(
        mut, 
        has_one = mint,
        constraint = staker_account.owner == staker.key()
    )]
    pub staker_account: Box<Account<'info, TokenAccount>>,

    /// The account that will hold the token being staked
    /// Doesn't use staking.key as one token can only be staked once
    #[account(
        init,
        payer = staker,
        seeds = [
            b"deposit",
            mint.key().as_ref()
        ],
        bump,
        token::mint = mint,
        token::authority = escrow,
    )]
    pub deposit_account: Box<Account<'info, TokenAccount>>,

    /// The fee paying account
    #[account(mut)]
    /// CHECK: TBD
    pub fee_payer_account: AccountInfo<'info>,

    /// The fee receiving account
    #[account(mut, address = fees_wallet::ID)]
    /// CHECK: TBD
    pub fee_receiver_account: AccountInfo<'info>,

    /// The program for interacting with the token
    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,

    /// Clock account used to know the time
    pub clock: Sysvar<'info, Clock>,

    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,

    /// CHECK: checked in cpi
    pub freeze_authority: UncheckedAccount<'info>,

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

impl<'info> StakeOcp<'info> {
    fn approve_context(&self) -> CpiContext<'_, '_, '_, 'info,
        open_creator_protocol::cpi::accounts::ApproveCtx<'info>> {
        CpiContext::new(
            self.ocp_program.to_account_info(),
        open_creator_protocol::cpi::accounts::ApproveCtx {
            policy: self.ocp_policy.to_account_info(),
            freeze_authority: self.freeze_authority.to_account_info(),
            mint: self.mint.to_account_info(),
            metadata: self.metadata.to_account_info(),
            mint_state: self.ocp_mint_state.to_account_info(),
            from: self.staker.to_account_info(),
            from_account: self.staker_account.to_account_info(),
            to: self.deposit_account.to_account_info(),
            token_program: self.token_program.to_account_info(),
            cmt_program: self.cmt_program.to_account_info(),
            instructions: self.instructions.to_account_info(),
        },
        )
    }

    fn lock_context(&self) -> CpiContext<'_, '_, '_, 'info,
        open_creator_protocol::cpi::accounts::LockCtx<'info>> {
        CpiContext::new(
            self.ocp_program.to_account_info(),
        open_creator_protocol::cpi::accounts::LockCtx {
            policy: self.ocp_policy.to_account_info(),
            mint: self.mint.to_account_info(),
            metadata: self.metadata.to_account_info(),
            mint_state: self.ocp_mint_state.to_account_info(),
            from: self.staker.to_account_info(),
            from_account: self.staker_account.to_account_info(),
            to: self.deposit_account.to_account_info(),
            cmt_program: self.cmt_program.to_account_info(),
            instructions: self.instructions.to_account_info(),
        },
        )
    }
}

pub fn handler(
    ctx: Context<StakeOcp>,
    bumps: StakedNftBumps,
    proof: Vec<[u8; 32]>,
    rarity_multiplier: u64
) -> Result<()> {
    let staking = &mut ctx.accounts.staking;

    // Check that staking started
    if staking.start > ctx.accounts.clock.unix_timestamp {
        return err!(StakingError::TooEarly);
    }

    // Verify the merkle leaf
    let node = solana_program::keccak::hashv(&[
        &[0x00],
        &ctx.accounts.mint.key().to_bytes(),
        &rarity_multiplier.to_le_bytes(),
    ]);
    if !merkle_proof::verify(proof, staking.root, node.0) {
        return err!(StakingError::InvalidProof);
    }

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
    staking.nfts_staked += 1;

    // Update staked_nft data
    let staked_nft = &mut ctx.accounts.staked_nft;
    staked_nft.bumps = bumps;
    staked_nft.key = staking.key;
    staked_nft.mint = ctx.accounts.mint.key();
    staked_nft.staker = ctx.accounts.staker.key();
    staked_nft.staked_at = ctx.accounts.clock.unix_timestamp;
    staked_nft.last_claim = ctx.accounts.clock.unix_timestamp;
    staked_nft.rarity_multiplier = rarity_multiplier;

    // Delegate token
    open_creator_protocol::cpi::approve(ctx.accounts.approve_context())?;

    // Lock OCP (actual staking)
    open_creator_protocol::cpi::lock(ctx.accounts.lock_context())?;

    msg!("Token staked");

    Ok(())
}
