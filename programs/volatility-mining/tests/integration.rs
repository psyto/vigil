use anchor_lang::{prelude::*, AccountDeserialize};
use sha2::{Sha256, Digest};
use solana_program_test::*;
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    program_pack::Pack,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_program,
    transaction::Transaction,
};

use volatility_mining::state::*;

const MINING_PROGRAM_ID: Pubkey = volatility_mining::ID;

// =============================================================================
// Helpers
// =============================================================================

fn anchor_discriminator(name: &str) -> Vec<u8> {
    let hash = Sha256::digest(format!("global:{}", name).as_bytes());
    hash[..8].to_vec()
}

fn program_test() -> ProgramTest {
    ProgramTest::new(
        "volatility_mining",
        MINING_PROGRAM_ID,
        None, // Load from target/deploy/volatility_mining.so
    )
}

/// Deserialize an Anchor account, skipping the 8-byte discriminator
fn deser_account<T: AccountDeserialize>(data: &[u8]) -> T {
    T::try_deserialize(&mut &data[..]).unwrap()
}

/// Create an SPL Token mint
async fn create_mint(
    banks_client: &mut BanksClient,
    payer: &Keypair,
    mint: &Keypair,
    decimals: u8,
) {
    let rent = banks_client.get_rent().await.unwrap();
    let mint_rent = rent.minimum_balance(spl_token::state::Mint::LEN);

    let create_account_ix = solana_sdk::system_instruction::create_account(
        &payer.pubkey(),
        &mint.pubkey(),
        mint_rent,
        spl_token::state::Mint::LEN as u64,
        &spl_token::ID,
    );
    let init_mint_ix = spl_token::instruction::initialize_mint(
        &spl_token::ID,
        &mint.pubkey(),
        &payer.pubkey(),
        None,
        decimals,
    )
    .unwrap();

    let bh = banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(
        &[create_account_ix, init_mint_ix],
        Some(&payer.pubkey()),
        &[payer, mint],
        bh,
    );
    banks_client.process_transaction(tx).await.unwrap();
}

/// Create a token account
async fn create_token_account(
    banks_client: &mut BanksClient,
    payer: &Keypair,
    account: &Keypair,
    mint: &Pubkey,
    owner: &Pubkey,
) {
    let rent = banks_client.get_rent().await.unwrap();
    let token_rent = rent.minimum_balance(spl_token::state::Account::LEN);

    let create_account_ix = solana_sdk::system_instruction::create_account(
        &payer.pubkey(),
        &account.pubkey(),
        token_rent,
        spl_token::state::Account::LEN as u64,
        &spl_token::ID,
    );
    let init_account_ix = spl_token::instruction::initialize_account(
        &spl_token::ID,
        &account.pubkey(),
        mint,
        owner,
    )
    .unwrap();

    let bh = banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(
        &[create_account_ix, init_account_ix],
        Some(&payer.pubkey()),
        &[payer, account],
        bh,
    );
    banks_client.process_transaction(tx).await.unwrap();
}

/// Mint tokens to a token account
async fn mint_to(
    banks_client: &mut BanksClient,
    payer: &Keypair,
    mint: &Pubkey,
    dest: &Pubkey,
    amount: u64,
) {
    let ix = spl_token::instruction::mint_to(
        &spl_token::ID,
        mint,
        dest,
        &payer.pubkey(),
        &[],
        amount,
    )
    .unwrap();
    let bh = banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[payer], bh);
    banks_client.process_transaction(tx).await.unwrap();
}

/// Get token balance
async fn get_token_balance(banks_client: &mut BanksClient, account: &Pubkey) -> u64 {
    let account_data = banks_client.get_account(*account).await.unwrap().unwrap();
    let token_account = spl_token::state::Account::unpack(&account_data.data).unwrap();
    token_account.amount
}

// =============================================================================
// Instruction Builders
// =============================================================================

