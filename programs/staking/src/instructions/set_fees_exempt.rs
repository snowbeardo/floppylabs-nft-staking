use anchor_lang::prelude::*;

use crate::{Staking};
use crate::fl_auth_wallet;

#[derive(Accounts)]
pub struct SetFeesExempt<'info> {
    /// The Staking state account
    #[account(mut)]
    pub staking: Account<'info, Staking>,

    /// FloppyLabs auth wallet, authorized to set any project's fees_exempt property
    #[account(address = fl_auth_wallet::ID)]
    pub auth: Signer<'info>,
}

/// Sets the staking parameters
pub fn handler(
    ctx: Context<SetFeesExempt>,
    fees_exempt: bool,
) -> ProgramResult {

    let staking = &mut ctx.accounts.staking;
    staking.fees_exempt = fees_exempt;

    msg!("Fees exempt set to {}", fees_exempt);

    Ok(())
}
