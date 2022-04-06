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
import { airdropUsers, assertFail, merkleCollection, FEES_LAMPORTS, FEES_ACCOUNT } from "../helpers";
import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { MerkleTree } from "../helpers/merkleTree";

export const testClaimRewards = (
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
  describe("Claim rewards", () => {
    setProvider(provider);

    const program = workspace.Staking as Program<Staking>;

    const n = 10;
    let mintRewards: Token,
      mints: Token[],
      holders: Keypair[],
      accounts: PublicKey[] = Array(n).fill(new PublicKey(0));
    let tree: MerkleTree;
    let stakingKey: PublicKey, owner: Keypair, stranger: Keypair;

    const indexStaked = 4;
    const indexStakedOther = 2;

    beforeEach(async () => {
      stakingKey = Keypair.generate().publicKey;
      owner = Keypair.generate();
      stranger = Keypair.generate();

      holders = Array(n)
        .fill(0)
        .map(() => Keypair.generate());
      await airdropUsers([...holders, owner, stranger], provider);
      mintRewards = await Token.createMint(
        provider.connection,
        owner,
        owner.publicKey,
        null,
        9,
        TOKEN_PROGRAM_ID
      );
      const nfts = await merkleCollection(owner, n, provider);
      mints = nfts.mints;
      await Promise.all(
        mints.map(async (mint, i) => {
          accounts[i] = (
            await mint.getOrCreateAssociatedAccountInfo(holders[i].publicKey)
          ).address;
          const ownerAccount = (
            await mint.getOrCreateAssociatedAccountInfo(owner.publicKey)
          ).address;
          await mint.transfer(ownerAccount, accounts[i], owner, [], 1);
        })
      );
      tree = nfts.tree;

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

      const bumpsInit = {
        staking: stakingBump,
        escrow: escrowBump,
        rewards: rewardsBump,
      };

      await program.rpc.initializeStaking(
        bumpsInit,
        state.dailyRewards,
        state.start,
        tree.getRootArray(),
        {
          accounts: {
            stakingKey: stakingKey,
            staking: stakingAddress,
            escrow: escrow,
            mint: mintRewards.publicKey,
            rewardsAccount: rewards,
            owner: owner.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
          },
          signers: [owner],
        }
      );

      // Mint tokens to the staking
      await mintRewards.mintTo(rewards, owner, [], 10 ** 14);

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

      const bumpsStakedNft = {
        stakedNft: stakedNftBump,
        deposit: depositBump,
      };

      const feePayerAccount = Keypair.generate();
      const createFeePayerAccountIx = SystemProgram.createAccount({
        programId: program.programId,
        space: 0,
        lamports: FEES_LAMPORTS,
        fromPubkey: holders[indexStaked].publicKey,
        newAccountPubkey: feePayerAccount.publicKey
      });

      await program.rpc.stakeNft(
        bumpsStakedNft,
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
            feePayerAccount: feePayerAccount.publicKey,
            feeReceiverAccount: FEES_ACCOUNT,
            tokenProgram: TOKEN_PROGRAM_ID,
            clock: SYSVAR_CLOCK_PUBKEY,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
          },
          instructions: [createFeePayerAccountIx],
          signers: [holders[indexStaked], feePayerAccount],
        }
      );

      const [otherStakedNft, otherStakedNftBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("staked_nft", "utf8"),
          mints[indexStakedOther].publicKey.toBuffer(),
        ],
        program.programId
      );
      const [otherDeposit, otherDepositBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("deposit", "utf8"),
          mints[indexStakedOther].publicKey.toBuffer(),
        ],
        program.programId
      );

      const bumpsStakedNftOther = {
        stakedNft: otherStakedNftBump,
        deposit: otherDepositBump,
      };

      const feePayerAccountOther = Keypair.generate();
      const createFeePayerAccountIxOther = SystemProgram.createAccount({
        programId: program.programId,
        space: 0,
        lamports: FEES_LAMPORTS,
        fromPubkey: holders[indexStakedOther].publicKey,
        newAccountPubkey: feePayerAccountOther.publicKey
      });

      await program.rpc.stakeNft(
        bumpsStakedNftOther,
        tree.getProofArray(indexStakedOther),
        new BN(indexStakedOther),
        {
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            stakedNft: otherStakedNft,
            staker: holders[indexStakedOther].publicKey,
            mint: mints[indexStakedOther].publicKey,
            stakerAccount: accounts[indexStakedOther],
            depositAccount: otherDeposit,
            feePayerAccount: feePayerAccountOther.publicKey,
            feeReceiverAccount: FEES_ACCOUNT,
            tokenProgram: TOKEN_PROGRAM_ID,
            clock: SYSVAR_CLOCK_PUBKEY,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
          },
          instructions: [createFeePayerAccountIxOther],
          signers: [holders[indexStakedOther], feePayerAccountOther],
        }
      );
    });

    it("Claim staking rewards", async () => {
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
          mints[indexStaked].publicKey.toBuffer(),
        ],
        program.programId
      );

      const stakingBefore = await program.account.staking.fetch(stakingAddress);
      const stakedNftBefore = await program.account.stakedNft.fetch(stakedNft);
      const rewardToken = new Token(
        provider.connection,
        stakingBefore.mint,
        TOKEN_PROGRAM_ID,
        holders[indexStaked]
      );

      const [rewardsAccount] = await PublicKey.findProgramAddress(
        [
          Buffer.from("rewards", "utf8"),
          stakingBefore.key.toBuffer(),
          stakingBefore.mint.toBuffer(),
        ],
        program.programId
      );

      const stakerAccount = await rewardToken.getOrCreateAssociatedAccountInfo(
        holders[indexStaked].publicKey
      );

      const rewardsBefore = (await rewardToken.getAccountInfo(rewardsAccount))
        .amount;

      const claimFeePayerAccount = Keypair.generate();
      const createClaimFeePayerAccountIx = SystemProgram.createAccount({
        programId: program.programId,
        space: 0,
        lamports: FEES_LAMPORTS,
        fromPubkey: holders[indexStaked].publicKey,
        newAccountPubkey: claimFeePayerAccount.publicKey
      });

      const feesBalanceBefore = await provider.connection.getBalance(FEES_ACCOUNT);

      const tx = await program.rpc.claimStaking({
        accounts: {
          staking: stakingAddress,
          escrow: escrow,
          stakedNft: stakedNft,
          staker: holders[indexStaked].publicKey,
          mint: rewardToken.publicKey,
          stakerAccount: stakerAccount.address,
          rewardsAccount: rewardsAccount,
          feePayerAccount: claimFeePayerAccount.publicKey,
          feeReceiverAccount: FEES_ACCOUNT,
          tokenProgram: TOKEN_PROGRAM_ID,
          clock: SYSVAR_CLOCK_PUBKEY,
          rent: SYSVAR_RENT_PUBKEY,
          systemProgram: SystemProgram.programId,
        },
        instructions: [createClaimFeePayerAccountIx],
        signers: [holders[indexStaked], claimFeePayerAccount],
      });
      provider.connection.confirmTransaction(tx);

      const feesBalanceAfter = await provider.connection.getBalance(FEES_ACCOUNT);
      expect(feesBalanceAfter - feesBalanceBefore).to.equal(FEES_LAMPORTS);

      const j = await program.account.staking.fetch(stakingAddress);
      const a = await program.account.stakedNft.fetch(stakedNft);
      const stakerAccountAfter =
        await rewardToken.getOrCreateAssociatedAccountInfo(
          holders[indexStaked].publicKey
        );

      const rewardsAfter = (await rewardToken.getAccountInfo(rewardsAccount))
        .amount;
      const rewardsGiven = rewardsBefore.sub(rewardsAfter);

      // The rewards have been transferred to the staker
      expect(stakerAccountAfter.amount.toString()).to.equal(
        stakerAccount.amount.add(rewardsGiven).toString()
      );

      // The amount given is correct
      const elapsed = a.lastClaim.sub(stakedNftBefore.lastClaim);
      // Rarity is initialized, in the test, to the index for simplicity
      const rarityMultiplier = new BN(indexStaked);

      expect(rewardsGiven.toString()).to.equal(
        state.dailyRewards
          .mul(elapsed)
          .div(new BN(86400))
          .mul(rarityMultiplier)
          .div(new BN(100))
          .toString()
      );

      console.log(rewardsGiven);
    });

    it("Can't claim an unstaked token", async () => {
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
          mints[indexStaked + 1].publicKey.toBuffer(),
        ],
        program.programId
      );

      const stakingBefore = await program.account.staking.fetch(stakingAddress);

      const [rewardsAccount] = await PublicKey.findProgramAddress(
        [
          Buffer.from("rewards", "utf8"),
          stakingBefore.key.toBuffer(),
          stakingBefore.mint.toBuffer(),
        ],
        program.programId
      );

      const stakerAccount = await mintRewards.getOrCreateAssociatedAccountInfo(
        holders[indexStaked + 1].publicKey
      );

      const claimFeePayerAccount = Keypair.generate();
      const createClaimFeePayerAccountIx = SystemProgram.createAccount({
        programId: program.programId,
        space: 0,
        lamports: FEES_LAMPORTS,
        fromPubkey: holders[indexStaked].publicKey,
        newAccountPubkey: claimFeePayerAccount.publicKey
      });

      await assertFail(
        program.rpc.claimStaking({
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            stakedNft: stakedNft,
            staker: holders[indexStaked + 1].publicKey,
            mint: mintRewards.publicKey,
            stakerAccount: stakerAccount.address,
            rewardsAccount: rewardsAccount,
            feePayerAccount: claimFeePayerAccount.publicKey,
            feeReceiverAccount: FEES_ACCOUNT,
            tokenProgram: TOKEN_PROGRAM_ID,
            clock: SYSVAR_CLOCK_PUBKEY,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
          },
          instructions: [createClaimFeePayerAccountIx],
          signers: [holders[indexStaked + 1], claimFeePayerAccount],
        })
      );
    });

    it("Can't claim an unowned token", async () => {
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
          mints[indexStakedOther].publicKey.toBuffer(),
        ],
        program.programId
      );

      const stakingBefore = await program.account.staking.fetch(stakingAddress);

      const [rewardsAccount] = await PublicKey.findProgramAddress(
        [
          Buffer.from("rewards", "utf8"),
          stakingBefore.key.toBuffer(),
          stakingBefore.mint.toBuffer(),
        ],
        program.programId
      );

      const stakerAccount = await mintRewards.getOrCreateAssociatedAccountInfo(
        holders[indexStaked].publicKey
      );

      const claimFeePayerAccount = Keypair.generate();
      const createClaimFeePayerAccountIx = SystemProgram.createAccount({
        programId: program.programId,
        space: 0,
        lamports: FEES_LAMPORTS,
        fromPubkey: holders[indexStaked].publicKey,
        newAccountPubkey: claimFeePayerAccount.publicKey
      });

      await assertFail(
        program.rpc.claimStaking({
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            stakedNft: stakedNft,
            staker: holders[indexStaked].publicKey,
            mint: mintRewards.publicKey,
            stakerAccount: stakerAccount.address,
            rewardsAccount: rewardsAccount,
            feePayerAccount: claimFeePayerAccount.publicKey,
            feeReceiverAccount: FEES_ACCOUNT,
            tokenProgram: TOKEN_PROGRAM_ID,
            clock: SYSVAR_CLOCK_PUBKEY,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
          },
          instructions: [createClaimFeePayerAccountIx],
          signers: [holders[indexStaked], claimFeePayerAccount],
        })
      );
    });
  });