fn build_init_mining_ix(
    authority: Pubkey,
    reward_mint: Pubkey,
    reward_vault: Pubkey,
    emission_rate: u64,
    regime_multipliers: [u64; 5],
    min_duration: u64,
    epoch_duration: u64,
) -> Instruction {
    let (config_pda, _) = Pubkey::find_program_address(
        &[b"mining_config"],
        &MINING_PROGRAM_ID,
    );

    let mut data = anchor_discriminator("initialize_mining");
    data.extend_from_slice(&emission_rate.to_le_bytes());
    for m in &regime_multipliers {
        data.extend_from_slice(&m.to_le_bytes());
    }
    data.extend_from_slice(&min_duration.to_le_bytes());
    data.extend_from_slice(&epoch_duration.to_le_bytes());

    Instruction {
        program_id: MINING_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(authority, true),
            AccountMeta::new_readonly(reward_mint, false),
            AccountMeta::new_readonly(reward_vault, false),
            AccountMeta::new(config_pda, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    }
}

fn build_register_lp_ix(
    owner: Pubkey,
    lp_pda: Pubkey,
    matcher_context: Pubkey,
    config_pda: Pubkey,
    matcher_type: u8,
) -> Instruction {
    let (lp_stake_pda, _) = Pubkey::find_program_address(
        &[b"lp_stake", lp_pda.as_ref()],
        &MINING_PROGRAM_ID,
    );

    let mut data = anchor_discriminator("register_lp");
    data.push(matcher_type);

    Instruction {
        program_id: MINING_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(owner, true),
            AccountMeta::new_readonly(lp_pda, false),
            AccountMeta::new_readonly(matcher_context, false),
            AccountMeta::new(config_pda, false),
            AccountMeta::new(lp_stake_pda, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    }
}

fn build_record_participation_ix(
    authority: Pubkey,
    config_pda: Pubkey,
    lp_stake_pda: Pubkey,
    current_regime: u8,
    current_liquidity_e6: u128,
) -> Instruction {
    let mut data = anchor_discriminator("record_participation");
    data.push(current_regime);
    data.extend_from_slice(&current_liquidity_e6.to_le_bytes());

    Instruction {
        program_id: MINING_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(authority, true),
            AccountMeta::new(config_pda, false),
            AccountMeta::new(lp_stake_pda, false),
        ],
        data,
    }
}

fn build_finalize_epoch_ix(
    payer: Pubkey,
    config_pda: Pubkey,
    current_epoch: u64,
) -> Instruction {
    let (snapshot_pda, _) = Pubkey::find_program_address(
        &[b"epoch_snapshot", &current_epoch.to_le_bytes()],
        &MINING_PROGRAM_ID,
    );

    let data = anchor_discriminator("finalize_epoch");

    Instruction {
        program_id: MINING_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(config_pda, false),
            AccountMeta::new(snapshot_pda, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    }
}

fn build_claim_rewards_ix(
    owner: Pubkey,
    config_pda: Pubkey,
    lp_stake_pda: Pubkey,
    epoch_snapshot_pda: Pubkey,
    reward_vault: Pubkey,
    owner_token_account: Pubkey,
) -> Instruction {
    let data = anchor_discriminator("claim_rewards");

    Instruction {
        program_id: MINING_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(owner, true),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new(lp_stake_pda, false),
            AccountMeta::new(epoch_snapshot_pda, false),
            AccountMeta::new(reward_vault, false),
            AccountMeta::new(owner_token_account, false),
            AccountMeta::new_readonly(spl_token::ID, false),
        ],
        data,
    }
}

fn build_fund_rewards_ix(
    funder: Pubkey,
    reward_vault: Pubkey,
    funder_token_account: Pubkey,
    config_pda: Pubkey,
    amount: u64,
) -> Instruction {
    let mut data = anchor_discriminator("fund_rewards");
    data.extend_from_slice(&amount.to_le_bytes());

    Instruction {
        program_id: MINING_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(funder, true),
            AccountMeta::new(reward_vault, false),
            AccountMeta::new(funder_token_account, false),
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new_readonly(spl_token::ID, false),
        ],
        data,
    }
}

// =============================================================================
// Tests: Mining Config
// =============================================================================

