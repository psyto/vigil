use solana_program::program_error::ProgramError;

#[derive(Debug, Clone, Copy)]
pub enum UptimeMatcherError {
    MarketResolved = 0x300,
    InvalidProbability = 0x301,
    ProbabilityNotSet = 0x302,
    OracleStale = 0x303,
    OracleMismatch = 0x304,
    InvalidOutcome = 0x305,
    InvalidSignalSeverity = 0x306,
    ArithmeticOverflow = 0x307,
}

impl From<UptimeMatcherError> for ProgramError {
    fn from(e: UptimeMatcherError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
