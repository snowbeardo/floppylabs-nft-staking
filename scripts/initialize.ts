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
// TODO move these two out of tests
import { buildLeaves } from "../tests/helpers";
import { MerkleTree } from "../tests/helpers/merkleTree";

import key from "../key.json";
import config from "../config.json";
import { Staking, IDL } from "../target/types/staking";
import stakingIdl from "../target/idl/staking.json";

/**
 * Initializes a Staking
 * @param network The network to which the program is deployed
 */
const initialize = async (network: string) => {
  if (network !== "devnet" && network !== "mainnet")
    throw new Error("Missing network argument");

  let endpoint;
  let mints = [];
  if (network === "devnet") {
    endpoint = "https://api.devnet.solana.com";
    mints = JSON.parse(fs.readFileSync("./assets/devnetMints.json").toString());
  } else if (network === "mainnet") {
    endpoint = "https://api.mainnet-beta.solana.com";
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

  // Create the reward token
  // TODO we may want to extract the creation of the token to a different script, to reuse existing tokens
  const mintRewards = await Token.createMint(
    connection,
    wallet.payer,
    wallet.payer.publicKey,
    null,
    9,
    TOKEN_PROGRAM_ID
  );

  const stakingProgram = new Program<Staking>(
    IDL,
    stakingIdl.metadata.address,
    provider
  );

  // EDIT THE `config.json` FILE
  const stakingKey = Keypair.generate().publicKey;
  const totalSupply = new BN(config.totalSupply);
  const maxMultiplier = new BN(config.maxMultiplier);
  const maxRarity = new BN(config.maxRarity);
  const baseWeeklyEmissions = new BN(config.weeklyRewards).mul(new BN(10 ** 9));
  const start = new BN(config.start);

  const leaves = buildLeaves(
    mints.map((e, i) => ({
      mint: new PublicKey(e.mint),
      rarity: e.rarity,
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
  console.log("Staking:", stakingAddress.toString());
  console.log("Escrow:", escrow.toString());

  try {
    const bumps = {
      staking: stakingBump,
      escrow: escrowBump,
      rewards: rewardsBump,
    };

    await stakingProgram.rpc.initializeJungle(
      bumps,
      maxRarity,
      maxMultiplier,
      baseWeeklyEmissions,
      start,
      tree.getRootArray(),
      {
        accounts: {
          stakingKey: stakingKey,
          staking: stakingAddress,
          escrow: escrow,
          mint: mintRewards.publicKey,
          rewardsAccount: rewards,
          owner: wallet.payer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          systemProgram: SystemProgram.programId,
        },
        signers: [wallet.payer],
      }
    );
  } catch (err) {
    console.log("Staking already existed? Trying to Set it instead...");
    console.log(err);
    await stakingProgram.rpc.setStaking(
      maxRarity,
      maxMultiplier,
      baseWeeklyEmissions,
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
  }

  // Mint the supply to the owner
  const ownerAccount = await mintRewards.getOrCreateAssociatedAccountInfo(
    wallet.publicKey
  );
  await mintRewards.mintTo(
    ownerAccount.address,
    wallet.payer,
    [],
    totalSupply.mul(new BN(10 ** 9)).toNumber()
  );

  // Send token to the distributor
  await mintRewards.transfer(
    ownerAccount.address,
    rewards,
    wallet.payer,
    [],
    totalSupply
      .mul(new BN(10 ** 9))
      .div(new BN(2))
      .toNumber()
  );
  console.log("Gave rewards to the Staking rewards account. Half of total supply.");

  let deployments = {};
  try {
    deployments = JSON.parse(fs.readFileSync("./deployments.json").toString());
  } catch (err) {}

  deployments[network] = {
    stakingProgram: stakingIdl.metadata.address.toString(),
    stakingKey: stakingKey.toString(),
    stakingEscrowKey: escrow.toString(),
    stakingRewardMint: mintRewards.publicKey.toString(),
  };

  fs.writeFileSync("./deployments.json", JSON.stringify(deployments, null, 2));
};

initialize(process.argv[2]);
