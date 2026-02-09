use solana_program::program_error::ProgramError;

#[derive(Debug, Clone, Copy)]
pub enum YieldMatcherError {
    OracleNotSynced = 0x30,
    OracleStale = 0x31,
    OracleAccountMismatch = 0x32,
    InvalidRegime = 0x33,
    ArithmeticOverflow = 0x34,
}

impl From<YieldMatcherError> for ProgramError {
    fn from(e: YieldMatcherError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
