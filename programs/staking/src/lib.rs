#![cfg_attr(feature = "no-entrypoint", allow(dead_code))]

use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod merkle_proof;
pub mod fees_wallet;

use instructions::*;

declare_id!("B5d1rnaYWHsnpavXRpTUXppsgaaZ8q4eRVamM6EAS6TR");

#[program]
mod staking {
    use crate::instructions::unstake_nft::UnstakeNft;
    use super::*;

    /// Initializes the staking
    pub fn initialize_staking(
        ctx: Context<InitializeStaking>,
        bumps: InitializeStakingBumps,
        max_rarity: u64,
        max_multiplier: u64,
        base_weekly_emissions: u64,
        start: i64,
        root: [u8; 32],
    ) -> ProgramResult {
        instructions::init_staking::handler(
            ctx,
            bumps,
            max_rarity,
            max_multiplier,
            base_weekly_emissions,
            start,
            root,
        )
    }

    /// Sets the staking parameters
    pub fn set_staking(
        ctx: Context<SetStaking>,
        max_rarity: u64,
        max_multiplier: u64,
        base_weekly_emissions: u64,
        start: i64,
        root: [u8; 32],
    ) -> ProgramResult {
        instructions::set_staking::handler(
            ctx,
            max_rarity,
            max_multiplier,
            base_weekly_emissions,
            start,
            root,
        )
    }

    /// Withdraw rewards from the vault
    pub fn withdraw_rewards(
        ctx: Context<WithdrawRewards>,
        amount: u64
    ) -> ProgramResult {
        instructions::withdraw_rewards::handler(
            ctx,
            amount
        )
    }

    /// Stake an NFT
    pub fn stake_nft(
        ctx: Context<StakeNft>,
        bumps: StakedNftBumps,
        proof: Vec<[u8; 32]>,
        rarity: u64,
    ) -> ProgramResult {
        instructions::stake_nft::handler(ctx, bumps, proof, rarity)
    }

    /// Unstake a staked nft
    pub fn unstake_nft(ctx: Context<UnstakeNft>) -> ProgramResult {
        instructions::unstake_nft::handler(ctx)
    }

    /// Claim staking rewards
    pub fn claim_staking(ctx: Context<ClaimStaking>) -> ProgramResult {
        instructions::claim_staking::handler(ctx)
    }

}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct InitializeStakingBumps {
    pub staking: u8,
    pub escrow: u8,
    pub rewards: u8,
}

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

    /// The maximum rarity value
    /// Any rarity below this will be cut off
    pub maximum_rarity: u64,

    /// The rarity multiplier for staking rewards, in basis points
    pub maximum_rarity_multiplier: u64,

    /// The amount of tokens emitted each week
    pub base_weekly_emissions: u64,

    /// The time the staking starts (in seconds since 1970)
    pub start: i64,

    /// The root of the merkle tree used to know if a token is part of the collection
    pub root: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct StakedNftBumps {
    pub staked_nft: u8,
    pub deposit: u8,
}

/// The account representing the staked nft
#[account]
#[derive(Default)]
pub struct StakedNft {
    /// Bump used to create this PDA
    pub bumps: StakedNftBumps,

    /// The mint of the NFT
    pub mint: Pubkey,

    /// Owner of the staked NFT
    pub staker: Pubkey,

    /// How rare the NFT is
    pub rarity: u64,

    /// Last time the owner claimed rewards
    pub last_claim: i64,
}

impl StakedNft {
    pub const LEN: usize = 8 + 2 + 40 + 40 + 8 + 1 + 8;
}
