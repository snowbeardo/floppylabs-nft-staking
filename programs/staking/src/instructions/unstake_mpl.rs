use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar;
use anchor_lang::system_program;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use mpl_token_metadata::{
    state::{TokenStandard, Metadata, TokenMetadataAccount, TokenRecord, TokenDelegateRole},
    instruction::{
        RevokeArgs, UnlockArgs, InstructionBuilder, builders::{RevokeBuilder, UnlockBuilder}}};
use solana_program::program::{invoke, invoke_signed};

use crate::{Staking, StakedNft};
use crate::fees_wallet;

#[derive(Accounts)]
pub struct UnstakeMpl<'info> {
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

    /// The user account that holds the NFT
    #[account(
        mut,
        has_one = mint,
        constraint = staker_account.owner == staker.key()
    )]
    pub staker_account: Box<Account<'info, TokenAccount>>,

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
    pub master_edition: UncheckedAccount<'info>,

    /// CHECK: checked in cpi
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    /// CHECK: checked in cpi
    #[account(mut)]
    pub token_record: UncheckedAccount<'info>,

    /// CHECK: checked in cpi
    #[account(address = mpl_token_metadata::ID)]
    pub token_metadata_program: UncheckedAccount<'info>,

    /// The program for interacting with the token
    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,

    /// CHECK: checked in cpi
    pub authorization_rules_program: UncheckedAccount<'info>,

    /// CHECK: checked in cpi
    pub authorization_rules: UncheckedAccount<'info>,

    /// Clock account used to know the time
    pub clock: Sysvar<'info, Clock>,

    /// CHECK: This is not dangerous because the ID is checked with instructions sysvar
    #[account(address = sysvar::instructions::id())]
    pub instructions: UncheckedAccount<'info>,
}

/// Unstake the staked_nft
pub fn handler(ctx: Context<UnstakeMpl>) -> Result<()> {
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

    // Unlock pNFT (actual unstaking)
    let seeds = &[
        b"staking".as_ref(),
        staking.key.as_ref(),
        &[staking.bumps.staking],
    ];
    let signer = &[&seeds[..]];    

    let mut unlock_builder = UnlockBuilder::new();
    unlock_builder
        .authority(staking.key())
        .token(ctx.accounts.staker_account.key())
        .token_owner(ctx.accounts.staker.key())
        .mint(ctx.accounts.mint.key())
        .metadata(ctx.accounts.metadata.key())
        .edition(ctx.accounts.master_edition.key())
        .authorization_rules(ctx.accounts.authorization_rules.key())
        .authorization_rules_program(ctx.accounts.authorization_rules_program.key())
        .payer(ctx.accounts.staker.key())
        .spl_token_program(ctx.accounts.token_program.key());

    let metadata = Metadata::from_account_info(&ctx.accounts.metadata.to_account_info())?;
    if metadata.token_standard == Some(TokenStandard::ProgrammableNonFungible) {
        unlock_builder.token_record(ctx.accounts.token_record.key());
    }

    let unlock = unlock_builder.build(UnlockArgs::V1 {
            authorization_data: None,
        }).unwrap();

    invoke_signed(&unlock.instruction(),
           &[
               staking.to_account_info(),
               ctx.accounts.staker.to_account_info(),
               ctx.accounts.staker_account.to_account_info(),
               ctx.accounts.mint.to_account_info(),
               ctx.accounts.metadata.to_account_info(),
               ctx.accounts.master_edition.to_account_info(),
               ctx.accounts.token_record.to_account_info(),
               ctx.accounts.staker.to_account_info(),
               ctx.accounts.system_program.to_account_info(),
               ctx.accounts.instructions.to_account_info(),
               ctx.accounts.token_program.to_account_info(),
               ctx.accounts.authorization_rules_program.to_account_info(),
               ctx.accounts.authorization_rules.to_account_info()
           ], signer)?;

    // Revoke pNFT Stake delegate
    let mut revoke_builder = RevokeBuilder::new();
    revoke_builder
        .delegate(staking.key())
        .mint(ctx.accounts.mint.key())
        .metadata(ctx.accounts.metadata.key())
        .master_edition(ctx.accounts.master_edition.key())
        .token(ctx.accounts.staker_account.key())
        .token_record(ctx.accounts.token_record.key())    
        .authorization_rules(ctx.accounts.authorization_rules.key())
        .authorization_rules_program(ctx.accounts.authorization_rules_program.key())
        .payer(ctx.accounts.staker.key())
        .authority(ctx.accounts.staker.key())
        .spl_token_program(ctx.accounts.token_program.key());    

    let revoke_args = match metadata.token_standard {
        Some(TokenStandard::ProgrammableNonFungible) => {
            let token_record:TokenRecord = TokenRecord::from_account_info(&ctx.accounts.token_record.to_account_info())?;
            match token_record.delegate_role {
                // Staking
                Some(TokenDelegateRole::Staking) => RevokeArgs::StakingV1,
                // Migration
                Some(TokenDelegateRole::Migration) => RevokeArgs::MigrationV1,
                // Default to standard
                _ => RevokeArgs::StandardV1
            }
        },
        _ => RevokeArgs::StandardV1
    };

    let revoke = revoke_builder.build(revoke_args).unwrap();

    invoke(&revoke.instruction(),
           &[
               ctx.accounts.token_metadata_program.to_account_info(),
               staking.to_account_info(),
               ctx.accounts.metadata.to_account_info(),
               ctx.accounts.master_edition.to_account_info(),
               ctx.accounts.token_record.to_account_info(),
               ctx.accounts.mint.to_account_info(),
               ctx.accounts.staker_account.to_account_info(),
               ctx.accounts.staker.to_account_info(),
               ctx.accounts.staker.to_account_info(),
               ctx.accounts.system_program.to_account_info(),
               ctx.accounts.instructions.to_account_info(),
               ctx.accounts.token_program.to_account_info(),
               ctx.accounts.authorization_rules_program.to_account_info(),
               ctx.accounts.authorization_rules.to_account_info()
           ])?;

    // Claim rewards
    let rarity_multiplier = staked_nft.rarity_multiplier;
    let seconds_elapsed = ctx.accounts.clock.unix_timestamp - staked_nft.last_claim;
    let daily_rewards_adjusted = staking.daily_rewards * rarity_multiplier / 100;
    let rewards_amount = daily_rewards_adjusted * (seconds_elapsed as u64) / 86400;

    staked_nft.last_claim = ctx.accounts.clock.unix_timestamp;

    let seeds_claim = &[
        b"escrow".as_ref(),
        staking.key.as_ref(),
        &[staking.bumps.escrow],
    ];
    let signer_claim = &[&seeds_claim[..]];

    let context = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.rewards_account.to_account_info(),
            to: ctx.accounts.staker_rewards_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        },
        signer_claim,
    );

    if ctx.accounts.rewards_account.amount < rewards_amount {
        msg!("Rewards not claimed, not enough funds");
    } else {
        token::transfer(context, rewards_amount)?;
    }

    msg!("Unstaked token");

    Ok(())
}