#[tokio::test]
async fn test_init_mining_config() {
    let mut pt = program_test();
    let (mut banks_client, payer, _recent_blockhash) = pt.start().await;

    let mint = Keypair::new();
    create_mint(&mut banks_client, &payer, &mint, 6).await;

    let (config_pda, _) = Pubkey::find_program_address(
        &[b"mining_config"],
        &MINING_PROGRAM_ID,
    );

    // Create reward vault owned by the mining config PDA
    let vault = Keypair::new();
    create_token_account(&mut banks_client, &payer, &vault, &mint.pubkey(), &config_pda).await;

    let ix = build_init_mining_ix(
        payer.pubkey(),
        mint.pubkey(),
        vault.pubkey(),
        1000,                           // 1000 tokens per slot
        [50, 75, 100, 200, 400],       // regime multipliers
        100,                            // min 100 slots
        1000,                           // 1000 slot epochs
    );
    let bh = banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], bh);
    banks_client.process_transaction(tx).await.unwrap();

    // Verify config
    let account = banks_client.get_account(config_pda).await.unwrap().unwrap();
    let config: MiningConfig = deser_account(&account.data);

    assert_eq!(config.authority, payer.pubkey());
    assert_eq!(config.reward_mint, mint.pubkey());
    assert_eq!(config.reward_vault, vault.pubkey());
    assert_eq!(config.emission_rate_per_slot, 1000);
    assert_eq!(config.regime_multipliers, [50, 75, 100, 200, 400]);
    assert_eq!(config.min_duration_slots, 100);
    assert_eq!(config.epoch_duration_slots, 1000);
    assert_eq!(config.current_epoch, 0);
    assert_eq!(config.total_reward_weight, 0);
    assert_eq!(config.registered_lp_count, 0);
    assert!(config.is_active);
}

// =============================================================================
// Tests: LP Registration
// =============================================================================

#[tokio::test]
async fn test_register_lp() {
    let mut pt = program_test();
    let (mut banks_client, payer, _recent_blockhash) = pt.start().await;

    let mint = Keypair::new();
    create_mint(&mut banks_client, &payer, &mint, 6).await;

    let (config_pda, _) = Pubkey::find_program_address(
        &[b"mining_config"],
        &MINING_PROGRAM_ID,
    );

    let vault = Keypair::new();
    create_token_account(&mut banks_client, &payer, &vault, &mint.pubkey(), &config_pda).await;

    // Init mining
    let ix = build_init_mining_ix(
        payer.pubkey(), mint.pubkey(), vault.pubkey(),
        1000, [50, 75, 100, 200, 400], 100, 1000,
    );
    let bh = banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], bh);
    banks_client.process_transaction(tx).await.unwrap();

    // Register LP
    let lp_pda = Keypair::new();
    let matcher_ctx = Keypair::new();
    let (lp_stake_pda, _) = Pubkey::find_program_address(
        &[b"lp_stake", lp_pda.pubkey().as_ref()],
        &MINING_PROGRAM_ID,
    );

    let ix = build_register_lp_ix(
        payer.pubkey(),
        lp_pda.pubkey(),
        matcher_ctx.pubkey(),
        config_pda,
        0, // Yield matcher type
    );
    let bh = banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], bh);
    banks_client.process_transaction(tx).await.unwrap();

    // Verify LP stake
    let account = banks_client.get_account(lp_stake_pda).await.unwrap().unwrap();
    let lp_stake: LpStake = deser_account(&account.data);

    assert_eq!(lp_stake.lp_pda, lp_pda.pubkey());
    assert_eq!(lp_stake.owner, payer.pubkey());
    assert_eq!(lp_stake.matcher_context, matcher_ctx.pubkey());
    assert_eq!(lp_stake.matcher_type, 0);
    assert_eq!(lp_stake.liquidity_amount_e6, 0);
    assert_eq!(lp_stake.current_epoch_weight, 0);
    assert!(lp_stake.is_active);

    // Verify config LP count incremented
    let account = banks_client.get_account(config_pda).await.unwrap().unwrap();
    let config: MiningConfig = deser_account(&account.data);
    assert_eq!(config.registered_lp_count, 1);
}

// =============================================================================
// Tests: Full Mining Lifecycle
// =============================================================================

