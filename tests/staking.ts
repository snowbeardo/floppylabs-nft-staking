import {
  setProvider,
  Provider,
  BN,
  Program,
  workspace,
} from "@project-serum/anchor";
import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import { Staking } from "../target/types/staking";
import {
  airdropUsers,
  merkleCollection,
  mintAndTransferRewards,
} from "./helpers";
import { testClaimRewards } from "./suites/claimRewards";
import { testInitializeStaking } from "./suites/initStaking";
import { testSetStaking } from "./suites/setStaking";
import { testStakeNft } from "./suites/stakeNft";
import { testUnstakeNft } from "./suites/unstakeNft";
import { testWithdrawRewards } from "./suites/withdrawRewards";

describe("Staking Tests Suite", () => {
  const provider = Provider.local();
  setProvider(provider);

  const program = workspace.Staking as Program<Staking>;

  const state = {
    owner: Keypair.generate(),
    staker: Keypair.generate(),
    numberOfNfts: 10,
    mints: [],
    tree: undefined,
    stakingKey: Keypair.generate().publicKey,
    mintRewards: new Token(
      provider.connection,
      Keypair.generate().publicKey,
      TOKEN_PROGRAM_ID,
      Keypair.generate()
    ),
    dailyRewards: new BN(604800),
    start: new BN(Math.round(Date.now() / 1000)),
  };

  before(async () => {
     await airdropUsers([state.owner, state.staker], provider);
     const mintInfo = await mintAndTransferRewards(
       provider,
       program.programId,
       state.stakingKey,
       state.owner,
       604800
     );
     state.mintRewards = mintInfo.mint;
     const nfts = await merkleCollection(
       state.owner,
       state.numberOfNfts,
       provider
     );
     state.mints = nfts.mints;
     state.tree = nfts.tree;
  });

  testInitializeStaking(state, provider);
  testSetStaking(state, provider);
  testWithdrawRewards(state, provider);
  testStakeNft(state, provider);
  testUnstakeNft(state, provider);
  testClaimRewards(state, provider);
});
