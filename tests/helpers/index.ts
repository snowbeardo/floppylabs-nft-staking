import { expect } from "chai";
import * as anchor from "@project-serum/anchor";

import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
  mintTo,
  Account,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
} from "@solana/spl-token";

import { PublicKey, Signer } from "@solana/web3.js";

import { MerkleTree } from "./merkleTree";

import {
  createTestMintAndWrap,
  DEVNET_POLICY_ALL
} from "../helpers/ocpUtils";

import { mintMetaplex, mintProgrammableNft } from "./metaplexUtils"

export const FEES_LAMPORTS = 10_000_000;
export const FEES_ACCOUNT: PublicKey = new PublicKey('WHduhbnLJnGNcjBhiGp58kSKMcph6G6Aaq1MiPXj7yd');

export const findAssociatedAddress = async (
  owner: PublicKey,
  mint: PublicKey
) => {
  return await getAssociatedTokenAddress(
    mint,
    owner
  );
};

export const assertFail = async (pendingTx: Promise<any>, error?: string) => {
  const log = console.log;
  console.log = () => {};
  let success = true;
  try {
    await pendingTx;
  } catch (err) {
    success = false;
    log(err);
  } finally {
    console.log = log;
  }
  if (success) throw new Error("Should have failed");
};

export const airdropUsers = async (
  users: Signer[],
  provider: anchor.Provider,
  options?: { amount?: number }
) => {
  await Promise.all(
    users.map(
      (keypair) =>
        new Promise(async (resolve) => {
          const airdrop = await provider.connection.requestAirdrop(
            keypair.publicKey,
            options?.amount || 5 * 10 ** 9
          );
          await provider.connection.confirmTransaction(airdrop);
          resolve(true);
        })
    )
  );
};

export const airdropNft: (
  user: Signer,
  provider: anchor.Provider
) => Promise<[PublicKey, Account]> = async (user, provider) => {
  let mint = await createMint(
    provider.connection,
    user,
    user.publicKey,
    null,
    0
  );

  const ownerAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    user,
    mint,
    user.publicKey
  );
  await mintTo(
      provider.connection,
      user,
      mint,
      ownerAccount.address,
      user,
      1
  );

  return [mint, ownerAccount];
};

export const merkleCollection = async (
  user: Signer,
  amount: number,
  provider: anchor.Provider
) => {
  const mints = await Promise.all(
    Array(amount)
      .fill(0)
      .map(() =>
        createMint(
          provider.connection,
          user,
          user.publicKey,
          null,
          0
        ).then(async (token) => {
          mintTo(
            provider.connection,
            user,
            token,
            (await getOrCreateAssociatedTokenAccount(
              provider.connection,
              user,
              token,
              user.publicKey
            ))
              .address,
            user,
            1
          );
          return token;
        })
      )
  );

  const leaves = buildLeaves(
    mints.map((e, i) => ({
      mint: e,
      rarityMultiplier: i,
    }))
  );
  const tree = new MerkleTree(leaves);
  return {
    mints,
    tree,
  };
};

//TODO move from here
export const merkleCollectionOcp = async (
  wallet: anchor.Wallet,
  amount: number,
  provider: anchor.Provider
) => {
  const [tokenMint, tokenAta] = await createTestMintAndWrap(
    provider.connection,
    wallet,
    DEVNET_POLICY_ALL
  );
  expect(tokenMint.toBase58()).to.not.equal(null);
  expect(tokenAta.toBase58()).to.not.equal(null);

  const mints = [tokenMint];

  const leaves = buildLeaves(
    mints.map((e, i) => ({
      mint: e,
      rarityMultiplier: i,
    }))
  );
  const tree = new MerkleTree(leaves);
  return {
    mints,
    tree,
  };
};

//TODO move from here
export const merkleCollectionMetaplex = async (
  wallet: anchor.Wallet,
  amount: number,
  provider: anchor.Provider
) => {
  // Mint one pNFT and one NFT
  const [pNFTMint, pNFTAta, pNFTRuleSetPda] = await mintMetaplex(
    true,
    provider.connection,
    wallet
  );
  expect(pNFTMint.toBase58()).to.not.equal(null);
  expect(pNFTAta.toBase58()).to.not.equal(null);

  const [NFTMint, NFTAta, tokenMetadataProgram] = await mintMetaplex(
    false,
    provider.connection,
    wallet
  );
  expect(NFTMint.toBase58()).to.not.equal(null);
  expect(NFTAta.toBase58()).to.not.equal(null);

  const mints = [pNFTMint, NFTMint];
  const ruleSetPdas = [pNFTRuleSetPda, tokenMetadataProgram];

  const leaves = buildLeaves(
    mints.map((e, i) => ({
      mint: e,
      rarityMultiplier: i,
    }))
  );
  const tree = new MerkleTree(leaves);
  return {
    mints,
    ruleSetPdas,
    tree    
  };
};

export const buildLeaves = (
  data: { mint: PublicKey; rarityMultiplier: number; }[]
) => {
  const leaves: Array<Buffer> = [];
  for (let idx = 0; idx < data.length; ++idx) {
    const item = data[idx];
    leaves.push(
      Buffer.from([
        ...item.mint.toBuffer(),
        ...new anchor.BN(item.rarityMultiplier).toArray("le", 8),
      ])
    );
  }

  return leaves;
};

export const mintAndTransferRewards = async (
  provider: anchor.Provider,
  programId: PublicKey,
  stakingKey: PublicKey,
  owner: Signer,
  amount: number
) => {
  let mint = await createMint(
    provider.connection,
    owner,
    owner.publicKey,
    null,
    9
  );
  const [escrow, escrowBump] = await PublicKey.findProgramAddress(
    [Buffer.from("escrow"), stakingKey.toBuffer()],
    programId
  );
  const [rewardsAccount, rewardsBump] = await PublicKey.findProgramAddress(
    [Buffer.from("rewards"), stakingKey.toBuffer(), mint.toBuffer()],
    programId
  );
  const ownerAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      owner,
      mint,
      owner.publicKey
    );
  await mintTo(
      provider.connection,
      owner,
      mint,
      ownerAccount.address,
      owner,
      amount * 10 ** 9
  );

  return { mint, rewardsAccount, ownerAccount };
};
