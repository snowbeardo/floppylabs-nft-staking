use anchor_lang::error_code;

#[error_code]
pub enum StakingError {
    #[msg("Too early to stake")]
    TooEarly,

    #[msg("Merkle proof is invalid")]
    InvalidProof,

    #[msg("Transaction fee payment failed")]
    InvalidFee,

    #[msg("Could not determine token standard")]
    CouldNotDetermineTokenStandard,
}
