import fs from "fs";
import {
  Program,
  Provider,
  setProvider,
  web3,
  Wallet,
  Idl,
} from "@project-serum/anchor";
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
 * Migrates escrow account to new size and adds data
 */
const migrateEscrow = async (endpoint: string, stakingKey: string) => {

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

  const [escrow, escrowBump] = await PublicKey.findProgramAddress(
    [Buffer.from("escrow", "utf8"), stakingKeyPublicKey.toBuffer()],
    stakingProgram.programId
  );

  console.log("Signing key:", wallet.payer.publicKey.toString());
  console.log("Escrow key:", escrow.toString());

  await stakingProgram.rpc.migrateEscrow(
    {
      accounts: {
        stakingKey: stakingKeyPublicKey,
        escrow: escrow,
        auth: wallet.payer.publicKey,
        systemProgram: SystemProgram.programId,
      },
      signers: [wallet.payer],
    }
  );

  console.log("Escrow migrated");

};

migrateEscrow(process.argv[2], process.argv[3]);
