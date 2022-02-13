use anchor_lang::prelude::*;

use crate::{errors::ErrorCode, Staking};

#[derive(Accounts)]
pub struct SetStaking<'info> {
    /// The Staking state account
    #[account(
        mut,
        has_one = owner,
    )]
    pub staking: Account<'info, Staking>,

    /// The wallet that owns the staking
    pub owner: Signer<'info>,
    
    /// The wallet that will own the staking
    pub new_owner: AccountInfo<'info>,
}

/// Sets the staking parameters
pub fn handler(
    ctx: Context<SetStaking>,
    max_rarity: u64,
    max_multiplier: u64,
    base_weekly_emissions: u64,
    start: i64,
    root: [u8; 32],
) -> ProgramResult {
    if max_multiplier < 10000 {
        return Err(ErrorCode::InvalidMultiplier.into())
    }

    let staking = &mut ctx.accounts.staking;
    staking.owner = ctx.accounts.new_owner.key();
    staking.maximum_rarity = max_rarity;
    staking.maximum_rarity_multiplier = max_multiplier;
    staking.base_weekly_emissions = base_weekly_emissions;
    staking.start = start;
    staking.root = root;

    msg!("Staking set");

    Ok(())
}
