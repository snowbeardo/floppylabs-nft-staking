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
import { Staking, IDL as StakingIDL } from "../target/types/staking";
import stakingIdl from "../target/idl/staking.json";

const withdrawRewards = async (network: string, amount: string) => {
  if (network !== "devnet" && network !== "mainnet")
    throw new Error("Missing network argument");

  let endpoint;
  let mints = [];
  if (network === "devnet") {
    endpoint = "https://api.devnet.solana.com";
    mints = JSON.parse(fs.readFileSync("./assets/devnetMints.json").toString());
  } else if (network === "mainnet") {
    endpoint = "https://ssc-dao.genesysgo.net";
    mints = JSON.parse(
      fs.readFileSync("./assets/mainnetMints.json").toString()
    );
  }

  const connection = new web3.Connection(endpoint);
  const wallet = new Wallet(web3.Keypair.fromSecretKey(Uint8Array.from(key)));
  const provider = new Provider(connection, wallet, {
    preflightCommitment: "confirmed",
  });
  setProvider(provider);

  let deployments = JSON.parse(
    fs.readFileSync("./deployments.json").toString()
  );

  if (!Object.keys(deployments).includes(network))
    throw new Error("No previous deployments for this network");

  // Gets the reward token
  const mintRewards = new Token(
    connection,
    new PublicKey(deployments[network].stakingRewardMint),
    TOKEN_PROGRAM_ID,
    wallet.payer
  );

  const stakingProgram = new Program<Staking>(
    StakingIDL,
    stakingIdl.metadata.address,
    provider
  );

  const stakingKey = new PublicKey(deployments[network].stakingKey);
  const [stakingAddress, stakingBump] = await PublicKey.findProgramAddress(
    [Buffer.from("staking", "utf8"), stakingKey.toBuffer()],
    stakingProgram.programId
  );

  const staking = await stakingProgram.account.staking.fetch(stakingAddress);

  const ownerAccount = await mintRewards.getOrCreateAssociatedAccountInfo(
    wallet.payer.publicKey
  );

  const withdraw = new BN(amount);

  await stakingProgram.rpc.withdrawRewards(withdraw, {
        accounts: {
          staking: stakingAddress,
          escrow: staking.escrow,
          mint: mintRewards.publicKey,
          rewardsAccount: staking.rewardsAccount,
          owner: wallet.payer.publicKey,
          ownerAccount: ownerAccount.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        signers: [wallet.payer],
      });
};

withdrawRewards(process.argv[2], process.argv[3]);
