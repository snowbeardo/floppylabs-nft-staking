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
import { getAccount, createMint, getOrCreateAssociatedTokenAccount, mintTo, transfer, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { MerkleTree } from "../helpers/merkleTree";

export const testWithdrawRewards = (
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
  describe("Withdraw rewards", () => {
    setProvider(provider);

    const program = workspace.Staking as Program<Staking>;

    const n = 10;
    let mintRewards: Token,
      mints: Token[],
      holders: Keypair[],
      accounts: PublicKey[] = Array(n).fill(new PublicKey(0));
    let tree: MerkleTree;
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

      // Mint tokens to the staking
      await mintTo(
          provider.connection,
          owner,
          mintRewards,
          rewards,
          owner,
          startingAmount.toNumber()
      );
    });

    it("Withdraw rewards", async () => {
      const [stakingAddress, stakingBump] = await PublicKey.findProgramAddress(
        [Buffer.from("staking"), stakingKey.toBuffer()],
        program.programId
      );
      const [escrow, escrowBump] = await PublicKey.findProgramAddress(
        [Buffer.from("escrow", "utf8"), stakingKey.toBuffer()],
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

      let ownerAccount = await getOrCreateAssociatedTokenAccount(
              provider.connection,
              owner,
              mintRewards,
              owner.publicKey
      );

      const withdraw = new BN(10 ** 9);

      await program.rpc.withdrawRewards(withdraw, {
        accounts: {
          staking: stakingAddress,
          escrow: escrow,
          mint: mintRewards,
          rewardsAccount: rewards,
          owner: owner.publicKey,
          ownerAccount: ownerAccount.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        signers: [owner],
      });

      const expectedOwnerAmount = Number(withdraw) + Number(ownerAccount.amount);
      const actualOwnerAmount = Number(
        (await getAccount(provider.connection, ownerAccount.address)).amount
      );
      expect(expectedOwnerAmount).to.equal(actualOwnerAmount);

      const expectedRewardsAmount = Number(startingAmount) - Number(withdraw);
      const actualRewardsAmount = Number(
        (await getAccount(provider.connection, rewards)).amount
      );
      expect(expectedRewardsAmount).to.equal(actualRewardsAmount);
    });
  });
