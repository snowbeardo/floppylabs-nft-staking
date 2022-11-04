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
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";

import key from "../key_fees_auth.json";
import { Staking, IDL as StakingIDL } from "../target/types/staking";
import stakingIdl from "../target/idl/staking.json";

/**
 * Migrates staking account to new size
 */
const migrateStaking = async (endpoint: string, stakingKey: string) => {

  const connection = new web3.Connection(endpoint);
  const wallet = new Wallet(web3.Keypair.fromSecretKey(Uint8Array.from(key)));
  const provider = new Provider(connection, wallet, {
    preflightCommitment: "confirmed",
  });
  setProvider(provider);

  const stakingProgram = new Program<Staking>(
    StakingIDL,
    new PublicKey("BtDDM9Nve5JXUVvDg8wmLDVwzgGB8pJ6oum4fGRKM8Av"),
    provider
  );

  const stakingKeyPublicKey = new PublicKey(stakingKey);

  const [stakingAddress, stakingBump] = await PublicKey.findProgramAddress(
    [Buffer.from("staking", "utf8"), stakingKeyPublicKey.toBuffer()],
    stakingProgram.programId
  );

  console.log("Staking key:", stakingKeyPublicKey.toString());
  console.log("Signing key:", wallet.payer.publicKey.toString());

  await stakingProgram.rpc.migrateStaking(
    {
      accounts: {
        staking: stakingAddress,
        auth: wallet.payer.publicKey,
        systemProgram: SystemProgram.programId,
      },
      signers: [wallet.payer],
    }
  );

  console.log("Staking migrated");

};

migrateStaking(process.argv[2], process.argv[3]);
