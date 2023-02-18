import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { Metaplex, PublicKeyValues, toBigNumber, walletAdapterIdentity } from "@metaplex-foundation/js";
import { TokenStandard } from '@metaplex-foundation/mpl-token-metadata';
import * as anchor from "@project-serum/anchor";
import {
  getAssociatedTokenAddress
} from "@solana/spl-token";
import { 
  CreateOrUpdateInstructionAccounts,
  CreateOrUpdateInstructionArgs,
  createCreateOrUpdateInstruction,
  PROGRAM_ID as TOKEN_AUTH_RULES_ID  } from "@metaplex-foundation/mpl-token-auth-rules";
import { encode } from '@msgpack/msgpack';
const TOKEN_METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"); // Metaplex 

const CONFIG = {
  imgName: "pNFT Floppy Key",
  symbol: "pKey",
  metadata: "https://arweave.net/drt4FYPXgD1H7TJIUb34zySyR3ZQQH1x8zsJiMtVJwU",
  sellerFeeBasisPoints: 500,
  creators: [
    { address: Keypair.generate().publicKey, verified: false, share: 100 },
  ],
};

export async function mintMetaplex(
  isProgrammable: boolean,
  connection: Connection,
  wallet: anchor.Wallet,
):Promise<[PublicKey, PublicKey, PublicKey]> { {
  //console.log(`Minting NFT, programmable: ` + isProgrammable);
  const metaplex = new Metaplex(connection);
  metaplex.use(walletAdapterIdentity(wallet));
  try {
    // Default to TOKEN_METADATA_PROGRAM, as it is the one to be passed when there is no actual ruleset
    let ruleSetPda: PublicKey = TOKEN_METADATA_PROGRAM;
    if (isProgrammable) {
      //ruleSetPda = new PublicKey("eBJLFYPxJmMGKuFwpDWkzxZeUrad92kZRC5BJLpzyT9"); // Metaplex defaulta allowlist
      ruleSetPda = new PublicKey("EkHNhudhddaY5nj7exQzJmCzU2xQQLFCGAXHXZqZHBPg"); // FloppyLabs custom allowlist
    }

    const transactionBuilder = await metaplex
    .nfts()
    .builders()
    .create({
        uri: CONFIG.metadata,
        name: CONFIG.imgName,
        sellerFeeBasisPoints: CONFIG.sellerFeeBasisPoints,
        symbol: CONFIG.symbol,
        creators: CONFIG.creators,
        isMutable: true,
        isCollection: false,
        maxSupply: toBigNumber(1),
        tokenStandard: isProgrammable? TokenStandard.ProgrammableNonFungible : TokenStandard.NonFungible,
        ruleSet: ruleSetPda
    });

    let { signature, confirmResponse } = await metaplex.rpc().sendAndConfirmTransaction(transactionBuilder);
    if (confirmResponse.value.err) {
        throw new Error('failed to confirm transaction');
    }
    const { mintAddress } = transactionBuilder.getContext();
    //console.log(`   Minted NFT: https://explorer.solana.com/address/${mintAddress.toString()}?cluster=devnet`);

    const targetTokenAccount = await getAssociatedTokenAddress(
      mintAddress,
      wallet.publicKey
    );

    return [mintAddress, targetTokenAccount, ruleSetPda];
  }
  catch (err) {
      console.log(err);
  }
}

}