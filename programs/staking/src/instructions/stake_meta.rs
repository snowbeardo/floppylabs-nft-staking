use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar;
use anchor_lang::system_program;
use anchor_spl::token::{self, Token, TokenAccount};

use mpl_token_metadata::{
    state::{TokenStandard, Metadata, TokenMetadataAccount},
    instruction::{
        DelegateArgs, LockArgs, InstructionBuilder, builders::{DelegateBuilder, LockBuilder}}};
use solana_program::program::{invoke, invoke_signed};

use crate::{Staking, StakedNft, StakedNftBumps};
use crate::merkle_proof;
use crate::errors::StakingError;
use crate::fees_wallet;

#[derive(Accounts)]
#[instruction(bumps: StakedNftBumps)]
pub struct StakeMeta<'info> {
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

    /// The fee receiving account
    #[account(mut, address = fees_wallet::ID)]
    /// CHECK: TBD
    pub fee_receiver_account: AccountInfo<'info>,    

    /// Clock account used to know the time
    pub clock: Sysvar<'info, Clock>,

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

    /// CHECK: This is not dangerous because the ID is checked with instructions sysvar
    #[account(address = sysvar::instructions::id())]
    pub instructions: UncheckedAccount<'info>,
}

pub fn handler(
    ctx: Context<StakeMeta>,
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
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.staker.to_account_info(),
                to: ctx.accounts.fee_receiver_account.clone(),
            });
        system_program::transfer(cpi_context, fees_wallet::FEES_LAMPORTS)?;
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

    // Obtain pNFT Stake delegate
    let mut delegate_builder = DelegateBuilder::new();
    delegate_builder
        .delegate(ctx.accounts.escrow.key())
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

    let metadata = Metadata::from_account_info(&ctx.accounts.metadata.to_account_info())?;

    let delegate_args = match metadata.token_standard {
        Some(TokenStandard::ProgrammableNonFungible) => DelegateArgs::StakingV1 {
            amount: 1,
            authorization_data: None,
        },
        Some(_) => DelegateArgs::StandardV1 {
            amount: 1,
        },
        None => { return err!(StakingError::CouldNotDetermineTokenStandard) }
    };

    let delegate = delegate_builder.build(delegate_args).unwrap();

    invoke(&delegate.instruction(),
           &[
               ctx.accounts.token_metadata_program.to_account_info(),
               ctx.accounts.escrow.to_account_info(),
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

    // Lock pNFT (actual staking)
    let seeds = &[
        b"escrow".as_ref(),
        staking.key.as_ref(),
        &[staking.bumps.escrow],
    ];
    let signer = &[&seeds[..]];

    let mut lock_builder = LockBuilder::new();
    lock_builder
        .authority(ctx.accounts.escrow.key())
        .token(ctx.accounts.staker_account.key())
        .token_owner(ctx.accounts.staker.key())
        .mint(ctx.accounts.mint.key())
        .metadata(ctx.accounts.metadata.key())
        .edition(ctx.accounts.master_edition.key())
        .authorization_rules(ctx.accounts.authorization_rules.key())
        .authorization_rules_program(ctx.accounts.authorization_rules_program.key())
        .payer(ctx.accounts.staker.key())
        .spl_token_program(ctx.accounts.token_program.key());

    if metadata.token_standard == Some(TokenStandard::ProgrammableNonFungible) {
        lock_builder.token_record(ctx.accounts.token_record.key());
    }

    let lock = lock_builder.build(LockArgs::V1 {
            authorization_data: None,
        }).unwrap();

    invoke_signed(&lock.instruction(),
           &[
               ctx.accounts.escrow.to_account_info(),
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

        msg!("Token staked");

    Ok(())
}
