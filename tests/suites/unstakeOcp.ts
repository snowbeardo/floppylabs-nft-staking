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
import { getAccount, createMint, getOrCreateAssociatedTokenAccount, mintTo, transfer, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { MerkleTree } from "../helpers/merkleTree";
import {
  createTestMintAndWrap,
  DEVNET_POLICY_ALL
} from "../helpers/ocpUtils";
import { findMintStatePk, CMT_PROGRAM } from "@magiceden-oss/open_creator_protocol";
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
  describe("Unstake a OCP", () => {
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
            feeReceiverAccount: FEES_ACCOUNT,
            clock: SYSVAR_CLOCK_PUBKEY,
            systemProgram: SystemProgram.programId,
            ocpPolicy: DEVNET_POLICY_ALL,
            metadata: findMetadataPda(mints[indexStaked]),
            ocpMintState: findMintStatePk(mints[indexStaked]),
            ocpProgram: OCP_PROGRAM,
            cmtProgram: CMT_PROGRAM,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY
          },
          signers: [owner],
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

      const feesBalanceBefore = await provider.connection.getBalance(FEES_ACCOUNT);

      const stakingBefore = await program.account.staking.fetch(stakingAddress);

      const [rewardsAccount] = await PublicKey.findProgramAddress(
        [
          Buffer.from("rewards", "utf8"),
          stakingBefore.key.toBuffer(),
          stakingBefore.mint.toBuffer(),
        ],
        program.programId
      );

      const rewardsBefore = (await getAccount(provider.connection, rewardsAccount))
        .amount;

      const stakerRewardsAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        owner,
        mintRewards,
        owner.publicKey
      );

      await program.rpc.unstakeOcp(
        {
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            rewardsAccount: rewardsAccount,
            stakedNft: stakedNft,
            staker: owner.publicKey,
            mint: mints[indexStaked],
            rewardsMint: mintRewards,
            stakerRewardsAccount: stakerRewardsAccount.address,
            feeReceiverAccount: FEES_ACCOUNT,
            systemProgram: SystemProgram.programId,
            ocpPolicy: DEVNET_POLICY_ALL,
            metadata: findMetadataPda(mints[indexStaked]),
            ocpMintState: findMintStatePk(mints[indexStaked]),
            ocpProgram: OCP_PROGRAM,
            cmtProgram: CMT_PROGRAM,
            clock: SYSVAR_CLOCK_PUBKEY,
            tokenProgram: TOKEN_PROGRAM_ID,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY
          },
          signers: [owner],
        }
      );

      // Verify claim worked
      const stakerAccountAfter =
        await getOrCreateAssociatedTokenAccount(
        provider.connection,
        owner,
        mintRewards,
        owner.publicKey
      );

      const rewardsAfter = (await getAccount(provider.connection, rewardsAccount))
        .amount;
      const rewardsGiven = Number(rewardsBefore) - Number(rewardsAfter);

      // The rewards have been transferred to the staker
      expect(Number(stakerAccountAfter.amount)).to.equal(
        Number(stakerRewardsAccount.amount) + Number(rewardsGiven)
      );            

      // Fees
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
