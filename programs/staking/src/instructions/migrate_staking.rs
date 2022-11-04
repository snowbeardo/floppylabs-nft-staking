use anchor_lang::prelude::*;

use crate::{InitializeStakingBumps};
use crate::fl_auth_wallet;

/// The global state of the program
#[account]
#[derive(Default)]
pub struct Staking {
    /// The identifier
    pub key: Pubkey,

    /// The owner of the program
    pub owner: Pubkey,

    /// The bump used to generate PDAs
    pub bumps: InitializeStakingBumps,

    /// The PDA owning the community fund
    pub escrow: Pubkey,

    /// The mint of the token distributed to stakers
    pub mint: Pubkey,

    /// The account owning tokens distributed to stakers
    pub rewards_account: Pubkey,

    /// The total NFTs currently staked.
    pub nfts_staked: u64,

    /// The amount of tokens rewarded daily per NFT
    pub daily_rewards: u64,

    /// The time the staking starts (in seconds since 1970)
    pub start: i64,

    /// The root of the merkle tree used to know if a token is part of the collection
    pub root: [u8; 32],
}

#[derive(Accounts)]
pub struct MigrateStaking<'info> {
    /// The Staking state account
    #[account(
        mut,
        realloc = 8 + 32 + 32 + 3 + 32 + 32 + 32 + 8 + 8 + 8 + 32 + 1,
        realloc::payer = auth,
        realloc::zero = false,
    )]
    pub staking: Account<'info, Staking>,

    /// FloppyLabs auth wallet, authorized to migrate project accounts
    #[account(mut, address = fl_auth_wallet::ID)]
    pub auth: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Sets the staking parameters
pub fn handler(
    ctx: Context<MigrateStaking>,
) -> Result<()> {

    msg!("Migration complete");

    Ok(())
}
