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
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import { Staking } from "../../target/types/staking";
import { airdropUsers, assertFail, merkleCollection } from "../helpers";
import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { MerkleTree } from "../helpers/merkleTree";

export const testStakeNft = (
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
  describe("Stake a NFT", () => {
    setProvider(provider);

    const program = workspace.Staking as Program<Staking>;

    const n = 10;
    let mintRewards: Token,
      mints: Token[],
      holders: Keypair[],
      accounts: PublicKey[] = Array(n).fill(new PublicKey(0));
    let tree: MerkleTree;

    const stranger = Keypair.generate();
    const maxRarity = new BN(n);
    const indexStaked = 4;

    beforeEach(async () => {
      holders = Array(n)
        .fill(0)
        .map(() => Keypair.generate());
      await airdropUsers([...holders, state.owner, stranger], provider);
      mintRewards = await Token.createMint(
        provider.connection,
        state.owner,
        state.owner.publicKey,
        null,
        9,
        TOKEN_PROGRAM_ID
      );
      const nfts = await merkleCollection(state.owner, n, provider);
      mints = nfts.mints;
      await Promise.all(
        mints.map(async (mint, i) => {
          accounts[i] = (
            await mint.getOrCreateAssociatedAccountInfo(holders[i].publicKey)
          ).address;
          const ownerAccount = (
            await mint.getOrCreateAssociatedAccountInfo(state.owner.publicKey)
          ).address;
          await mint.transfer(ownerAccount, accounts[i], state.owner, [], 1);
        })
      );
      tree = nfts.tree;

      const [stakingAddress, stakingBump] = await PublicKey.findProgramAddress(
        [Buffer.from("staking", "utf8"), state.stakingKey.toBuffer()],
        program.programId
      );

      await program.rpc.setStaking(
        maxRarity,
        state.maxMultiplier,
        state.baseWeeklyEmissions,
        state.start,
        tree.getRootArray(),
        {
          accounts: {
            staking: stakingAddress,
            owner: state.owner.publicKey,
            newOwner: state.owner.publicKey,
          },
          signers: [state.owner],
        }
      );
    });

    it("Stake a token", async () => {
      const [stakingAddress, stakingBump] = await PublicKey.findProgramAddress(
        [Buffer.from("staking", "utf8"), state.stakingKey.toBuffer()],
        program.programId
      );
      const [escrow, escrowBump] = await PublicKey.findProgramAddress(
        [Buffer.from("escrow", "utf8"), state.stakingKey.toBuffer()],
        program.programId
      );
      const [stakedNft, stakedNftBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("staked_nft", "utf8"),
          mints[indexStaked].publicKey.toBuffer(),
        ],
        program.programId
      );
      const [deposit, depositBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("deposit", "utf8"),
          mints[indexStaked].publicKey.toBuffer(),
        ],
        program.programId
      );

      const bumps = {
        stakedNft: stakedNftBump,
        deposit: depositBump,
      };

      await program.rpc.stakeNft(
        bumps,
        tree.getProofArray(indexStaked),
        new BN(indexStaked),
        {
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            stakedNft: stakedNft,
            staker: holders[indexStaked].publicKey,
            mint: mints[indexStaked].publicKey,
            stakerAccount: accounts[indexStaked],
            depositAccount: deposit,
            tokenProgram: TOKEN_PROGRAM_ID,
            clock: SYSVAR_CLOCK_PUBKEY,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
          },
          signers: [holders[indexStaked]],
        }
      );

      const a = await program.account.stakedNft.fetch(stakedNft);
      const j = await program.account.staking.fetch(stakingAddress);

      const timeAfter = Date.now() / 1000;

      expect(j.nftsStaked.toString()).to.equal(new BN(1).toString());
      expect(a.staker.toString()).to.equal(
        holders[indexStaked].publicKey.toString()
      );
      expect(a.mint.toString()).to.equal(
        mints[indexStaked].publicKey.toString()
      );
      expect(a.rarity.toString()).to.equal(new BN(indexStaked).toString());
      expect(a.lastClaim.lte(new BN(timeAfter))).to.equal(true);
      expect(a.lastClaim.gt(new BN(0))).to.equal(true);
    });

    it("Fails when it's too early", async () => {
      const [stakingAddress, stakingBump] = await PublicKey.findProgramAddress(
        [Buffer.from("staking", "utf8"), state.stakingKey.toBuffer()],
        program.programId
      );

      await program.rpc.setStaking(
        maxRarity,
        state.maxMultiplier,
        state.baseWeeklyEmissions,
        new BN(Date.now() + 1000000),
        tree.getRootArray(),
        {
          accounts: {
            staking: stakingAddress,
            owner: state.owner.publicKey,
            newOwner: state.owner.publicKey,
          },
          signers: [state.owner],
        }
      );

      const [escrow, escrowBump] = await PublicKey.findProgramAddress(
        [Buffer.from("escrow", "utf8"), state.stakingKey.toBuffer()],
        program.programId
      );
      const [stakedNft, stakedNftBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("staked_nft", "utf8"),
          mints[indexStaked].publicKey.toBuffer(),
        ],
        program.programId
      );
      const [deposit, depositBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("deposit", "utf8"),
          mints[indexStaked].publicKey.toBuffer(),
        ],
        program.programId
      );

      const bumps = {
        stakedNft: stakedNftBump,
        deposit: depositBump,
      };

      await assertFail(program.rpc.stakeNft(
        bumps,
        tree.getProofArray(indexStaked),
        new BN(indexStaked),
        {
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            stakedNft: stakedNft,
            staker: holders[indexStaked].publicKey,
            mint: mints[indexStaked].publicKey,
            stakerAccount: accounts[indexStaked],
            depositAccount: deposit,
            tokenProgram: TOKEN_PROGRAM_ID,
            clock: SYSVAR_CLOCK_PUBKEY,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
          },
          signers: [holders[indexStaked]],
        }
      ));

      // Reset the staking
      await program.rpc.setStaking(
        maxRarity,
        state.maxMultiplier,
        state.baseWeeklyEmissions,
        state.start,
        tree.getRootArray(),
        {
          accounts: {
            staking: stakingAddress,
            owner: state.owner.publicKey,
            newOwner: state.owner.publicKey,
          },
          signers: [state.owner],
        }
      );
    });

    it("Can't stake an unowned token", async () => {
      const [stakingAddress, stakingBump] = await PublicKey.findProgramAddress(
        [Buffer.from("staking", "utf8"), state.stakingKey.toBuffer()],
        program.programId
      );
      const [escrow, escrowBump] = await PublicKey.findProgramAddress(
        [Buffer.from("escrow", "utf8"), state.stakingKey.toBuffer()],
        program.programId
      );
      const [stakedNft, stakedNftBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("staked_nft", "utf8"),
          mints[indexStaked].publicKey.toBuffer(),
        ],
        program.programId
      );
      const [deposit, depositBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("deposit", "utf8"),
          mints[indexStaked].publicKey.toBuffer(),
        ],
        program.programId
      );

      const bumps = {
        stakedNft: stakedNftBump,
        deposit: depositBump,
      };

      const stakerAccount = await mints[
        indexStaked
      ].getOrCreateAssociatedAccountInfo(stranger.publicKey);

      await assertFail(
        program.rpc.stakeNft(
          bumps,
          tree.getProofArray(indexStaked),
          new BN(indexStaked),
          {
            accounts: {
              staking: stakingAddress,
              escrow: escrow,
              stakedNft: stakedNft,
              staker: stranger.publicKey,
              mint: mints[indexStaked].publicKey,
              stakerAccount: stakerAccount.address,
              depositAccount: deposit,
              tokenProgram: TOKEN_PROGRAM_ID,
              clock: SYSVAR_CLOCK_PUBKEY,
              rent: SYSVAR_RENT_PUBKEY,
              systemProgram: SystemProgram.programId,
            },
            signers: [stranger],
          }
        )
      );
    });
  });
