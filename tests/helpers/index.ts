import { expect } from "chai";
import { web3, Provider, BN } from "@project-serum/anchor";

import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import { PublicKey } from "@solana/web3.js";

import { MerkleTree } from "./merkleTree";

import {
  createTestMintAndWrap,
  DEVNET_POLICY_ALL
} from "../helpers/ocpUtils";

export const FEES_LAMPORTS = 10_000_000;
export const FEES_ACCOUNT: PublicKey = new PublicKey('WHduhbnLJnGNcjBhiGp58kSKMcph6G6Aaq1MiPXj7yd');

export const findAssociatedAddress = async (
  owner: web3.PublicKey,
  mint: web3.PublicKey
) => {
  return await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    mint,
    owner,
    true
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
  users: web3.Signer[],
  provider: Provider,
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
  user: web3.Signer,
  provider: Provider
) => Promise<[Token, web3.PublicKey]> = async (user, provider) => {
  let mint = await Token.createMint(
    provider.connection,
    user,
    user.publicKey,
    null,
    0,
    TOKEN_PROGRAM_ID
  );

  let account = await mint.createAccount(user.publicKey);

  await mint.mintTo(account, user, [], 1);

  return [mint, account];
};

export const merkleCollection = async (
  user: web3.Signer,
  amount: number,
  provider: Provider
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
  provider: Provider
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

export const buildLeaves = (
  data: { mint: web3.PublicKey; rarityMultiplier: number; }[]
) => {
  const leaves: Array<Buffer> = [];
  for (let idx = 0; idx < data.length; ++idx) {
    const item = data[idx];
    leaves.push(
      Buffer.from([
        ...item.mint.toBuffer(),
        ...new BN(item.rarityMultiplier).toArray("le", 8),
      ])
    );
  }

  return leaves;
};

export const mintAndTransferRewards = async (
  provider: Provider,
  programId: web3.PublicKey,
  stakingKey: web3.PublicKey,
  owner: web3.Signer,
  amount: number
) => {
  let mint = await createMint(
    provider.connection,
    owner,
    owner.publicKey,
    null,
    9
  );
  const [escrow, escrowBump] = await web3.PublicKey.findProgramAddress(
    [Buffer.from("escrow"), stakingKey.toBuffer()],
    programId
  );
  const [rewardsAccount, rewardsBump] = await web3.PublicKey.findProgramAddress(
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
