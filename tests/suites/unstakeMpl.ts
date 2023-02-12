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
  Transaction
} from "@solana/web3.js";
import { Staking } from "../../target/types/staking";
import { airdropUsers, assertFail, merkleCollection, merkleCollectionOcp, FEES_LAMPORTS, FEES_ACCOUNT, merkleCollectionPNFT, merkleCollectionMetaplex } from "../helpers";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { MerkleTree } from "../helpers/merkleTree";
import {
  createTestMintAndWrap,
  DEVNET_POLICY_ALL
} from "../helpers/ocpUtils";
import { TokenRecord, TokenState } from "@metaplex-foundation/mpl-token-metadata";
import { PROGRAM_ID as TOKEN_AUTH_RULES_ID  } from "@metaplex-foundation/mpl-token-auth-rules";

const OCP_PROGRAM = new PublicKey("ocp4vWUzA2z2XMYJ3QhM9vWdyoyoQwAFJhRdVTbvo9E"); // OCP Devnet
const TOKEN_METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"); // Metaplex 

const pNFTIndex = 0;
const NFTIndex = 1;

export const testUnstakeMpl = (
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
  describe("Unstake using MPL Token Metadata", () => {
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

    it("Unstake a pNFT token", async () => {

      ownerAccount = (
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          owner,
          mints[pNFTIndex],
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
          mints[pNFTIndex].toBuffer(),
        ],
        program.programId
      );

      const bumps = {
        stakedNft: stakedNftBump,
      };      

      const [metadataAccount] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM.toBuffer(),
          mints[pNFTIndex].toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM,
      );

      const [masterEddition] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM.toBuffer(),
          mints[pNFTIndex].toBuffer(),
          Buffer.from('edition'),
        ],
        TOKEN_METADATA_PROGRAM,
      );

      const [tokenRecordAccount] = await PublicKey.findProgramAddress(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM.toBuffer(),
          mints[pNFTIndex].toBuffer(),
          Buffer.from('token_record'),
          ownerAccount.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM,
      );

      await program.rpc.stakeMpl(
        bumps,
        tree.getProofArray(pNFTIndex),
        new BN(pNFTIndex),
        {
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            stakedNft: stakedNft,
            staker: owner.publicKey,
            mint: mints[pNFTIndex],
            stakerAccount: ownerAccount,
            feeReceiverAccount: FEES_ACCOUNT,
            clock: SYSVAR_CLOCK_PUBKEY,
            systemProgram: SystemProgram.programId,
            masterEdition: masterEddition,
            metadata: metadataAccount,
            tokenRecord: tokenRecordAccount,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM,
            tokenProgram: TOKEN_PROGRAM_ID,
            authorizationRulesProgram: TOKEN_AUTH_RULES_ID,
            authorizationRules: ruleSetPdas[pNFTIndex],
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY
          },
          signers: [owner],
        }
      );

      // Unstake

      const nftsStakedBefore = (
        await program.account.staking.fetch(stakingAddress)
      ).nftsStaked;

      const feesBalanceBefore = await provider.connection.getBalance(FEES_ACCOUNT);      

      await program.rpc.unstakeMpl(        
        {
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            stakedNft: stakedNft,
            staker: owner.publicKey,
            mint: mints[pNFTIndex],
            stakerAccount: ownerAccount,
            feeReceiverAccount: FEES_ACCOUNT,
            systemProgram: SystemProgram.programId,
            masterEdition: masterEddition,
            metadata: metadataAccount,
            tokenRecord: tokenRecordAccount,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM,
            tokenProgram: TOKEN_PROGRAM_ID,
            authorizationRulesProgram: TOKEN_AUTH_RULES_ID,
            authorizationRules: ruleSetPdas[pNFTIndex],
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY
          },
          signers: [owner],
        }
      );

      // Verify unlock worked
      const tokenRecord = await TokenRecord.fromAccountAddress(provider.connection, tokenRecordAccount);
      expect(tokenRecord.state).to.equal(TokenState.Unlocked);

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
          mints[pNFTIndex],
          owner.publicKey
        )

      expect(ownerAccount.amount.toString()).to.equal(new BN(1).toString());
    });

    it("Unstake a NFT token", async () => {

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

      const bumps = {
        stakedNft: stakedNftBump,
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

      await program.rpc.stakeMpl(
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
            feeReceiverAccount: FEES_ACCOUNT,
            clock: SYSVAR_CLOCK_PUBKEY,
            systemProgram: SystemProgram.programId,
            masterEdition: masterEddition,
            metadata: metadataAccount,
            tokenRecord: tokenRecordAccount,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM,
            tokenProgram: TOKEN_PROGRAM_ID,
            authorizationRulesProgram: TOKEN_AUTH_RULES_ID,
            authorizationRules: ruleSetPdas[NFTIndex],
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY
          },
          signers: [owner],
        }
      );

      // Unstake

      const nftsStakedBefore = (
        await program.account.staking.fetch(stakingAddress)
      ).nftsStaked;

      const feesBalanceBefore = await provider.connection.getBalance(FEES_ACCOUNT);      

      await program.rpc.unstakeMpl(        
        {
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            stakedNft: stakedNft,
            staker: owner.publicKey,
            mint: mints[NFTIndex],
            stakerAccount: ownerAccount,
            feeReceiverAccount: FEES_ACCOUNT,
            systemProgram: SystemProgram.programId,
            masterEdition: masterEddition,
            metadata: metadataAccount,
            tokenRecord: tokenRecordAccount,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM,
            tokenProgram: TOKEN_PROGRAM_ID,
            authorizationRulesProgram: TOKEN_AUTH_RULES_ID,
            authorizationRules: ruleSetPdas[NFTIndex],
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY
          },
          signers: [owner],
        }
      );      

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

    it("Stake-Unstake-Restake a pNFT token", async () => {

      ownerAccount = (
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          owner,
          mints[pNFTIndex],
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
          mints[pNFTIndex].toBuffer(),
        ],
        program.programId
      );

      const bumps = {
        stakedNft: stakedNftBump,
      };      

      const [metadataAccount] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM.toBuffer(),
          mints[pNFTIndex].toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM,
      );

      const [masterEddition] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM.toBuffer(),
          mints[pNFTIndex].toBuffer(),
          Buffer.from('edition'),
        ],
        TOKEN_METADATA_PROGRAM,
      );

      const [tokenRecordAccount] = await PublicKey.findProgramAddress(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM.toBuffer(),
          mints[pNFTIndex].toBuffer(),
          Buffer.from('token_record'),
          ownerAccount.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM,
      );

      await program.rpc.stakeMpl(
        bumps,
        tree.getProofArray(pNFTIndex),
        new BN(pNFTIndex),
        {
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            stakedNft: stakedNft,
            staker: owner.publicKey,
            mint: mints[pNFTIndex],
            stakerAccount: ownerAccount,
            feeReceiverAccount: FEES_ACCOUNT,
            clock: SYSVAR_CLOCK_PUBKEY,
            systemProgram: SystemProgram.programId,
            masterEdition: masterEddition,
            metadata: metadataAccount,
            tokenRecord: tokenRecordAccount,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM,
            tokenProgram: TOKEN_PROGRAM_ID,
            authorizationRulesProgram: TOKEN_AUTH_RULES_ID,
            authorizationRules: ruleSetPdas[pNFTIndex],
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY
          },
          signers: [owner],
        }
      );

      // Unstake  

      await program.rpc.unstakeMpl(        
        {
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            stakedNft: stakedNft,
            staker: owner.publicKey,
            mint: mints[pNFTIndex],
            stakerAccount: ownerAccount,
            feeReceiverAccount: FEES_ACCOUNT,
            systemProgram: SystemProgram.programId,
            masterEdition: masterEddition,
            metadata: metadataAccount,
            tokenRecord: tokenRecordAccount,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM,
            tokenProgram: TOKEN_PROGRAM_ID,
            authorizationRulesProgram: TOKEN_AUTH_RULES_ID,
            authorizationRules: ruleSetPdas[pNFTIndex],
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY
          },
          signers: [owner],
        }
      );

      await program.rpc.stakeMpl(
        bumps,
        tree.getProofArray(pNFTIndex),
        new BN(pNFTIndex),
        {
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            stakedNft: stakedNft,
            staker: owner.publicKey,
            mint: mints[pNFTIndex],
            stakerAccount: ownerAccount,
            feeReceiverAccount: FEES_ACCOUNT,
            clock: SYSVAR_CLOCK_PUBKEY,
            systemProgram: SystemProgram.programId,
            masterEdition: masterEddition,
            metadata: metadataAccount,
            tokenRecord: tokenRecordAccount,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM,
            tokenProgram: TOKEN_PROGRAM_ID,
            authorizationRulesProgram: TOKEN_AUTH_RULES_ID,
            authorizationRules: ruleSetPdas[pNFTIndex],
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY
          },
          signers: [owner],
        }
      );
    });

    it("Stake-Unstake-Restake a NFT token", async () => {

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

      const bumps = {
        stakedNft: stakedNftBump,
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

      await program.rpc.stakeMpl(
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
            feeReceiverAccount: FEES_ACCOUNT,
            clock: SYSVAR_CLOCK_PUBKEY,
            systemProgram: SystemProgram.programId,
            masterEdition: masterEddition,
            metadata: metadataAccount,
            tokenRecord: tokenRecordAccount,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM,
            tokenProgram: TOKEN_PROGRAM_ID,
            authorizationRulesProgram: TOKEN_AUTH_RULES_ID,
            authorizationRules: ruleSetPdas[NFTIndex],
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY
          },
          signers: [owner],
        }
      );

      // Unstake  

      await program.rpc.unstakeMpl(        
        {
          accounts: {
            staking: stakingAddress,
            escrow: escrow,
            stakedNft: stakedNft,
            staker: owner.publicKey,
            mint: mints[NFTIndex],
            stakerAccount: ownerAccount,
            feeReceiverAccount: FEES_ACCOUNT,
            systemProgram: SystemProgram.programId,
            masterEdition: masterEddition,
            metadata: metadataAccount,
            tokenRecord: tokenRecordAccount,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM,
            tokenProgram: TOKEN_PROGRAM_ID,
            authorizationRulesProgram: TOKEN_AUTH_RULES_ID,
            authorizationRules: ruleSetPdas[NFTIndex],
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY
          },
          signers: [owner],
        }
      );

      await program.rpc.stakeMpl(
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
            feeReceiverAccount: FEES_ACCOUNT,
            clock: SYSVAR_CLOCK_PUBKEY,
            systemProgram: SystemProgram.programId,
            masterEdition: masterEddition,
            metadata: metadataAccount,
            tokenRecord: tokenRecordAccount,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM,
            tokenProgram: TOKEN_PROGRAM_ID,
            authorizationRulesProgram: TOKEN_AUTH_RULES_ID,
            authorizationRules: ruleSetPdas[NFTIndex],
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY
          },
          signers: [owner],
        }
      );
    });

  });
