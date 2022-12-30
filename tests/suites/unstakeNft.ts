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
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, transfer, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { MerkleTree } from "../helpers/merkleTree";

export const testUnstakeNft = (
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
      accounts: PublicKey[] = Array(n).fill(new PublicKey(0));
    let tree: MerkleTree;
    let stakingKey: PublicKey, owner: Keypair, stranger: Keypair;

    const indexStaked = 4;

    beforeEach(async () => {
      stakingKey = Keypair.generate().publicKey
      owner = Keypair.generate()
      stranger = Keypair.generate()

      holders = Array(n)
        .fill(0)
        .map(() => Keypair.generate());
      await airdropUsers([...holders, owner, stranger], provider);
      mintRewards = await createMint(
        provider.connection,
        owner,
        owner.publicKey,
        null,
        9
      );
      const nfts = await merkleCollection(owner, n, provider);
      mints = nfts.mints;
      await Promise.all(
        mints.map(async (mint, i) => {
          accounts[i] = (
            await getOrCreateAssociatedTokenAccount(
              provider.connection,
              holders[i],
              mint,
              holders[i].publicKey
            )
          ).address;
          const ownerAccount = (
            await getOrCreateAssociatedTokenAccount(
              provider.connection,
              owner,
              mint,
              owner.publicKey
            )
          ).address;
          await transfer(
            provider.connection,
            owner,
            ownerAccount,
            accounts[i],
            owner,
            1
          );
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
          mintRewards.toBuffer(),
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
            mint: mintRewards,
            rewardsAccount: rewards,
            owner: owner.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
          },
          signers: [owner],
        }
      );
      
      const [stakedNft, stakedNftBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("staked_nft", "utf8"),
          mints[indexStaked].toBuffer(),
        ],
        program.programId
      );
      const [deposit, depositBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("deposit", "utf8"),
          mints[indexStaked].toBuffer(),
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
            mint: mints[indexStaked],
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
    });

    it("Unstake a token", async () => {
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
      const [deposit, depositBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("deposit", "utf8"),
          mints[indexStaked].toBuffer(),
        ],
        program.programId
      );

      let stakerAccount =
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          holders[indexStaked],
          mints[indexStaked],
          holders[indexStaked].publicKey
        );

      const nftsStakedBefore = (
        await program.account.staking.fetch(stakingAddress)
      ).nftsStaked;

      const unstakeFeePayerAccount = Keypair.generate();
      const createUnstakeFeePayerAccountIx = SystemProgram.createAccount({
        programId: program.programId,
        space: 0,
        lamports: FEES_LAMPORTS,
        fromPubkey: holders[indexStaked].publicKey,
        newAccountPubkey: unstakeFeePayerAccount.publicKey
      });

      const feesBalanceBefore = await provider.connection.getBalance(FEES_ACCOUNT);

      await program.rpc.unstakeNft({
        accounts: {
          staking: stakingAddress,
          escrow: escrow,
          stakedNft: stakedNft,
          staker: holders[indexStaked].publicKey,
          mint: mints[indexStaked],
          stakerAccount: stakerAccount.address,
          depositAccount: deposit,
          feePayerAccount: unstakeFeePayerAccount.publicKey,
          feeReceiverAccount: FEES_ACCOUNT,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        instructions: [createUnstakeFeePayerAccountIx],
        signers: [holders[indexStaked], unstakeFeePayerAccount],
      });

      const feesBalanceAfter = await provider.connection.getBalance(FEES_ACCOUNT);
      expect(feesBalanceAfter - feesBalanceBefore).to.equal(FEES_LAMPORTS);

      const j = await program.account.staking.fetch(stakingAddress);

      expect(j.nftsStaked.toString()).to.equal(
        nftsStakedBefore.sub(new BN(1)).toString()
      );

      stakerAccount =
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          holders[indexStaked],
          mints[indexStaked],
          holders[indexStaked].publicKey
        );

      expect(stakerAccount.amount.toString()).to.equal(new BN(1).toString());
    });

    it("Can't unstake an unowned token", async () => {
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
      const [deposit, depositBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("deposit", "utf8"),
          mints[indexStaked].toBuffer(),
        ],
        program.programId
      );

      const bumps = {
        stakedNft: stakedNftBump,
        deposit: depositBump,
      };

      const stakerAccount =
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          stranger,
          mints[indexStaked],
          stranger.publicKey
        );

      const unstakeFeePayerAccount = Keypair.generate();
      const createUnstakeFeePayerAccountIx = SystemProgram.createAccount({
        programId: program.programId,
        space: 0,
        lamports: FEES_LAMPORTS,
        fromPubkey: stranger.publicKey,
        newAccountPubkey: unstakeFeePayerAccount.publicKey
      });

      await assertFail(
        program.rpc.unstakeNft({
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            stakedNft: stakedNft,
            staker: stranger.publicKey,
            mint: mints[indexStaked],
            stakerAccount: stakerAccount.address,
            depositAccount: deposit,
            feePayerAccount: unstakeFeePayerAccount.publicKey,
            feeReceiverAccount: FEES_ACCOUNT,
            tokenProgram: TOKEN_PROGRAM_ID,
          },
          instructions: [createUnstakeFeePayerAccountIx],
          signers: [stranger, unstakeFeePayerAccount],
        })
      );
    });
  });
