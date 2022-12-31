import { expect } from "chai";
import {
  setProvider,
  Provider,
  Program,
  workspace,
  BN,
  Wallet
} from "@project-serum/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { Staking } from "../../target/types/staking";
import { airdropUsers, assertFail, merkleCollection, merkleCollectionOcp, FEES_LAMPORTS, FEES_ACCOUNT } from "../helpers";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { MerkleTree } from "../helpers/merkleTree";
import {
  createTestMintAndWrap,
  DEVNET_POLICY_ALL
} from "../helpers/ocpUtils";
import { findMintStatePk, CMT_PROGRAM, OCP_PROGRAM } from "@magiceden-oss/open_creator_protocol";
import { findMetadataPda } from "@metaplex-foundation/js";

const OCP_PROGRAM = new PublicKey("ocp4vWUzA2z2XMYJ3QhM9vWdyoyoQwAFJhRdVTbvo9E"); // OCP Devnet

export const testStakeOcp = (
  state: {
    owner: Keypair;
    staker: Keypair;
    stakingKey: PublicKey;
    mintRewards: Token;
    dailyRewards: BN;
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
      ownerAccount: PublicKey;

    let tree: MerkleTree;

    const indexStaked = 0;

    let stakingKey: PublicKey, owner: Keypair, stranger: Keypair;

    const startingAmount = new BN(10 ** 10);

    beforeEach(async () => {
      stakingKey = Keypair.generate().publicKey;
      owner = Keypair.generate();
      stranger = Keypair.generate();

      await airdropUsers([owner, stranger], provider);
      mintRewards = await createMint(
        provider.connection,
        owner,
        owner.publicKey,
        null,
        9
      );
      const nfts = await merkleCollectionOcp(new Wallet(owner), n, provider);
      mints = nfts.mints;
      tree = nfts.tree;

      ownerAccount = (
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          owner,
          mints[0],
          owner.publicKey
        )
      ).address;

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
          mintRewards.toBuffer(),
        ],
        program.programId
      );

      const bumps = {
        staking: stakingBump,
        escrow: escrowBump,
        rewards: rewardsBump,
      };

      await program.rpc.initializeStaking(
        bumps,
        state.dailyRewards,
        state.start,
        tree.getRootArray(),
        {
          accounts: {
            stakingKey: stakingKey,
            staking: stakingAddress,
            escrow: escrow,
            mint: mintRewards,
            rewardsAccount: rewards,
            owner: state.owner.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
          },
          signers: [state.owner],
        }
      );

      // Mint reward tokens to the staking
      await mintTo(
          provider.connection,
          owner,
          mintRewards,
          rewards,
          owner,
          startingAmount.toNumber()
      );

    });

    it("Stake a token", async () => {
      const [stakingAddress, stakingBump] = await PublicKey.findProgramAddress(
        [Buffer.from("staking", "utf8"), stakingKey.toBuffer()],
        program.programId
      );
      const [escrow, escrowBump] = await PublicKey.findProgramAddress(
        [Buffer.from("escrow", "utf8"), stakingKey.toBuffer()],
        program.programId
      );
      const [stakedNft, stakedNftBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("staked_nft", "utf8"),
          mints[indexStaked].toBuffer(),
        ],
        program.programId
      );

      const bumps = {
        stakedNft: stakedNftBump,
      };

      const feePayerAccount = Keypair.generate();
      const createFeePayerAccountIx = SystemProgram.createAccount({
        programId: program.programId,
        space: 0,
        lamports: FEES_LAMPORTS,
        fromPubkey: owner.publicKey,
        newAccountPubkey: feePayerAccount.publicKey
      });

      const feesBalanceBefore = await provider.connection.getBalance(FEES_ACCOUNT);

      await program.rpc.stakeOcp(
        bumps,
        tree.getProofArray(indexStaked),
        new BN(indexStaked),
        {
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            stakedNft: stakedNft,
            staker: owner.publicKey,
            mint: mints[indexStaked],
            stakerAccount: ownerAccount,
            feePayerAccount: feePayerAccount.publicKey,
            feeReceiverAccount: FEES_ACCOUNT,
            tokenProgram: TOKEN_PROGRAM_ID,
            clock: SYSVAR_CLOCK_PUBKEY,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
            ocpPolicy: DEVNET_POLICY_ALL,
            metadata: findMetadataPda(mints[indexStaked]),
            ocpMintState: findMintStatePk(mints[indexStaked]),
            ocpProgram: OCP_PROGRAM,
            cmtProgram: CMT_PROGRAM,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY
          },
          instructions: [createFeePayerAccountIx],
          signers: [owner, feePayerAccount],
        }
      );

      const a = await program.account.stakedNft.fetch(stakedNft);
      const j = await program.account.staking.fetch(stakingAddress);

      const timeAfter = Date.now() / 1000;

      expect(j.nftsStaked.toString()).to.equal(new BN(1).toString());
      expect(a.staker.toString()).to.equal(
        owner.publicKey.toString()
      );
      expect(a.mint.toString()).to.equal(
        mints[indexStaked].toString()
      );
      expect(a.rarityMultiplier.toString()).to.equal(new BN(indexStaked).toString());
      expect(a.lastClaim.lte(new BN(timeAfter))).to.equal(true);
      expect(a.lastClaim.gt(new BN(0))).to.equal(true);

      const feesBalanceAfter = await provider.connection.getBalance(FEES_ACCOUNT);
      expect(feesBalanceAfter - feesBalanceBefore).to.equal(FEES_LAMPORTS);
    });

    it("Fails when it's too early", async () => {
      const [stakingAddress, stakingBump] = await PublicKey.findProgramAddress(
        [Buffer.from("staking", "utf8"), stakingKey.toBuffer()],
        program.programId
      );

      await program.rpc.setStaking(
        state.dailyRewards,
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
        [Buffer.from("escrow", "utf8"), stakingKey.toBuffer()],
        program.programId
      );
      const [stakedNft, stakedNftBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("staked_nft", "utf8"),
          mints[indexStaked].toBuffer(),
        ],
        program.programId
      );

      const bumps = {
        stakedNft: stakedNftBump,
      };

      const feePayerAccount = Keypair.generate();
      const createFeePayerAccountIx = SystemProgram.createAccount({
        programId: program.programId,
        space: 0,
        lamports: FEES_LAMPORTS,
        fromPubkey: owner.publicKey,
        newAccountPubkey: feePayerAccount.publicKey
      });

      await assertFail(program.rpc.stakeOcp(
        bumps,
        tree.getProofArray(indexStaked),
        new BN(indexStaked),
        {
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            stakedNft: stakedNft,
            staker: owner.publicKey,
            mint: mints[indexStaked],
            stakerAccount: ownerAccount,
            feePayerAccount: feePayerAccount.publicKey,
            feeReceiverAccount: FEES_ACCOUNT,
            tokenProgram: TOKEN_PROGRAM_ID,
            clock: SYSVAR_CLOCK_PUBKEY,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
            ocpPolicy: DEVNET_POLICY_ALL,
            metadata: findMetadataPda(mints[indexStaked]),
            ocpMintState: findMintStatePk(mints[indexStaked]),
            ocpProgram: OCP_PROGRAM,
            cmtProgram: CMT_PROGRAM,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY
          },
          instructions: [createFeePayerAccountIx],
          signers: [owner, feePayerAccount],
        }
      ));

      // Reset the staking
      await program.rpc.setStaking(
        state.dailyRewards,
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
        [Buffer.from("staking", "utf8"), stakingKey.toBuffer()],
        program.programId
      );
      const [escrow, escrowBump] = await PublicKey.findProgramAddress(
        [Buffer.from("escrow", "utf8"), stakingKey.toBuffer()],
        program.programId
      );
      const [stakedNft, stakedNftBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("staked_nft", "utf8"),
          mints[indexStaked].toBuffer(),
        ],
        program.programId
      );

      const bumps = {
        stakedNft: stakedNftBump,
      };

      const stakerAccount =
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          stranger,
          mints[indexStaked],
          stranger.publicKey
        );

      const feePayerAccount = Keypair.generate();
      const createFeePayerAccountIx = SystemProgram.createAccount({
        programId: program.programId,
        space: 0,
        lamports: FEES_LAMPORTS,
        fromPubkey: stranger.publicKey,
        newAccountPubkey: feePayerAccount.publicKey
      });


      await assertFail(program.rpc.stakeOcp(
        bumps,
        tree.getProofArray(indexStaked),
        new BN(indexStaked),
        {
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            stakedNft: stakedNft,
            staker: stranger.publicKey,
            mint: mints[indexStaked],
            stakerAccount: stakerAccount.address,
            feePayerAccount: feePayerAccount.publicKey,
            feeReceiverAccount: FEES_ACCOUNT,
            tokenProgram: TOKEN_PROGRAM_ID,
            clock: SYSVAR_CLOCK_PUBKEY,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
            ocpPolicy: DEVNET_POLICY_ALL,
            metadata: findMetadataPda(mints[indexStaked]),
            ocpMintState: findMintStatePk(mints[indexStaked]),
            ocpProgram: OCP_PROGRAM,
            cmtProgram: CMT_PROGRAM,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY
          },
          instructions: [createFeePayerAccountIx],
          signers: [stranger, feePayerAccount],
        }
        )
      );
    });

    it("Can't stake without paying enough fees", async () => {
      const [stakingAddress, stakingBump] = await PublicKey.findProgramAddress(
        [Buffer.from("staking", "utf8"), stakingKey.toBuffer()],
        program.programId
      );
      const [escrow, escrowBump] = await PublicKey.findProgramAddress(
        [Buffer.from("escrow", "utf8"), stakingKey.toBuffer()],
        program.programId
      );
      const [stakedNft, stakedNftBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("staked_nft", "utf8"),
          mints[indexStaked].toBuffer(),
        ],
        program.programId
      );

      const bumps = {
        stakedNft: stakedNftBump,
      };

      const feePayerAccount = Keypair.generate();
      const createFeePayerAccountIx = SystemProgram.createAccount({
        programId: program.programId,
        space: 0,
        lamports: FEES_LAMPORTS / 2, // Pays half of the fees required
        fromPubkey: owner.publicKey,
        newAccountPubkey: feePayerAccount.publicKey
      });

      await assertFail(
        program.rpc.stakeOcp(
            bumps,
            tree.getProofArray(indexStaked),
            new BN(indexStaked),
            {
              accounts: {
                staking: stakingAddress,
                escrow: escrow,
                stakedNft: stakedNft,
                staker: owner.publicKey,
                mint: mints[indexStaked],
                stakerAccount: ownerAccount,
                feePayerAccount: feePayerAccount.publicKey,
                feeReceiverAccount: FEES_ACCOUNT,
                tokenProgram: TOKEN_PROGRAM_ID,
                clock: SYSVAR_CLOCK_PUBKEY,
                rent: SYSVAR_RENT_PUBKEY,
                systemProgram: SystemProgram.programId,
                ocpPolicy: DEVNET_POLICY_ALL,
                metadata: findMetadataPda(mints[indexStaked]),
                ocpMintState: findMintStatePk(mints[indexStaked]),
                ocpProgram: OCP_PROGRAM,
                cmtProgram: CMT_PROGRAM,
                instructions: SYSVAR_INSTRUCTIONS_PUBKEY
              },
              instructions: [createFeePayerAccountIx],
              signers: [owner, feePayerAccount],
            }
          )
      );
    });

    it("Can't stake sending fees to incorrect wallet", async () => {
      const [stakingAddress, stakingBump] = await PublicKey.findProgramAddress(
        [Buffer.from("staking", "utf8"), stakingKey.toBuffer()],
        program.programId
      );
      const [escrow, escrowBump] = await PublicKey.findProgramAddress(
        [Buffer.from("escrow", "utf8"), stakingKey.toBuffer()],
        program.programId
      );
      const [stakedNft, stakedNftBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("staked_nft", "utf8"),
          mints[indexStaked].toBuffer(),
        ],
        program.programId
      );

      const bumps = {
        stakedNft: stakedNftBump,
      };

      const feePayerAccount = Keypair.generate();
      const createFeePayerAccountIx = SystemProgram.createAccount({
        programId: program.programId,
        space: 0,
        lamports: FEES_LAMPORTS,
        fromPubkey: owner.publicKey,
        newAccountPubkey: feePayerAccount.publicKey
      });

      await assertFail(
        program.rpc.stakeOcp(
            bumps,
            tree.getProofArray(indexStaked),
            new BN(indexStaked),
            {
              accounts: {
                staking: stakingAddress,
                escrow: escrow,
                stakedNft: stakedNft,
                staker: owner.publicKey,
                mint: mints[indexStaked],
                stakerAccount: ownerAccount,
                feePayerAccount: feePayerAccount.publicKey,
                feeReceiverAccount: Keypair.generate().publicKey, // Not valid receiver account
                tokenProgram: TOKEN_PROGRAM_ID,
                clock: SYSVAR_CLOCK_PUBKEY,
                rent: SYSVAR_RENT_PUBKEY,
                systemProgram: SystemProgram.programId,
                ocpPolicy: DEVNET_POLICY_ALL,
                metadata: findMetadataPda(mints[indexStaked]),
                ocpMintState: findMintStatePk(mints[indexStaked]),
                ocpProgram: OCP_PROGRAM,
                cmtProgram: CMT_PROGRAM,
                instructions: SYSVAR_INSTRUCTIONS_PUBKEY
              },
              instructions: [createFeePayerAccountIx],
              signers: [owner, feePayerAccount],
            }
          )
      );
    });

  });
