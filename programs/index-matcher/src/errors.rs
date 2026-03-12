use solana_program::program_error::ProgramError;

#[derive(Debug, Clone, Copy)]
pub enum IndexMatcherError {
    OracleNotSynced = 0x40,
    OracleStale = 0x41,
    OracleAccountMismatch = 0x42,
    InvalidRegime = 0x43,
    ArithmeticOverflow = 0x44,
    InsufficientNcnCount = 0x45,
}

impl From<IndexMatcherError> for ProgramError {
    fn from(e: IndexMatcherError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
