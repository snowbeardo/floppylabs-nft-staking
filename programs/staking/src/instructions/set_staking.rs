use anchor_lang::prelude::*;

use crate::{Staking};

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
    daily_rewards: u64,
    start: i64,
    root: [u8; 32],
) -> ProgramResult {

    let staking = &mut ctx.accounts.staking;
    staking.owner = ctx.accounts.new_owner.key();
    staking.daily_rewards = daily_rewards;
    staking.start = start;
    staking.root = root;

    msg!("Staking set");

    Ok(())
}
