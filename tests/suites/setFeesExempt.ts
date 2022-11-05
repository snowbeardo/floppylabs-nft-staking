import { expect } from "chai";
import {
  web3,
  Wallet,
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
// Importing local key for tests is far from ideal. TO-DO rethink the strategy
// Using it as the fees exempt setter auth account
// It is supposed to be the same defined in fl_auth_wallet.rs: HheH5TqaQNnPUnFBETydn4dw4fsuyK75yx6otDejGe8B
import key from "../../key.json";

export const testSetFeesExempt = (
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
  describe("Setting the Fees Exempt", () => {
    setProvider(provider);

    const program = workspace.Staking as Program<Staking>;

    const n = 10;
    let mintRewards: Token,
      mints: Token[],
      holders: Keypair[],
      accounts: PublicKey[] = Array(n).fill(new PublicKey(0));
    let tree: MerkleTree;

    const indexStaked = 4;

    let stakingKey: PublicKey, owner: Keypair, stranger: Keypair;

    const startingAmount = new BN(10 ** 10);

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

      // Mint tokens to the staking
      await mintRewards.mintTo(rewards, owner, [], startingAmount.toNumber());

    });

    it("Stake and un-stake a token Fees Exempt", async () => {
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

      const feePayerAccount = Keypair.generate();
      const createFeePayerAccountIx = SystemProgram.createAccount({
        programId: program.programId,
        space: 0,
        lamports: FEES_LAMPORTS,
        fromPubkey: holders[indexStaked].publicKey,
        newAccountPubkey: feePayerAccount.publicKey
      });

      const feesBalanceBefore = await provider.connection.getBalance(FEES_ACCOUNT);

      // SET STAKING TO FEE EXEMPT
      const localWallet = new Wallet(web3.Keypair.fromSecretKey(Uint8Array.from(key)));
      await program.rpc.setFeesExempt(
        true,
        {
          accounts: {
            staking: stakingAddress,
            auth: localWallet.payer.publicKey,
          },
          signers: [localWallet.payer],
        }
      );

      const s = await program.account.staking.fetch(stakingAddress);

      expect(s.feesExempt).to.equal(true);

      // STAKE

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
      expect(a.rarityMultiplier.toString()).to.equal(new BN(indexStaked).toString());
      expect(a.lastClaim.lte(new BN(timeAfter))).to.equal(true);
      expect(a.lastClaim.gt(new BN(0))).to.equal(true);

      const feesBalanceAfterStake = await provider.connection.getBalance(FEES_ACCOUNT);
      expect(feesBalanceAfterStake - feesBalanceBefore).to.equal(0); // No fees collected

      // UNSTAKE

      const unstakeFeePayerAccount = Keypair.generate();
      const createUnstakeFeePayerAccountIx = SystemProgram.createAccount({
        programId: program.programId,
        space: 0,
        lamports: FEES_LAMPORTS,
        fromPubkey: holders[indexStaked].publicKey,
        newAccountPubkey: unstakeFeePayerAccount.publicKey
      });

      await program.rpc.unstakeNft({
        accounts: {
          staking: stakingAddress,
          escrow: escrow,
          stakedNft: stakedNft,
          staker: holders[indexStaked].publicKey,
          mint: mints[indexStaked].publicKey,
          stakerAccount: accounts[indexStaked],
          depositAccount: deposit,
          feePayerAccount: unstakeFeePayerAccount.publicKey,
          feeReceiverAccount: FEES_ACCOUNT,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        instructions: [createUnstakeFeePayerAccountIx],
        signers: [holders[indexStaked], unstakeFeePayerAccount],
      });

      const feesBalanceAfterUnstake = await provider.connection.getBalance(FEES_ACCOUNT);
      expect(feesBalanceAfterUnstake - feesBalanceAfterStake).to.equal(0); // No fees collected

      const k = await program.account.staking.fetch(stakingAddress);

      expect(k.nftsStaked.toString()).to.equal(new BN(0).toString());

      const stakerAccount = await mints[indexStaked].getOrCreateAssociatedAccountInfo(
        holders[indexStaked].publicKey
      );
      expect(stakerAccount.amount.toString()).to.equal(new BN(1).toString());

    });

    it("Fail to set free exempt from an unauthorized account", async () => {
      const [stakingAddress, stakingBump] = await PublicKey.findProgramAddress(
        [Buffer.from("staking", "utf8"), stakingKey.toBuffer()],
        program.programId
      );

      await assertFail(
        program.rpc.setFeesExempt(
        true,
        {
          accounts: {
            staking: stakingAddress,
            auth: state.owner.publicKey,
          },
          signers: [state.owner],
        }
      ));
    });

    it("Fail to set free exempt from an authorized but not signing account", async () => {
      const [stakingAddress, stakingBump] = await PublicKey.findProgramAddress(
        [Buffer.from("staking", "utf8"), stakingKey.toBuffer()],
        program.programId
      );

      const localWallet = new Wallet(web3.Keypair.fromSecretKey(Uint8Array.from(key)));
      await assertFail(
        program.rpc.setFeesExempt(
        true,
        {
          accounts: {
            staking: stakingAddress,
            auth: localWallet.payer.publicKey,  // Valid auth account
          },
          signers: [state.owner],  // Trying to fake it with a different signer
        }
      ));
    });

    it("Set Fees exempt to true and then back to false", async () => {
      const [stakingAddress, stakingBump] = await PublicKey.findProgramAddress(
        [Buffer.from("staking", "utf8"), stakingKey.toBuffer()],
        program.programId
      );

      const localWallet = new Wallet(web3.Keypair.fromSecretKey(Uint8Array.from(key)));
      await program.rpc.setFeesExempt(
        true,
        {
          accounts: {
            staking: stakingAddress,
            auth: localWallet.payer.publicKey,
          },
          signers: [localWallet.payer],
        }
      );

      const s = await program.account.staking.fetch(stakingAddress);
      expect(s.feesExempt).to.equal(true);

      await program.rpc.setFeesExempt(
        false,
        {
          accounts: {
            staking: stakingAddress,
            auth: localWallet.payer.publicKey,
          },
          signers: [localWallet.payer],
        }
      );

      const t = await program.account.staking.fetch(stakingAddress);
      expect(t.feesExempt).to.equal(false);
    });

  });
