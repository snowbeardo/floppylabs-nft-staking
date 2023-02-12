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

export const testStakeMpl = (
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
  describe("Stake using MPL Token Metadata", () => {
    setProvider(provider);

    const program = workspace.Staking as Program<Staking>;

    const n = 10;
    let mintRewards: Token,
      mints: Token[],
      ruleSetPdas: PublicKey[],
      holders: Keypair[],
      ownerAccount: PublicKey;

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

    it("Stake a pNFT token", async () => {
      const pNFTIndex = 0;

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

      const feesBalanceBefore = await provider.connection.getBalance(FEES_ACCOUNT);

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
      
      // Verify lock worked
      const tokenRecord = await TokenRecord.fromAccountAddress(provider.connection, tokenRecordAccount);
      expect(tokenRecord.state).to.equal(TokenState.Locked);

      const a = await program.account.stakedNft.fetch(stakedNft);
      const j = await program.account.staking.fetch(stakingAddress);

      const timeAfter = Date.now() / 1000;

      expect(j.nftsStaked.toString()).to.equal(new BN(1).toString());
      expect(a.staker.toString()).to.equal(
        owner.publicKey.toString()
      );
      expect(a.mint.toString()).to.equal(
        mints[pNFTIndex].toString()
      );
      expect(a.rarityMultiplier.toString()).to.equal(new BN(pNFTIndex).toString());
      expect(a.lastClaim.lte(new BN(timeAfter))).to.equal(true);
      expect(a.lastClaim.gt(new BN(0))).to.equal(true);

      const feesBalanceAfter = await provider.connection.getBalance(FEES_ACCOUNT);
      expect(feesBalanceAfter - feesBalanceBefore).to.equal(FEES_LAMPORTS);
    });

    it("Stake a non programmable NFT token", async () => {
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

      const bumps = {
        stakedNft: stakedNftBump,
      };

      const feesBalanceBefore = await provider.connection.getBalance(FEES_ACCOUNT);

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

      const a = await program.account.stakedNft.fetch(stakedNft);
      const j = await program.account.staking.fetch(stakingAddress);

      const timeAfter = Date.now() / 1000;

      expect(j.nftsStaked.toString()).to.equal(new BN(1).toString());
      expect(a.staker.toString()).to.equal(
        owner.publicKey.toString()
      );
      expect(a.mint.toString()).to.equal(
        mints[NFTIndex].toString()
      );
      expect(a.rarityMultiplier.toString()).to.equal(new BN(NFTIndex).toString());
      expect(a.lastClaim.lte(new BN(timeAfter))).to.equal(true);
      expect(a.lastClaim.gt(new BN(0))).to.equal(true);

      const feesBalanceAfter = await provider.connection.getBalance(FEES_ACCOUNT);
      expect(feesBalanceAfter - feesBalanceBefore).to.equal(FEES_LAMPORTS);
    });

    /*it("Fails when it's too early", async () => {
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
          signers: [stranger],
        }
        )
      );
    });

    it("Can't stake without paying enough fees", async () => {

      // Empty user's wallet
      const ownerBalanceBefore = await provider.connection.getBalance(owner.publicKey);
      var transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: owner.publicKey,
            toPubkey: Keypair.generate().publicKey,
            lamports: 4980000000 //will leave 0,007 SOL in the account, as it was funded with 5 SOL
          }),
      );
      transaction.feePayer = owner.publicKey;
      let blockhashObj = await provider.connection.getRecentBlockhash();
      transaction.recentBlockhash = blockhashObj.blockhash;
      transaction.sign(owner);
      let signature = await provider.connection.sendRawTransaction(transaction.serialize());
      await provider.connection.confirmTransaction(signature);
      const ownerBalanceAfter = await provider.connection.getBalance(owner.publicKey);

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
                feeReceiverAccount: Keypair.generate().publicKey, // Not valid receiver account
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
          )
      );
    });*/

  });
