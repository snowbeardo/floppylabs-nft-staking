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
  Transaction,
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  ComputeBudgetProgram
} from "@solana/web3.js";
import { Staking } from "../../target/types/staking";
import { airdropUsers, FEES_LAMPORTS, FEES_ACCOUNT, merkleCollectionMetaplex } from "../helpers";
import { getAccount, createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { MerkleTree } from "../helpers/merkleTree";
import {
  createTestMintAndWrap,
  DEVNET_POLICY_ALL
} from "../helpers/ocpUtils";
import { TokenRecord, TokenState, MigrateInstructionAccounts, MigrateInstructionArgs, createMigrateInstruction, MigrationType } from "@metaplex-foundation/mpl-token-metadata";
import { PROGRAM_ID as TOKEN_AUTH_RULES_ID  } from "@metaplex-foundation/mpl-token-auth-rules";
import { decode } from '@msgpack/msgpack';

const OCP_PROGRAM = new PublicKey("ocp4vWUzA2z2XMYJ3QhM9vWdyoyoQwAFJhRdVTbvo9E"); // OCP Devnet
const TOKEN_METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"); // Metaplex 

export const testUnstakeMplCustodial = (
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
  describe("Custodial unstake using Transfer from MPL Token Metadata", () => {
    setProvider(provider);

    const program = workspace.Staking as Program<Staking>;

    const n = 10;
    let mintRewards: Token,
      mints: Token[],
      ruleSetPdas: PublicKey[],
      holders: Keypair[],
      ownerAccount: any;

    let tree: MerkleTree;

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
      // Contains one pNFT in position 0, and one NFT in position 1
      const nfts = await merkleCollectionMetaplex(new Wallet(owner), n, provider);
      mints = nfts.mints;
      ruleSetPdas = nfts.ruleSetPdas;
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
    
    it("Unstake a staked non pNFT token that has NOT been migrated to pNFT while staked", async () => {
      const NFTIndex = 1;

      ownerAccount = (
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          owner,
          mints[NFTIndex],
          owner.publicKey
        )
      ).address;

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
          mints[NFTIndex].toBuffer(),
        ],
        program.programId
      );

      const [deposit, depositBump] = await PublicKey.findProgramAddress(
        [
          Buffer.from("deposit", "utf8"),
          mints[NFTIndex].toBuffer(),
        ],
        program.programId
      );

      const bumps = {
        stakedNft: stakedNftBump,
        deposit: depositBump,
      };      

      const [metadataAccount] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM.toBuffer(),
          mints[NFTIndex].toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM,
      );

      const [masterEddition] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM.toBuffer(),
          mints[NFTIndex].toBuffer(),
          Buffer.from('edition'),
        ],
        TOKEN_METADATA_PROGRAM,
      );

      const [tokenRecordAccount] = await PublicKey.findProgramAddress(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM.toBuffer(),
          mints[NFTIndex].toBuffer(),
          Buffer.from('token_record'),
          ownerAccount.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM,
      );

      const [ownerTokenRecordAccount] = await PublicKey.findProgramAddress(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM.toBuffer(),
          mints[NFTIndex].toBuffer(),
          Buffer.from('token_record'),
          deposit.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM,
      );
    
      await program.rpc.stakeNft(
        bumps,
        tree.getProofArray(NFTIndex),
        new BN(NFTIndex),
        {
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            stakedNft: stakedNft,
            staker: owner.publicKey,
            mint: mints[NFTIndex],
            stakerAccount: ownerAccount,
            depositAccount: deposit,
            feeReceiverAccount: FEES_ACCOUNT,
            tokenProgram: TOKEN_PROGRAM_ID,
            clock: SYSVAR_CLOCK_PUBKEY,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
          },
          signers: [owner],
        }
      );

      const feesBalanceBefore = await provider.connection.getBalance(FEES_ACCOUNT);
      const nftsStakedBefore = (
        await program.account.staking.fetch(stakingAddress)
      ).nftsStaked;

      // Unstake
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

      await program.rpc.unstakeMplCustodial(        
        {
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            rewardsAccount: rewardsAccount,
            stakedNft: stakedNft,
            staker: owner.publicKey,
            mint: mints[NFTIndex],
            rewardsMint: mintRewards,
            stakerRewardsAccount: stakerRewardsAccount.address,
            stakerAccount: ownerAccount,
            depositAccount: deposit,
            feeReceiverAccount: FEES_ACCOUNT,
            systemProgram: SystemProgram.programId,
            masterEdition: masterEddition,
            metadata: metadataAccount,
            tokenRecord: tokenRecordAccount,
            ownerTokenRecord: ownerTokenRecordAccount,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM,
            tokenProgram: TOKEN_PROGRAM_ID,
            authorizationRulesProgram: TOKEN_AUTH_RULES_ID,
            authorizationRules: ruleSetPdas[NFTIndex],
            ataProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            clock: SYSVAR_CLOCK_PUBKEY,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY
          },
          signers: [owner],
          instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 })]
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

      ownerAccount =
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          owner,
          mints[NFTIndex],
          owner.publicKey
        )

      expect(ownerAccount.amount.toString()).to.equal(new BN(1).toString());
    });    

  });
