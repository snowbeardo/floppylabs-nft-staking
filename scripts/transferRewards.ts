import fs from "fs";
import {
  Program,
  Provider,
  setProvider,
  web3,
  Wallet,
  Idl,
} from "@project-serum/anchor";
import { BN } from "@project-serum/anchor";
import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import key from "../key.json";
import deployment from "../deployment.json";
import { Staking, IDL as StakingIDL } from "../target/types/staking";
import stakingIdl from "../target/idl/staking.json";

const transferRewards = async (endpoint: string, amount: string) => {
  if (!endpoint) throw new Error("Missing endpoint argument");

  const connection = new web3.Connection(endpoint);
  const wallet = new Wallet(web3.Keypair.fromSecretKey(Uint8Array.from(key)));
  const provider = new Provider(connection, wallet, {
    preflightCommitment: "confirmed",
  });
  setProvider(provider);

  const stakingProgram = new Program<Staking>(
    StakingIDL,
    stakingIdl.metadata.address,
    provider
  );

  const [stakingAddress] = await PublicKey.findProgramAddress(
    [
      Buffer.from("staking", "utf8"),
      new PublicKey(deployment.stakingKey).toBuffer(),
    ],
    stakingProgram.programId
  );

  const staking = await stakingProgram.account.staking.fetch(stakingAddress);

  // Transfer the reward token
  const mintRewards = new Token(
    connection,
    staking.mint,
    TOKEN_PROGRAM_ID,
    wallet.payer
  );
  const ownerAccount = await mintRewards.getOrCreateAssociatedAccountInfo(
    wallet.payer.publicKey
  );
  await mintRewards.transfer(
    ownerAccount.address,
    staking.rewardsAccount,
    wallet.payer,
    [],
    new BN(amount).toNumber()
  );
};

transferRewards(process.argv[2], process.argv[3]);
