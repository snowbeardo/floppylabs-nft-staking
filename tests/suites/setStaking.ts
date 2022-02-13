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
import { airdropUsers, assertFail, merkleCollection } from "../helpers";
import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { MerkleTree } from "../helpers/merkleTree";

export const testSetStaking = (
  state: {
    owner: Keypair;
    staker: Keypair;
    stakingKey: PublicKey;
    mintRewards: Token;
    maxMultiplier: BN;
    baseWeeklyEmissions: BN;
    start: BN;
  },
  provider: Provider
) =>
  describe("Setting the Staking", () => {
    setProvider(provider);

    const program = workspace.Staking as Program<Staking>;

    let mintRewards: Token, mints: Token[];
    let tree: MerkleTree;

    beforeEach(async () => {
      await airdropUsers([state.owner], provider);
      mintRewards = await Token.createMint(
        provider.connection,
        state.owner,
        state.owner.publicKey,
        null,
        9,
        TOKEN_PROGRAM_ID
      );
      const nfts = await merkleCollection(state.owner, 5, provider);
      mints = nfts.mints;
      tree = nfts.tree;
    });

    it("Reset the Staking", async () => {
      const newOwner = Keypair.generate();
      const newMaximumMultiplier = new BN(100000);
      const newWeekly = new BN(100000);

      const [stakingAddress, stakingBump] = await PublicKey.findProgramAddress(
        [Buffer.from("staking"), state.stakingKey.toBuffer()],
        program.programId
      );

      const maximumRarity = new BN(mints.length - 1);
      const newMaximumRarity = new BN(mints.length + 100);

      await program.rpc.setStaking(
        newMaximumRarity,
        newMaximumMultiplier,
        newWeekly,
        state.start,
        tree.getRootArray(),
        {
          accounts: {
            staking: stakingAddress,
            owner: state.owner.publicKey,
            newOwner: newOwner.publicKey,
          },
          signers: [state.owner],
        }
      );

      const s = await program.account.staking.fetch(stakingAddress);

      expect(s.owner.toString()).to.equal(newOwner.publicKey.toString());
      expect(s.maximumRarity.toString()).to.equal(newMaximumRarity.toString());
      expect(s.maximumRarityMultiplier.toString()).to.equal(
        newMaximumMultiplier.toString()
      );
      expect(s.baseWeeklyEmissions.toString()).to.equal(newWeekly.toString());
      expect(s.root.toString()).to.equal(
        tree.getRoot().toJSON().data.toString()
      );

      await program.rpc.setStaking(
        maximumRarity,
        state.maxMultiplier,
        state.baseWeeklyEmissions,
        state.start,
        tree.getRootArray(),
        {
          accounts: {
            staking: stakingAddress,
            owner: newOwner.publicKey,
            newOwner: state.owner.publicKey,
          },
          signers: [newOwner],
        }
      );
    });

    it("Fails when called by an outsider", async () => {
      const newOwner = Keypair.generate();
      const newMaximumMultiplier = new BN(100000);
      const newWeekly = new BN(100000);

      const [stakingAddress, stakingBump] = await PublicKey.findProgramAddress(
        [Buffer.from("staking"), state.stakingKey.toBuffer()],
        program.programId
      );

      const newMaximumRarity = new BN(mints.length + 10);

      await assertFail(
        program.rpc.setStaking(
          newMaximumRarity,
          newMaximumMultiplier,
          newWeekly,
          tree.getRootArray(),
          {
            accounts: {
              staking: stakingAddress,
              owner: newOwner.publicKey,
              newOwner: newOwner.publicKey,
            },
            signers: [newOwner],
          }
        )
      );
    });
  });
