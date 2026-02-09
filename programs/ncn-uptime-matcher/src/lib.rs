use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, msg,
    program_error::ProgramError, pubkey::Pubkey,
};

mod errors;
mod instructions;
mod state;
mod uptime_pricing;

use uptime_pricing::{process_init, process_match, process_uptime_sync, process_resolve};

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    match instruction_data[0] {
        0x00 => {
            msg!("NCN-UPTIME-MATCHER: Match instruction");
            process_match(program_id, accounts, instruction_data)
        }
        0x02 => {
            msg!("NCN-UPTIME-MATCHER: Init instruction");
            process_init(program_id, accounts, instruction_data)
        }
        0x03 => {
            msg!("NCN-UPTIME-MATCHER: Uptime sync instruction");
            process_uptime_sync(program_id, accounts, instruction_data)
        }
        0x04 => {
            msg!("NCN-UPTIME-MATCHER: Resolve instruction");
            process_resolve(program_id, accounts, instruction_data)
        }
        _ => {
            msg!("NCN-UPTIME-MATCHER: Unknown instruction tag {}", instruction_data[0]);
            Err(ProgramError::InvalidInstructionData)
        }
    }
}
