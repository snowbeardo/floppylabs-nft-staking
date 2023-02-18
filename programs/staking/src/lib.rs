#![cfg_attr(feature = "no-entrypoint", allow(dead_code))]

use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod merkle_proof;
pub mod fees_wallet;
pub mod fl_auth_wallet;

use instructions::*;

declare_id!("BtDDM9Nve5JXUVvDg8wmLDVwzgGB8pJ6oum4fGRKM8Av");

#[program]
mod staking {
    use crate::instructions::unstake_nft::UnstakeNft;
    use super::*;

    /// Initializes the staking
    pub fn initialize_staking(
        ctx: Context<InitializeStaking>,
        bumps: InitializeStakingBumps,
        daily_rewards: u64,
        start: i64,
        root: [u8; 32],
    ) -> Result<()> {
        instructions::init_staking::handler(
            ctx,
            bumps,
            daily_rewards,
            start,
            root,
        )
    }

    /// Sets the staking parameters
    pub fn set_staking(
        ctx: Context<SetStaking>,
        daily_rewards: u64,
        start: i64,
        root: [u8; 32],
    ) -> Result<()> {
        instructions::set_staking::handler(
            ctx,
            daily_rewards,
            start,
            root,
        )
    }

    /// Sets the fees exempt property for the project.
    /// Only FloppyLabs account has the authority to execute this
    pub fn set_fees_exempt(
        ctx: Context<SetFeesExempt>,
        fees_exempt: bool,
    ) -> Result<()> {
        instructions::set_fees_exempt::handler(
            ctx,
            fees_exempt,
        )
    }

    /// Withdraw rewards from the vault
    pub fn withdraw_rewards(
        ctx: Context<WithdrawRewards>,
        amount: u64
    ) -> Result<()> {
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
        rarity_multiplier: u64,
    ) -> Result<()> {
        instructions::stake_nft::handler(ctx, bumps, proof, rarity_multiplier)
    }

    /// Unstake a staked nft
    pub fn unstake_nft(ctx: Context<UnstakeNft>) -> Result<()> {
        instructions::unstake_nft::handler(ctx)
    }

    /// Stake an OCP NFT (ME royalties enforcement standard)
    pub fn stake_ocp(
        ctx: Context<StakeOcp>,
        bumps: StakedNftBumps,
        proof: Vec<[u8; 32]>,
        rarity_multiplier: u64,
    ) -> Result<()> {
        instructions::stake_ocp::handler(ctx, bumps, proof, rarity_multiplier)
    }

    /// Unstake a staked OCP nft
    pub fn unstake_ocp(ctx: Context<UnstakeOcp>) -> Result<()> {
        instructions::unstake_ocp::handler(ctx)
    }

    /// Stake using Metaplex's Token Metadata program (support for pNFT)
    pub fn stake_mpl(
        ctx: Context<StakeMpl>,
        bumps: StakedNftBumps,
        proof: Vec<[u8; 32]>,
        rarity_multiplier: u64,
    ) -> Result<()> {
        instructions::stake_mpl::handler(ctx, bumps, proof, rarity_multiplier)
    }

    /// Unstake using Metaplex's Token Metadata program (support for pNFT)
    pub fn unstake_mpl(ctx: Context<UnstakeMpl>) -> Result<()> {
        instructions::unstake_mpl::handler(ctx)
    }

    /// Unstake using Metaplex's Token Metadata program a token custodied by our escrow 
    /// Mainly used to support non pNFT staked collections migrating to pNFT
    pub fn unstake_mpl_custodial(ctx: Context<UnstakeMplCustodial>) -> Result<()> {
        instructions::unstake_mpl_custodial::handler(ctx)
    }

    /// Claim staking rewards
    pub fn claim_staking(ctx: Context<ClaimStaking>) -> Result<()> {
        instructions::claim_staking::handler(ctx)
    }

    /// Migrate Escrow account
    pub fn migrate_escrow(ctx: Context<MigrateEscrow>) -> Result<()> {
        instructions::migrate_escrow::handler(ctx)
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

    /// The amount of tokens rewarded daily per NFT
    pub daily_rewards: u64,

    /// The time the staking starts (in seconds since 1970)
    pub start: i64,

    /// The root of the merkle tree used to know if a token is part of the collection
    pub root: [u8; 32],

    /// Whether or not the project is fees exempt: default to false
    pub fees_exempt: bool
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

    /// Staking key identifying the project
    pub key: Pubkey,

    /// The mint of the NFT
    pub mint: Pubkey,

    /// Owner of the staked NFT
    pub staker: Pubkey,

    /// How rare the NFT is
    pub rarity_multiplier: u64,

    /// Creation of this stake account
    pub staked_at: i64,

    /// Last time the owner claimed rewards
    pub last_claim: i64,
}

impl StakedNft {
    pub const LEN: usize = 8 + 2 + 32 + 32 + 32 + 8 + 8 + 8;
}
