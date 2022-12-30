import {
  findMetadataPda,
  Metaplex,
  walletAdapterIdentity,
} from "@metaplex-foundation/js";
import {
  createCreateMetadataAccountV2Instruction,
  DataV2,
} from "@metaplex-foundation/mpl-token-metadata";
import * as anchor from "@project-serum/anchor";
import {
  AccountLayout,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  getAssociatedTokenAddress,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmRawTransaction,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  CMT_PROGRAM,
  createDynamicRoyaltyStruct,
  createInitAccountInstruction,
  createInitPolicyInstruction,
  createMintToInstruction as ocpCreateMintToInstruction,
  createWrapInstruction,
  findFreezeAuthorityPk,
  findMintStatePk,
  findPolicyPk,
  LARGER_COMPUTE_UNIT,
  process_tx,
} from "@magiceden-oss/open_creator_protocol";

export const DEVNET_POLICY_ALL = new PublicKey(
  "6Huqrb4xxmmNA4NufYdgpmspoLmjXFd3qEfteCddLgSz"
);

export async function createTestMintAndWrap(
  connection: Connection,
  wallet: anchor.Wallet,
  policy = DEVNET_POLICY_ALL
): Promise<[PublicKey, PublicKey]> {
  const metaplex = new Metaplex(connection);
  metaplex.use(walletAdapterIdentity(wallet));

  const mintKeypair = new Keypair();
  const targetTokenAccount = await getAssociatedTokenAddress(
    mintKeypair.publicKey,
    wallet.publicKey
  );

  const tx: Transaction = await createNewMintTransaction(
    connection,
    wallet.payer,
    mintKeypair,
    wallet.publicKey,
    wallet.publicKey
  );
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = wallet.publicKey;
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: LARGER_COMPUTE_UNIT }),
    createWrapInstruction({
      mint: mintKeypair.publicKey,
      policy,
      freezeAuthority: wallet.publicKey,
      mintAuthority: wallet.publicKey,
      mintState: findMintStatePk(mintKeypair.publicKey),
      from: wallet.payer.publicKey,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      cmtProgram: CMT_PROGRAM,
      metadata: findMetadataPda(mintKeypair.publicKey),
    }),
    createInitAccountInstruction({
      policy,
      freezeAuthority: findFreezeAuthorityPk(policy),
      mint: mintKeypair.publicKey,
      metadata: findMetadataPda(mintKeypair.publicKey),
      mintState: findMintStatePk(mintKeypair.publicKey),
      from: wallet.publicKey,
      fromAccount: targetTokenAccount,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      cmtProgram: CMT_PROGRAM,
      payer: wallet.publicKey,
    }),
    ocpCreateMintToInstruction({
      policy,
      freezeAuthority: findFreezeAuthorityPk(policy),
      mint: mintKeypair.publicKey,
      metadata: findMetadataPda(mintKeypair.publicKey),
      mintState: findMintStatePk(mintKeypair.publicKey),
      from: wallet.publicKey,
      fromAccount: targetTokenAccount,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      cmtProgram: CMT_PROGRAM,
      payer: wallet.publicKey,
    })
  );
  tx.partialSign(mintKeypair);
  await wallet.signTransaction(tx);
  try {
    const sig = await sendAndConfirmRawTransaction(connection, tx.serialize());
    console.log({ sig });
  } catch (e) {
    console.error(e);
  }

  return [mintKeypair.publicKey, targetTokenAccount];
}

const createNewMintTransaction = async (
  connection: Connection,
  payer: Keypair,
  mintKeypair: Keypair,
  mintAuthority: PublicKey,
  freezeAuthority: PublicKey
) => {
  //Get the minimum lamport balance to create a new account and avoid rent payments
  const requiredBalance = await getMinimumBalanceForRentExemptMint(connection);
  //metadata account associated with mint
  const metadataPDA = findMetadataPda(mintKeypair.publicKey);

  const ON_CHAIN_METADATA = {
    name: "xyzname",
    symbol: "xyz",
    uri: "example.com",
    sellerFeeBasisPoints: 500,
    creators: [
      { address: Keypair.generate().publicKey, verified: false, share: 100 },
    ],
    collection: null,
    uses: null,
  } as DataV2;

  const createNewTokenTransaction = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: MINT_SIZE,
      lamports: requiredBalance,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mintKeypair.publicKey, //Mint Address
      0, //Number of Decimals of New mint
      mintAuthority, //Mint Authority
      freezeAuthority, //Freeze Authority
      TOKEN_PROGRAM_ID
    ),
    createCreateMetadataAccountV2Instruction(
      {
        metadata: metadataPDA,
        mint: mintKeypair.publicKey,
        mintAuthority: mintAuthority,
        payer: payer.publicKey,
        updateAuthority: mintAuthority,
      },
      {
        createMetadataAccountArgsV2: {
          data: ON_CHAIN_METADATA,
          isMutable: true,
        },
      }
    )
  );

  return createNewTokenTransaction;
};