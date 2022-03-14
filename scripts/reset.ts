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
import { buildLeaves } from "../tests/helpers";
import { MerkleTree } from "../tests/helpers/merkleTree";

import key from "../key.json";
import config from "../config.json";
import { Staking, IDL as StakingIDL } from "../target/types/staking";
import stakingIdl from "../target/idl/staking.json";

/**
 * Sets an already existing Staking
 * @param network The network to which the program is deployed
 */
const reset = async (network: string) => {
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

  // EDIT THE `config.json` FILE
  const stakingKey = new PublicKey(deployments[network].stakingKey);
  const totalSupply = new BN(config.totalSupply);
  const dailyRewards = new BN(config.dailyRewards).mul(new BN(10 ** 9));
  const start = new BN(config.start);

  const leaves = buildLeaves(
    mints.map((e, i) => ({
      mint: new PublicKey(e.mint),
      rarityMultiplier: e.rarityMultiplier,
    }))
  );
  const tree = new MerkleTree(leaves);

  const [stakingAddress, stakingBump] = await PublicKey.findProgramAddress(
    [Buffer.from("staking", "utf8"), stakingKey.toBuffer()],
    stakingProgram.programId
  );
  const [escrow, escrowBump] = await PublicKey.findProgramAddress(
    [Buffer.from("escrow", "utf8"), stakingKey.toBuffer()],
    stakingProgram.programId
  );
  const [rewards, rewardsBump] = await PublicKey.findProgramAddress(
    [
      Buffer.from("rewards", "utf8"),
      stakingKey.toBuffer(),
      mintRewards.publicKey.toBuffer(),
    ],
    stakingProgram.programId
  );

  console.log("Staking key:", stakingKey.toString());
  console.log("Owner:", wallet.payer.publicKey.toString());
  console.log("Program ID:", stakingProgram.programId.toString());
  console.log("Staking Address:", stakingAddress.toString());
  console.log("Escrow Account:", escrow.toString());
  console.log("Rewards Account (owned by escrow):", rewards.toString());
  console.log("Rewards Mint (SPL Token Address):", mintRewards.publicKey.toString());

  await stakingProgram.rpc.setStaking(
    dailyRewards,
    start,
    tree.getRootArray(),
    {
      accounts: {
        staking: stakingAddress,
        owner: wallet.payer.publicKey,
        newOwner: wallet.payer.publicKey,
      },
      signers: [wallet.payer],
    }
  );

};

reset(process.argv[2]);
