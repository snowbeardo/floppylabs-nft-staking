use anchor_lang::error;

#[error]
pub enum ErrorCode {
    #[msg("Too early to stake")]
    TooEarly,

    #[msg("Merkle proof is invalid")]
    InvalidProof,
}
