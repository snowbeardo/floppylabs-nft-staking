# While Label Staking

## Overview

The Staking module lets holders of the a given NFTs deposit their tokens in a program-owned account in exchange for rewards. It lets users:

- Deposit their NFT in a secured program-owned account. To prevent creating manually each token account, the Merkle verification of [Gumdrop](https://github.com/metaplex-foundation/metaplex/tree/master/rust/gumdrop) is reused (to be reviewed).
- Collect rewards, paid in $X token, based on the rarity of the NFT. The rarest NFT can earn up to XX% more rewards than the least rare. The rewards rate is fixed and more people coming to stake will decrease individuals' rewards.
- Withdraw their NFT.

## Usage

### As an NFT holder

1. Stake your tokens
2. Claim your rewards

### As an admin

The amount of SOL winnable in the lottery depends on what is deposited in the lottery account at the time the round starts. As admins, you HAVE TO send SOL manually each week.

*Currently, the lottery account's address is **65dhKKXK1K1vaHXiev5cNMTWwoSL1nJABB63kDZnx2gj**.*

The owner of the Jungle can withdraw staking rewards at any time using the `rpc.withdrawRewards` method. This allows migrating to a new program or using rewards for the team's operations. Attention, THE OWNER CAN WITHDRAW ALL REWARDS at any time. This means that staking rewards can stop and the owners can dump the tokens as long as there is an owner. (to be reviewed)

### As a developer

- Deploy the program using `yarn deploy:mainnet` or `yarn deploy:devnet`. This uploads to program on the solana blockchain. To work, you need to have a `key.json` file at the root of this folder (create one using `solana-keygen new -o key.json`) and this account must have enough to pay rent (~10 SOL? to be reviewed).
- Initialize the program with `yarn initialize:mainnet` or `yarn initialize:devnet`. This costs less SOL but some is needed to sign the transactions. You need to update the values defined `config.json` first. This creates the Staking main account and it's associated reward token, sends half of the supply to the staking rewards account (to be reviewed).