#[tokio::test]
async fn test_full_mining_lifecycle() {
    let pt = program_test();
    let mut context = pt.start_with_context().await;
    let payer = context.payer.insecure_clone();
    let mut banks_client = context.banks_client.clone();

    // --- Setup: mint, vault, mining config ---
    let mint = Keypair::new();
    create_mint(&mut banks_client, &payer, &mint, 6).await;

    let (config_pda, _) = Pubkey::find_program_address(
        &[b"mining_config"],
        &MINING_PROGRAM_ID,
    );

    let vault = Keypair::new();
    create_token_account(&mut banks_client, &payer, &vault, &mint.pubkey(), &config_pda).await;

    // Fund the vault with reward tokens
    mint_to(&mut banks_client, &payer, &mint.pubkey(), &vault.pubkey(), 10_000_000).await;

    let epoch_duration = 10u64; // Short epoch for testing

    let ix = build_init_mining_ix(
        payer.pubkey(), mint.pubkey(), vault.pubkey(),
        1000,                       // emission per slot
        [50, 75, 100, 200, 400],   // regime multipliers
        1,                          // min duration
        epoch_duration,
    );
    let bh = banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], bh);
    banks_client.process_transaction(tx).await.unwrap();

    // --- Register LP ---
    let lp_pda = Keypair::new();
    let matcher_ctx = Keypair::new();
    let (lp_stake_pda, _) = Pubkey::find_program_address(
        &[b"lp_stake", lp_pda.pubkey().as_ref()],
        &MINING_PROGRAM_ID,
    );

    let ix = build_register_lp_ix(
        payer.pubkey(), lp_pda.pubkey(), matcher_ctx.pubkey(), config_pda, 0,
    );
    let bh = banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], bh);
    banks_client.process_transaction(tx).await.unwrap();

    // --- Record participation (Normal regime=2, liquidity=1_000_000) ---
    // Advance slots so slots_elapsed > 0 for weight calculation
    context.warp_to_slot(100).unwrap();
    banks_client = context.banks_client.clone();

    let ix = build_record_participation_ix(
        payer.pubkey(),
        config_pda,
        lp_stake_pda,
        2,          // Normal regime
        1_000_000,  // liquidity
    );
    let bh = banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], bh);
    banks_client.process_transaction(tx).await.unwrap();

    // Verify weight was accumulated
    let account = banks_client.get_account(lp_stake_pda).await.unwrap().unwrap();
    let lp_stake: LpStake = deser_account(&account.data);
    assert!(lp_stake.current_epoch_weight > 0);
    assert_eq!(lp_stake.liquidity_amount_e6, 1_000_000);

    // Verify config total_reward_weight was updated
    let account = banks_client.get_account(config_pda).await.unwrap().unwrap();
    let config: MiningConfig = deser_account(&account.data);
    assert!(config.total_reward_weight > 0);

    // --- Finalize epoch (advance past epoch_duration) ---
    context.warp_to_slot(200).unwrap();
    banks_client = context.banks_client.clone();

    let (snapshot_pda, _) = Pubkey::find_program_address(
        &[b"epoch_snapshot", &0u64.to_le_bytes()],
        &MINING_PROGRAM_ID,
    );

    let ix = build_finalize_epoch_ix(payer.pubkey(), config_pda, 0);
    let bh = banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], bh);
    banks_client.process_transaction(tx).await.unwrap();

    // Verify epoch snapshot
    let account = banks_client.get_account(snapshot_pda).await.unwrap().unwrap();
    let snapshot: EpochSnapshot = deser_account(&account.data);
    assert_eq!(snapshot.epoch, 0);
    assert!(snapshot.is_finalized);
    assert!(snapshot.total_reward_weight > 0);
    assert_eq!(snapshot.total_rewards, 1000 * epoch_duration); // emission_rate * epoch_duration

    // Verify config was reset for next epoch
    let account = banks_client.get_account(config_pda).await.unwrap().unwrap();
    let config: MiningConfig = deser_account(&account.data);
    assert_eq!(config.current_epoch, 1);
    assert_eq!(config.total_reward_weight, 0);

    // --- Claim rewards via SPL token transfer ---
    let owner_token = Keypair::new();
    create_token_account(&mut banks_client, &payer, &owner_token, &mint.pubkey(), &payer.pubkey()).await;

    let ix = build_claim_rewards_ix(
        payer.pubkey(),
        config_pda,
        lp_stake_pda,
        snapshot_pda,
        vault.pubkey(),
        owner_token.pubkey(),
    );
    let bh = banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], bh);
    banks_client.process_transaction(tx).await.unwrap();

    // Verify tokens were transferred
    let owner_balance = get_token_balance(&mut banks_client, &owner_token.pubkey()).await;
    assert!(owner_balance > 0, "Owner should have received reward tokens");

    // Verify LP stake was updated
    let account = banks_client.get_account(lp_stake_pda).await.unwrap().unwrap();
    let lp_stake: LpStake = deser_account(&account.data);
    assert_eq!(lp_stake.last_claim_epoch, 0);
    assert_eq!(lp_stake.current_epoch_weight, 0); // Reset after claim
    assert!(lp_stake.total_claimed > 0);
    assert_eq!(lp_stake.total_claimed, owner_balance);

    // Verify snapshot claimed amount was updated
    let account = banks_client.get_account(snapshot_pda).await.unwrap().unwrap();
    let snapshot: EpochSnapshot = deser_account(&account.data);
    assert_eq!(snapshot.total_claimed, owner_balance);
}
