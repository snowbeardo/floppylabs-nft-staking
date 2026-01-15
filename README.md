# Staking as a self Service

## Overview

This smart contract is a generic Staking solution that supports any number of NFT staking projects at the same time, each one with its own staking configuration (daily rewards, custom SPL token...).
Its design is focused on simplifying the addition and configuration of new projects to the extent that it can be done without writing any code or re-deploying the contract. 
Following that idea, this smart contract serves two types of clients:
- Project owners: they can set up a new staking project (`init_staking` instruction), edit the configuration of an existing one (`set_staking` instruction) or 
  withdraw part of the rewards from the escrow (`withdraw_rewards` instruction).
- Project NFT holders: they can stake their NFTs (`stake_nft` instruction), withdraw them (`unstake_nft` instruction), and claim rewards (`claim_staking` instruction).  

## Implementation details

- The key to supporting multiple projects withing the same program is the `staking_key`, which is an unique PublicKey per project used to derive the rest of project-specific accounts. 
- The staked NFTs, and the token rewards, are deposited in program owned project-specific escrow accounts.
- The project is using Merkle Tree verification - from [Metaplex Gumdrop](https://github.com/metaplex-foundation/metaplex/tree/master/rust/gumdrop) - to ensure an NFT is part of a collection. 
  It will be updated to the new Metaplex collection standard once it is adopted.

## Staking configuration

Each staking project can be configured with these configuration parameters:
- `daily_rewards`: amount of SPL tokens each NFT can claim per day. The NFT holder can get that amount multiplied by its NFT `rarity_multiplier`. 
  The rarity multiplier is not stored on-chain; it is used to calculate the Merkle tree during project initialization and later when staking/unstaking/claiming (check `devnetMints.json` file).
- `start`: the timestamp when the Staking goes live.
- `mint`: SPL token used for the rewards. It could be a custom token or Wrapped SOL. 

### Deployment

- Deploy the program using `yarn deploy:mainnet` or `yarn deploy:devnet`. This uploads to program on the solana blockchain. To work, you need to have a `key.json` file at the root of this folder (create one using `solana-keygen new -o key.json`) and this account must have enough to pay rent.

### Testing

- Run `anchor test` to run tests on a local validator. Every instruction is covered by tests. 
  
### CLI client

There are a set of ready to use scripts that serve as a reference CLI for trying the smart contract functionalities manually by generating a new NFT staking project and interacting with it:
- Initialize a new staking project with `yarn initialize:mainnet` or `yarn initialize:devnet`. It reads the project configuration from `config.json`. This generates a new `staking_key`, creates the Staking main account and it's associated SPL reward token (a new one), and sends half of the supply to the staking rewards account.
- Change configurations of the created project with `yarn reset:mainnet` or `yarn reset:devnet`. It reads the existing project addresses from `deployments.json`, and updates the config with the current values of `config.json`.
- Print all the accounts used by the created project with `yarn get-accounts:mainnet` or `yarn get-accounts:devnet`.
- Top up the rewards wallet of the created project using `yarn transfer:mainnet` or `yarn transfer:devnet`.
- Withdraw rewards from the rewards wallet using `yarn withdraw:mainnet` or `yarn withdraw:devnet`.
## Contact

- Linkedin: [https://www.linkedin.com/in/jesus-uriel-valdez/](https://www.linkedin.com/in/jesus-uriel-valdez/)
- Gmail: jesusuriel950918@gmail.com


