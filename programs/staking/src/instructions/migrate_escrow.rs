use anchor_lang::prelude::*;
use crate::fl_auth_wallet;

/// The global state of the program
#[account]
#[derive(Default)]
pub struct Escrow {
    /// The auth key. Not used, just adding data to let MPL Auth Rules work
    pub key: Pubkey,
}

#[derive(Accounts)]
pub struct MigrateEscrow<'info> {
    /// CHECK: TBD
    pub staking_key: AccountInfo<'info>,

    /// The Staking state account
    #[account(
        init,
        payer = auth,
        space = 8 + 32,
        seeds = [
            b"escrow",
            staking_key.key().as_ref()
        ],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    /// FloppyLabs auth wallet, authorized to migrate project accounts
    //#[account(mut, address = fl_auth_wallet::ID)]
    #[account(mut)]
    pub auth: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Sets the staking parameters
pub fn handler(
    ctx: Context<MigrateEscrow>,
) -> Result<()> {

    let escrow = &mut ctx.accounts.escrow;
    escrow.key = ctx.accounts.auth.key();
    msg!("Escrow migration complete");

    Ok(())
}