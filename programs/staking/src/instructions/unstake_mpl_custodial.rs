use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount};
use anchor_lang::system_program;

use mpl_token_metadata::{
    instruction::{
        TransferArgs, InstructionBuilder, builders::{TransferBuilder}}};

use solana_program::program::{invoke_signed};
use crate::fees_wallet;
use crate::{StakedNft, Staking};

#[derive(Accounts)]
pub struct UnstakeMplCustodial<'info> {
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

    /// The account that will hold the unstaked NFT
    #[account(
        mut,
        has_one = mint,
        constraint = staker_account.owner == staker.key()
    )]
    pub staker_account: Box<Account<'info, TokenAccount>>,

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

    /// CHECK: checked in cpi
    pub ata_program: UncheckedAccount<'info>,

    /// CHECK: This is not dangerous because the ID is checked with instructions sysvar
    #[account(address = sysvar::instructions::id())]
    pub instructions: UncheckedAccount<'info>,
}

/// Unstake the staked_nft
pub fn handler(ctx: Context<UnstakeMplCustodial>) -> Result<()> {
    let staking = &mut ctx.accounts.staking;

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

    // Return the staked_nft NFT using MPL Token Metadata program    
    let mut transfer_builder = TransferBuilder::new();
    transfer_builder
        .token(ctx.accounts.deposit_account.key())
        .token_owner(ctx.accounts.escrow.key())
        .destination(ctx.accounts.staker_account.key())
        .destination_owner(ctx.accounts.staker.key())
        .mint(ctx.accounts.mint.key())
        .metadata(ctx.accounts.metadata.key())
        .edition(ctx.accounts.master_edition.key())        
        .authority(ctx.accounts.escrow.key())
        .payer(ctx.accounts.staker.key())
        .spl_token_program(ctx.accounts.token_program.key())
        .spl_ata_program(ctx.accounts.ata_program.key())
        .authorization_rules(ctx.accounts.authorization_rules.key())
        .authorization_rules_program(ctx.accounts.authorization_rules_program.key());
    
    let transfer = transfer_builder.build(TransferArgs::V1 {
            amount: 1,
            authorization_data: None,
        }).unwrap();

    invoke_signed(&transfer.instruction(),
           &[
               ctx.accounts.deposit_account.to_account_info(),
               ctx.accounts.escrow.to_account_info(),
               ctx.accounts.staker_account.to_account_info(),
               ctx.accounts.staker.to_account_info(),
               ctx.accounts.mint.to_account_info(),
               ctx.accounts.metadata.to_account_info(),
               ctx.accounts.master_edition.to_account_info(),
               ctx.accounts.token_metadata_program.to_account_info(),
               ctx.accounts.token_metadata_program.to_account_info(),
               ctx.accounts.escrow.to_account_info(),
               ctx.accounts.staker.to_account_info(),
               ctx.accounts.system_program.to_account_info(),
               ctx.accounts.instructions.to_account_info(),
               ctx.accounts.token_program.to_account_info(),
               ctx.accounts.ata_program.to_account_info(),
               ctx.accounts.authorization_rules_program.to_account_info(),
               ctx.accounts.authorization_rules.to_account_info()
           ], signer)?;

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
