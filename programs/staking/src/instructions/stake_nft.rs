use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{Staking, StakedNft, StakedNftBumps};
use crate::merkle_proof;
use crate::errors::*;
use crate::fees_wallet;

const FEES_LAMPORTS: u64 = 10_000_000;

#[derive(Accounts)]
#[instruction(bumps: StakedNftBumps)]
pub struct StakeNft<'info> {
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
        mut,
        seeds = [
            b"escrow",
            staking.key.as_ref()
        ],
        bump = staking.bumps.escrow
    )]
    pub escrow: AccountInfo<'info>,

    /// The account representing the staked NFT
    /// Doesn't use staking.key as one token can only be staked once
    #[account(
        init,
        payer = staker,
        seeds = [
            b"staked_nft",
            mint.key().as_ref()
        ],
        bump = bumps.staked_nft,
    )]
    pub staked_nft: Box<Account<'info, StakedNft>>,

    /// The owner of the NFT being staked
    #[account(mut)]
    pub staker: Signer<'info>,

    /// The mint of the NFT being staked
    #[account(mut)]
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
        bump = bumps.deposit,
        token::mint = mint,
        token::authority = escrow,
    )]
    pub deposit_account: Box<Account<'info, TokenAccount>>,

    /// The fee paying account
    #[account(mut)]
    pub fee_payer_account: AccountInfo<'info>,

    /// The fee receiving account
    #[account(mut, address = fees_wallet::ID)]
    pub fee_receiver_account: AccountInfo<'info>,

    /// The program for interacting with the token
    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,

    /// Clock account used to know the time
    pub clock: Sysvar<'info, Clock>,

    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

impl<'info> StakeNft<'info> {
    fn transfer_context(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            Transfer {
                from: self.staker_account.to_account_info(),
                to: self.deposit_account.to_account_info(),
                authority: self.staker.to_account_info(),
            },
        )
    }
}

pub fn handler(
    ctx: Context<StakeNft>,
    bumps: StakedNftBumps,
    proof: Vec<[u8; 32]>,
    rarity: u64
) -> ProgramResult {
    let staking = &mut ctx.accounts.staking;

    // Check that staking started
    if staking.start > ctx.accounts.clock.unix_timestamp {
        return Err(ErrorCode::TooEarly.into());
    }

    // Verify the merkle leaf
    let node = solana_program::keccak::hashv(&[
        &[0x00],
        &ctx.accounts.mint.key().to_bytes(),
        &rarity.to_le_bytes(),
    ]);
    if !merkle_proof::verify(proof, staking.root, node.0) {
        return Err(ErrorCode::InvalidProof.into());
    }

    // Charge fees
    let fee_payer_account = &mut ctx.accounts.fee_payer_account;
    let fee_receiver_account = &mut ctx.accounts.fee_receiver_account;
    **fee_payer_account.try_borrow_mut_lamports()? -= FEES_LAMPORTS;
    **fee_receiver_account.try_borrow_mut_lamports()? += FEES_LAMPORTS;

    staking.nfts_staked += 1;

    let staked_nft = &mut ctx.accounts.staked_nft;
    staked_nft.bumps = bumps;
    staked_nft.mint = ctx.accounts.mint.key();
    staked_nft.staker = ctx.accounts.staker.key();
    staked_nft.last_claim = ctx.accounts.clock.unix_timestamp;
    staked_nft.rarity = rarity;

    token::transfer(ctx.accounts.transfer_context(), 1)?;

    msg!("Token staked");

    Ok(())
}
