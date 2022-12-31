import { expect } from "chai";
import {
  setProvider,
  Provider,
  Program,
  workspace,
  BN,
  Wallet,
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
import { airdropUsers, assertFail, merkleCollectionOcp, FEES_LAMPORTS, FEES_ACCOUNT } from "../helpers";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, transfer, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { MerkleTree } from "../helpers/merkleTree";
import {
  createTestMintAndWrap,
  DEVNET_POLICY_ALL
} from "../helpers/ocpUtils";
import { findMintStatePk, CMT_PROGRAM, OCP_PROGRAM } from "@magiceden-oss/open_creator_protocol";
import { findMetadataPda } from "@metaplex-foundation/js";

const OCP_PROGRAM = new PublicKey("ocp4vWUzA2z2XMYJ3QhM9vWdyoyoQwAFJhRdVTbvo9E"); // OCP Devnet

export const testUnstakeOcp = (
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
  describe("Unstake a NFT", () => {
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

      // Stake one
      const [stakedNft, stakedNftBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("staked_nft", "utf8"),
          mints[indexStaked].toBuffer(),
        ],
        program.programId
      );

      const bumpsStakedNft = {
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
        bumpsStakedNft,
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

    });

    it("Unstake a token", async () => {

      let stakerAccount = (
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          owner,
          mints[0],
          owner.publicKey
        )
      );

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

      const nftsStakedBefore = (
        await program.account.staking.fetch(stakingAddress)
      ).nftsStaked;

      const unstakeFeePayerAccount = Keypair.generate();
      const createUnstakeFeePayerAccountIx = SystemProgram.createAccount({
        programId: program.programId,
        space: 0,
        lamports: FEES_LAMPORTS,
        fromPubkey: owner.publicKey,
        newAccountPubkey: unstakeFeePayerAccount.publicKey
      });

      const feesBalanceBefore = await provider.connection.getBalance(FEES_ACCOUNT);

      await program.rpc.unstakeOcp(
        {
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            stakedNft: stakedNft,
            staker: owner.publicKey,
            mint: mints[indexStaked],
            stakerAccount: ownerAccount,
            feePayerAccount: unstakeFeePayerAccount.publicKey,
            feeReceiverAccount: FEES_ACCOUNT,
            tokenProgram: TOKEN_PROGRAM_ID,
            ocpPolicy: DEVNET_POLICY_ALL,
            metadata: findMetadataPda(mints[indexStaked]),
            ocpMintState: findMintStatePk(mints[indexStaked]),
            ocpProgram: OCP_PROGRAM,
            cmtProgram: CMT_PROGRAM,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY
          },
          instructions: [createUnstakeFeePayerAccountIx],
          signers: [owner, unstakeFeePayerAccount],
        }
      );

      const feesBalanceAfter = await provider.connection.getBalance(FEES_ACCOUNT);
      expect(feesBalanceAfter - feesBalanceBefore).to.equal(FEES_LAMPORTS);

      const j = await program.account.staking.fetch(stakingAddress);

      expect(j.nftsStaked.toString()).to.equal(
        nftsStakedBefore.sub(new BN(1)).toString()
      );

      stakerAccount =
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          owner,
          mints[0],
          owner.publicKey
        )

      expect(stakerAccount.amount.toString()).to.equal(new BN(1).toString());
    });

  });
