import { expect } from "chai";
import {
  setProvider,
  Provider,
  Program,
  workspace,
  BN,
} from "@project-serum/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { Staking } from "../../target/types/staking";
import {
  airdropUsers,
  assertFail,
  merkleCollection,
  mintAndTransferRewards,
} from "../helpers";
import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { MerkleTree } from "../helpers/merkleTree";

export const testInitializeStaking = (
  state: {
    owner: Keypair;
    staker: Keypair;
    mints: PublicKey[];
    stakingKey: PublicKey;
    mintRewards: Token;
    maxMultiplier: BN;
    baseWeeklyEmissions: BN;
    start: BN;
  },
  provider: Provider
) =>
  describe("Test Staking initialization", () => {
    setProvider(provider);

    const program = workspace.Staking as Program<Staking>;

    let mintRewards: Token, mints: Token[];
    let tree: MerkleTree;

    before(async () => {
      await airdropUsers([state.owner, state.staker], provider);
      const mintInfo = await mintAndTransferRewards(
        provider,
        program.programId,
        state.stakingKey,
        state.owner,
        604800
      );
      mintRewards = mintInfo.mint;
      const nfts = await merkleCollection(
        state.owner,
        state.mints.length,
        provider
      );
      mints = nfts.mints;
      tree = nfts.tree;
    });

    it("Initializes the staking", async () => {
      const [stakingAddress, stakingBump] = await PublicKey.findProgramAddress(
        [Buffer.from("staking"), state.stakingKey.toBuffer()],
        program.programId
      );
      const [escrow, escrowBump] = await PublicKey.findProgramAddress(
        [Buffer.from("escrow"), state.stakingKey.toBuffer()],
        program.programId
      );
      const [rewards, rewardsBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("rewards"),
          state.stakingKey.toBuffer(),
          mintRewards.publicKey.toBuffer(),
        ],
        program.programId
      );

      const bumps = {
        staking: stakingBump,
        escrow: escrowBump,
        rewards: rewardsBump,
      };

      const maximumRarity = new BN(mints.length - 1);

      await program.rpc.initializeStaking(
        bumps,
        maximumRarity,
        state.maxMultiplier,
        state.baseWeeklyEmissions,
        state.start,
        tree.getRootArray(),
        {
          accounts: {
            stakingKey: state.stakingKey,
            staking: stakingAddress,
            escrow: escrow,
            mint: mintRewards.publicKey,
            rewardsAccount: rewards,
            owner: state.owner.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
          },
          signers: [state.owner],
        }
      );

      const s = await program.account.staking.fetch(stakingAddress);

      expect(s.owner.toString()).to.equal(state.owner.publicKey.toString());
      expect(s.escrow.toString()).to.equal(escrow.toString());
      expect(s.mint.toString()).to.equal(mintRewards.publicKey.toString());
      expect(s.maximumRarity.toString()).to.equal(maximumRarity.toString());
      expect(s.maximumRarityMultiplier.toString()).to.equal(
        state.maxMultiplier.toString()
      );
      expect(s.baseWeeklyEmissions.toString()).to.equal(
        state.baseWeeklyEmissions.toString()
      );
      expect(s.start.toString()).to.equal(state.start.toString());
      expect(s.root.toString()).to.equal(
        tree.getRoot().toJSON().data.toString()
      );
    });

    it("Only accepts positive multipliers", async () => {
      const stakingKey = Keypair.generate().publicKey;
      const [stakingAddress, stakingBump] = await PublicKey.findProgramAddress(
        [Buffer.from("staking"), stakingKey.toBuffer()],
        program.programId
      );
      const [escrow, escrowBump] = await PublicKey.findProgramAddress(
        [Buffer.from("escrow"), stakingKey.toBuffer()],
        program.programId
      );
      const [rewards, rewardsBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("rewards"),
          stakingKey.toBuffer(),
          mintRewards.publicKey.toBuffer(),
        ],
        program.programId
      );

      const bumps = {
        staking: stakingBump,
        escrow: escrowBump,
        rewards: rewardsBump,
      };

      const maximumRarity = new BN(mints.length - 1);

      await assertFail(
        program.rpc.initializeStaking(
          bumps,
          maximumRarity,
          new BN(9999),
          state.baseWeeklyEmissions,
          state.start,
          tree.getRootArray(),
          {
            accounts: {
              stakingKey: stakingKey,
              staking: stakingAddress,
              escrow: escrow,
              mint: mintRewards.publicKey,
              rewardsAccount: rewards,
              owner: state.owner.publicKey,
              tokenProgram: TOKEN_PROGRAM_ID,
              rent: SYSVAR_RENT_PUBKEY,
              systemProgram: SystemProgram.programId,
            },
            signers: [state.owner],
          }
        )
      );
    });
  });
