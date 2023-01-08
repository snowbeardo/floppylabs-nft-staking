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
import { getAccount, createMint, getOrCreateAssociatedTokenAccount, mintTo, transfer, TOKEN_PROGRAM_ID } from "@solana/spl-token";
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

    const dailyRewards = new BN(604800000000);

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
        dailyRewards,
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

      // Mint tokens to the rewards wallet
      await mintTo(
          provider.connection,
          owner,
          mintRewards,
          rewards,
          owner,
          10 ** 14
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
            feeReceiverAccount: FEES_ACCOUNT,
            tokenProgram: TOKEN_PROGRAM_ID,
            clock: SYSVAR_CLOCK_PUBKEY,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
          },
          signers: [holders[indexStaked]],
        }
      );

      const [otherStakedNft, otherStakedNftBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("staked_nft", "utf8"),
          mints[indexStakedOther].toBuffer(),
        ],
        program.programId
      );
      const [otherDeposit, otherDepositBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("deposit", "utf8"),
          mints[indexStakedOther].toBuffer(),
        ],
        program.programId
      );

      const bumpsStakedNftOther = {
        stakedNft: otherStakedNftBump,
        deposit: otherDepositBump,
      };

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
            mint: mints[indexStakedOther],
            stakerAccount: accounts[indexStakedOther],
            depositAccount: otherDeposit,
            feeReceiverAccount: FEES_ACCOUNT,
            tokenProgram: TOKEN_PROGRAM_ID,
            clock: SYSVAR_CLOCK_PUBKEY,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
          },
          signers: [holders[indexStakedOther]],
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
          mints[indexStaked].toBuffer(),
        ],
        program.programId
      );

      const stakingBefore = await program.account.staking.fetch(stakingAddress);
      const stakedNftBefore = await program.account.stakedNft.fetch(stakedNft);

      const [rewardsAccount] = await PublicKey.findProgramAddress(
        [
          Buffer.from("rewards", "utf8"),
          stakingBefore.key.toBuffer(),
          stakingBefore.mint.toBuffer(),
        ],
        program.programId
      );

      const stakerAccount =
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          holders[indexStaked],
          mintRewards,
          holders[indexStaked].publicKey
        );

      const rewardsBefore = (await getAccount(provider.connection, rewardsAccount))
        .amount;

      const feesBalanceBefore = await provider.connection.getBalance(FEES_ACCOUNT);

      const tx = await program.rpc.claimStaking({
        accounts: {
          staking: stakingAddress,
          escrow: escrow,
          stakedNft: stakedNft,
          staker: holders[indexStaked].publicKey,
          mint: mintRewards,
          stakerAccount: stakerAccount.address,
          rewardsAccount: rewardsAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          clock: SYSVAR_CLOCK_PUBKEY,
          rent: SYSVAR_RENT_PUBKEY,
          systemProgram: SystemProgram.programId,
        },
        signers: [holders[indexStaked]],
      });
      provider.connection.confirmTransaction(tx);

      const feesBalanceAfter = await provider.connection.getBalance(FEES_ACCOUNT);
      expect(feesBalanceAfter).to.equal(feesBalanceBefore); // No fees charged on CLAIM

      const j = await program.account.staking.fetch(stakingAddress);
      const a = await program.account.stakedNft.fetch(stakedNft);
      const stakerAccountAfter =
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          holders[indexStaked],
          mintRewards,
          holders[indexStaked].publicKey
        );

      const rewardsAfter = (await getAccount(provider.connection, rewardsAccount))
        .amount;
      const rewardsGiven = Number(rewardsBefore) - Number(rewardsAfter);

      // The rewards have been transferred to the staker
      expect(Number(stakerAccountAfter.amount)).to.equal(
        Number(stakerAccount.amount) + Number(rewardsGiven)
      );

      // The amount given is correct
      const elapsed = a.lastClaim.sub(stakedNftBefore.lastClaim);
      // Rarity is initialized, in the test, to the index for simplicity
      const rarityMultiplier = new BN(indexStaked);

      expect(rewardsGiven.toString()).to.equal(
        dailyRewards
          .mul(elapsed)
          .div(new BN(86400))
          .mul(rarityMultiplier)
          .div(new BN(100))
          .toString()
      );
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
          mints[indexStaked + 1].toBuffer(),
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

      const stakerAccount = await getOrCreateAssociatedTokenAccount(
          provider.connection,
          holders[indexStaked + 1],
          mintRewards,
          holders[indexStaked + 1].publicKey
        );

      await assertFail(
        program.rpc.claimStaking({
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            stakedNft: stakedNft,
            staker: holders[indexStaked + 1].publicKey,
            mint: mintRewards,
            stakerAccount: stakerAccount.address,
            rewardsAccount: rewardsAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            clock: SYSVAR_CLOCK_PUBKEY,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
          },
          signers: [holders[indexStaked + 1]],
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
          mints[indexStakedOther].toBuffer(),
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

      const stakerAccount = await getOrCreateAssociatedTokenAccount(
          provider.connection,
          holders[indexStaked],
          mintRewards,
          holders[indexStaked].publicKey
        );

      await assertFail(
        program.rpc.claimStaking({
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            stakedNft: stakedNft,
            staker: holders[indexStaked].publicKey,
            mint: mintRewards,
            stakerAccount: stakerAccount.address,
            rewardsAccount: rewardsAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            clock: SYSVAR_CLOCK_PUBKEY,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
          },
          signers: [holders[indexStaked]],
        })
      );
    });
  });
