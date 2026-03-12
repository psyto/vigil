use anchor_lang::{prelude::*, AccountDeserialize};
use sha2::{Sha256, Digest};
use solana_program_test::*;
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_program,
    transaction::Transaction,
};

use ncn_oracle::state::*;

const NCN_ORACLE_ID: Pubkey = ncn_oracle::ID;

// =============================================================================
// Helpers
// =============================================================================

fn anchor_discriminator(name: &str) -> Vec<u8> {
    let hash = Sha256::digest(format!("global:{}", name).as_bytes());
    hash[..8].to_vec()
}

fn program_test() -> ProgramTest {
    ProgramTest::new(
        "ncn_oracle",
        NCN_ORACLE_ID,
        None, // Load from target/deploy/ncn_oracle.so
    )
}


/// Build init_ncn_performance_feed instruction
fn build_init_perf_feed_ix(
    authority: Pubkey,
    ncn_address: Pubkey,
    ncn_name: &str,
    initial_uptime_e6: u64,
) -> Instruction {
    let (feed_pda, _) = Pubkey::find_program_address(
        &[b"ncn_perf_feed", ncn_address.as_ref()],
        &NCN_ORACLE_ID,
    );

    let mut data = anchor_discriminator("initialize_ncn_performance_feed");
    // Borsh String: 4-byte LE length + UTF-8 bytes
    data.extend_from_slice(&(ncn_name.len() as u32).to_le_bytes());
    data.extend_from_slice(ncn_name.as_bytes());
    data.extend_from_slice(&initial_uptime_e6.to_le_bytes());

    Instruction {
        program_id: NCN_ORACLE_ID,
        accounts: vec![
            AccountMeta::new(authority, true),           // authority (signer, mut)
            AccountMeta::new_readonly(ncn_address, false), // ncn_address
            AccountMeta::new(feed_pda, false),           // ncn_performance_feed (PDA)
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    }
}

/// Build record_ncn_performance instruction
fn build_record_perf_ix(
    authority: Pubkey,
    feed_pda: Pubkey,
    uptime_e6: u64,
    total_restaked_sol: u64,
    restaker_count: u32,
    slashing_event: bool,
) -> Instruction {
    let mut data = anchor_discriminator("record_ncn_performance");
    data.extend_from_slice(&uptime_e6.to_le_bytes());
    data.extend_from_slice(&total_restaked_sol.to_le_bytes());
    data.extend_from_slice(&restaker_count.to_le_bytes());
    data.push(if slashing_event { 1 } else { 0 });

    Instruction {
        program_id: NCN_ORACLE_ID,
        accounts: vec![
            AccountMeta::new_readonly(authority, true), // authority (signer)
            AccountMeta::new(feed_pda, false),          // ncn_performance_feed (mut)
        ],
        data,
    }
}

/// Build init_ncn_yield_feed instruction
fn build_init_yield_feed_ix(
    authority: Pubkey,
    ncn_address: Pubkey,
    initial_apy_bps: u64,
) -> Instruction {
    let (feed_pda, _) = Pubkey::find_program_address(
        &[b"ncn_yield_feed", ncn_address.as_ref()],
        &NCN_ORACLE_ID,
    );

    let mut data = anchor_discriminator("initialize_ncn_yield_feed");
    data.extend_from_slice(&initial_apy_bps.to_le_bytes());

    Instruction {
        program_id: NCN_ORACLE_ID,
        accounts: vec![
            AccountMeta::new(authority, true),
            AccountMeta::new_readonly(ncn_address, false),
            AccountMeta::new(feed_pda, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    }
}

/// Build record_ncn_yield instruction
fn build_record_yield_ix(
    authority: Pubkey,
    feed_pda: Pubkey,
    current_apy_bps: u64,
    base_staking_apy_bps: u64,
    mev_apy_bps: u64,
    restaking_premium_bps: u64,
) -> Instruction {
    let mut data = anchor_discriminator("record_ncn_yield");
    data.extend_from_slice(&current_apy_bps.to_le_bytes());
    data.extend_from_slice(&base_staking_apy_bps.to_le_bytes());
    data.extend_from_slice(&mev_apy_bps.to_le_bytes());
    data.extend_from_slice(&restaking_premium_bps.to_le_bytes());

    Instruction {
        program_id: NCN_ORACLE_ID,
        accounts: vec![
            AccountMeta::new_readonly(authority, true),
            AccountMeta::new(feed_pda, false),
        ],
        data,
    }
}

/// Build initialize_reporter_registry instruction
fn build_init_registry_ix(
    authority: Pubkey,
    ncn_address: Pubkey,
    min_reporters: u8,
    stake_requirement: u64,
    slash_threshold_bps: u64,
) -> Instruction {
    let (registry_pda, _) = Pubkey::find_program_address(
        &[b"reporter_registry", ncn_address.as_ref()],
        &NCN_ORACLE_ID,
    );

    let mut data = anchor_discriminator("initialize_reporter_registry");
    data.push(min_reporters);
    data.extend_from_slice(&stake_requirement.to_le_bytes());
    data.extend_from_slice(&slash_threshold_bps.to_le_bytes());

    Instruction {
        program_id: NCN_ORACLE_ID,
        accounts: vec![
            AccountMeta::new(authority, true),
            AccountMeta::new_readonly(ncn_address, false),
            AccountMeta::new(registry_pda, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    }
}

/// Build register_reporter instruction
fn build_register_reporter_ix(
    reporter: Pubkey,
    authority: Pubkey,
    registry_pda: Pubkey,
) -> Instruction {
    let (stake_pda, _) = Pubkey::find_program_address(
        &[b"reporter_stake", registry_pda.as_ref(), reporter.as_ref()],
        &NCN_ORACLE_ID,
    );

    let data = anchor_discriminator("register_reporter");

    Instruction {
        program_id: NCN_ORACLE_ID,
        accounts: vec![
            AccountMeta::new(reporter, true),       // reporter (signer, mut)
            AccountMeta::new_readonly(authority, true), // authority (signer)
            AccountMeta::new(registry_pda, false),  // reporter_registry (mut)
            AccountMeta::new(stake_pda, false),     // reporter_stake (mut)
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    }
}

/// Build submit_report instruction
fn build_submit_report_ix(
    reporter: Pubkey,
    registry_pda: Pubkey,
    ncn_address: Pubkey,
    round: u64,
    uptime_e6: u64,
    total_restaked_sol: u64,
    restaker_count: u32,
    current_apy_bps: u64,
) -> Instruction {
    let (pending_pda, _) = Pubkey::find_program_address(
        &[b"pending_submission", ncn_address.as_ref(), &round.to_le_bytes()],
        &NCN_ORACLE_ID,
    );

    let mut data = anchor_discriminator("submit_report");
    data.extend_from_slice(&round.to_le_bytes());
    data.extend_from_slice(&uptime_e6.to_le_bytes());
    data.extend_from_slice(&total_restaked_sol.to_le_bytes());
    data.extend_from_slice(&restaker_count.to_le_bytes());
    data.extend_from_slice(&current_apy_bps.to_le_bytes());

    Instruction {
        program_id: NCN_ORACLE_ID,
        accounts: vec![
            AccountMeta::new(reporter, true),       // reporter (signer, mut)
            AccountMeta::new(registry_pda, false),  // reporter_registry (mut)
            AccountMeta::new(pending_pda, false),   // pending_submission (init_if_needed)
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    }
}

/// Build finalize_report instruction
fn build_finalize_report_ix(
    payer: Pubkey,
    registry_pda: Pubkey,
    pending_pda: Pubkey,
    perf_feed_pda: Pubkey,
    yield_feed_pda: Pubkey,
) -> Instruction {
    let data = anchor_discriminator("finalize_report");

    Instruction {
        program_id: NCN_ORACLE_ID,
        accounts: vec![
            AccountMeta::new(payer, true),              // payer (signer, mut)
            AccountMeta::new_readonly(registry_pda, false), // reporter_registry
            AccountMeta::new(pending_pda, false),       // pending_submission (mut)
            AccountMeta::new(perf_feed_pda, false),     // ncn_performance_feed (mut)
            AccountMeta::new(yield_feed_pda, false),    // ncn_yield_feed (mut)
        ],
        data,
    }
}

/// Build upgrade_to_multi_reporter instruction
fn build_upgrade_to_multi_reporter_ix(
    authority: Pubkey,
    perf_feed_pda: Pubkey,
    yield_feed_pda: Pubkey,
) -> Instruction {
    let data = anchor_discriminator("upgrade_to_multi_reporter");

    Instruction {
        program_id: NCN_ORACLE_ID,
        accounts: vec![
            AccountMeta::new_readonly(authority, true), // authority (signer)
            AccountMeta::new(perf_feed_pda, false),     // ncn_performance_feed (mut)
            AccountMeta::new(yield_feed_pda, false),    // ncn_yield_feed (mut)
        ],
        data,
    }
}

/// Deserialize an Anchor account, skipping the 8-byte discriminator
fn deser_account<T: AccountDeserialize>(data: &[u8]) -> T {
    T::try_deserialize(&mut &data[..]).unwrap()
}

// =============================================================================
// Tests: Performance Feed
// =============================================================================

#[tokio::test]
async fn test_init_performance_feed() {
    let mut pt = program_test();
    let (mut banks_client, payer, recent_blockhash) = pt.start().await;

    let ncn_address = Keypair::new();
    let ncn_pk = ncn_address.pubkey();
    let (feed_pda, _) = Pubkey::find_program_address(
        &[b"ncn_perf_feed", ncn_pk.as_ref()],
        &NCN_ORACLE_ID,
    );

    let ix = build_init_perf_feed_ix(
        payer.pubkey(),
        ncn_pk,
        "Test NCN",
        995_000,
    );

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer],
        recent_blockhash,
    );
    banks_client.process_transaction(tx).await.unwrap();

    // Verify account state
    let account = banks_client.get_account(feed_pda).await.unwrap().unwrap();
    let feed: NcnPerformanceFeed = deser_account(&account.data);

    assert_eq!(feed.authority, payer.pubkey());
    assert_eq!(feed.ncn_address, ncn_pk);
    assert_eq!(feed.ncn_name, "Test NCN");
    assert_eq!(feed.uptime_probability_e6, 995_000);
    assert_eq!(feed.total_slashing_events, 0);
    assert!(feed.is_active);
    assert_eq!(feed.governance_mode, 0); // SingleAuthority
}

#[tokio::test]
async fn test_record_performance() {
    let mut pt = program_test();
    let (mut banks_client, payer, recent_blockhash) = pt.start().await;

    let ncn_address = Keypair::new();
    let ncn_pk = ncn_address.pubkey();
    let (feed_pda, _) = Pubkey::find_program_address(
        &[b"ncn_perf_feed", ncn_pk.as_ref()],
        &NCN_ORACLE_ID,
    );

    // Init
    let ix = build_init_perf_feed_ix(
        payer.pubkey(),
        ncn_pk,
        "Pyth Oracle NCN",
        990_000,
    );
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer],
        recent_blockhash,
    );
    banks_client.process_transaction(tx).await.unwrap();

    // Record performance
    let ix = build_record_perf_ix(
        payer.pubkey(),
        feed_pda,
        997_000,              // uptime
        500_000_000_000_000,  // 500k SOL restaked
        1200,                 // restakers
        false,                // no slashing
    );
    let recent_blockhash = banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer],
        recent_blockhash,
    );
    banks_client.process_transaction(tx).await.unwrap();

    // Verify
    let account = banks_client.get_account(feed_pda).await.unwrap().unwrap();
    let feed: NcnPerformanceFeed = deser_account(&account.data);

    assert_eq!(feed.uptime_probability_e6, 997_000);
    assert_eq!(feed.total_restaked_sol, 500_000_000_000_000);
    assert_eq!(feed.restaker_count, 1200);
    assert_eq!(feed.total_slashing_events, 0);
    assert_eq!(feed.performance_history.len(), 1);
    assert_eq!(feed.performance_history[0].uptime_e6, 997_000);
}

#[tokio::test]
async fn test_record_performance_with_slashing() {
    let mut pt = program_test();
    let (mut banks_client, payer, recent_blockhash) = pt.start().await;

    let ncn_address = Keypair::new();
    let ncn_pk = ncn_address.pubkey();
    let (feed_pda, _) = Pubkey::find_program_address(
        &[b"ncn_perf_feed", ncn_pk.as_ref()],
        &NCN_ORACLE_ID,
    );

    // Init
    let ix = build_init_perf_feed_ix(payer.pubkey(), ncn_pk, "Test", 990_000);
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], recent_blockhash);
    banks_client.process_transaction(tx).await.unwrap();

    // Record with slashing event
    let ix = build_record_perf_ix(payer.pubkey(), feed_pda, 500_000, 400_000_000_000_000, 800, true);
    let bh = banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], bh);
    banks_client.process_transaction(tx).await.unwrap();

    let account = banks_client.get_account(feed_pda).await.unwrap().unwrap();
    let feed: NcnPerformanceFeed = deser_account(&account.data);

    assert_eq!(feed.total_slashing_events, 1);
    assert!(feed.last_slashing_time > 0);
    assert_eq!(feed.uptime_probability_e6, 500_000);
}

// =============================================================================
// Tests: Yield Feed
// =============================================================================

#[tokio::test]
async fn test_init_and_record_yield_feed() {
    let mut pt = program_test();
    let (mut banks_client, payer, recent_blockhash) = pt.start().await;

    let ncn_address = Keypair::new();
    let ncn_pk = ncn_address.pubkey();
    let (feed_pda, _) = Pubkey::find_program_address(
        &[b"ncn_yield_feed", ncn_pk.as_ref()],
        &NCN_ORACLE_ID,
    );

    // Init yield feed
    let ix = build_init_yield_feed_ix(payer.pubkey(), ncn_pk, 800);
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], recent_blockhash);
    banks_client.process_transaction(tx).await.unwrap();

    // Verify initial state
    let account = banks_client.get_account(feed_pda).await.unwrap().unwrap();
    let feed: NcnYieldFeed = deser_account(&account.data);
    assert_eq!(feed.current_apy_bps, 800);
    assert_eq!(feed.apy_7d_avg, 800);
    assert_eq!(feed.yield_regime, 2); // Normal
    assert_eq!(feed.governance_mode, 0);

    // Record yield data
    let ix = build_record_yield_ix(payer.pubkey(), feed_pda, 850, 600, 100, 150);
    let bh = banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], bh);
    banks_client.process_transaction(tx).await.unwrap();

    let account = banks_client.get_account(feed_pda).await.unwrap().unwrap();
    let feed: NcnYieldFeed = deser_account(&account.data);
    assert_eq!(feed.current_apy_bps, 850);
    assert_eq!(feed.base_staking_apy_bps, 600);
    assert_eq!(feed.mev_apy_bps, 100);
    assert_eq!(feed.restaking_premium_bps, 150);
    assert_eq!(feed.yield_history.len(), 1);
}

// =============================================================================
// Tests: Multi-Reporter Consensus
// =============================================================================

#[tokio::test]
async fn test_upgrade_to_multi_reporter() {
    let mut pt = program_test();
    let (mut banks_client, payer, recent_blockhash) = pt.start().await;

    let ncn_address = Keypair::new();
    let ncn_pk = ncn_address.pubkey();
    let (perf_pda, _) = Pubkey::find_program_address(
        &[b"ncn_perf_feed", ncn_pk.as_ref()],
        &NCN_ORACLE_ID,
    );
    let (yield_pda, _) = Pubkey::find_program_address(
        &[b"ncn_yield_feed", ncn_pk.as_ref()],
        &NCN_ORACLE_ID,
    );

    // Init both feeds
    let ix1 = build_init_perf_feed_ix(payer.pubkey(), ncn_pk, "Test", 990_000);
    let ix2 = build_init_yield_feed_ix(payer.pubkey(), ncn_pk, 800);
    let tx = Transaction::new_signed_with_payer(
        &[ix1, ix2],
        Some(&payer.pubkey()),
        &[&payer],
        recent_blockhash,
    );
    banks_client.process_transaction(tx).await.unwrap();

    // Verify governance_mode is 0 (SingleAuthority)
    let account = banks_client.get_account(perf_pda).await.unwrap().unwrap();
    let feed: NcnPerformanceFeed = deser_account(&account.data);
    assert_eq!(feed.governance_mode, 0);

    // Upgrade to MultiReporter
    let ix = build_upgrade_to_multi_reporter_ix(payer.pubkey(), perf_pda, yield_pda);
    let bh = banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], bh);
    banks_client.process_transaction(tx).await.unwrap();

    // Verify governance_mode is now 1 (MultiReporter)
    let account = banks_client.get_account(perf_pda).await.unwrap().unwrap();
    let feed: NcnPerformanceFeed = deser_account(&account.data);
    assert_eq!(feed.governance_mode, 1);

    let account = banks_client.get_account(yield_pda).await.unwrap().unwrap();
    let feed: NcnYieldFeed = deser_account(&account.data);
    assert_eq!(feed.governance_mode, 1);
}

#[tokio::test]
async fn test_full_reporter_consensus_flow() {
    let mut pt = program_test();
    let (mut banks_client, payer, recent_blockhash) = pt.start().await;

    let ncn_address = Keypair::new();
    let ncn_pk = ncn_address.pubkey();
    let (perf_pda, _) = Pubkey::find_program_address(
        &[b"ncn_perf_feed", ncn_pk.as_ref()],
        &NCN_ORACLE_ID,
    );
    let (yield_pda, _) = Pubkey::find_program_address(
        &[b"ncn_yield_feed", ncn_pk.as_ref()],
        &NCN_ORACLE_ID,
    );
    let (registry_pda, _) = Pubkey::find_program_address(
        &[b"reporter_registry", ncn_pk.as_ref()],
        &NCN_ORACLE_ID,
    );

    // 1. Init feeds + registry
    let ix1 = build_init_perf_feed_ix(payer.pubkey(), ncn_pk, "Consensus NCN", 990_000);
    let ix2 = build_init_yield_feed_ix(payer.pubkey(), ncn_pk, 800);
    let ix3 = build_init_registry_ix(
        payer.pubkey(),
        ncn_pk,
        3,                  // min_reporters
        1_000_000_000,      // 1 SOL stake requirement
        500,                // 5% slash threshold
    );
    let tx = Transaction::new_signed_with_payer(
        &[ix1, ix2, ix3],
        Some(&payer.pubkey()),
        &[&payer],
        recent_blockhash,
    );
    banks_client.process_transaction(tx).await.unwrap();

    // 2. Upgrade to MultiReporter
    let ix = build_upgrade_to_multi_reporter_ix(payer.pubkey(), perf_pda, yield_pda);
    let bh = banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], bh);
    banks_client.process_transaction(tx).await.unwrap();

    // 3. Register 3 reporters
    let reporters: Vec<Keypair> = (0..3).map(|_| Keypair::new()).collect();

    for reporter in &reporters {
        // Airdrop SOL to reporter
        let transfer_ix = solana_sdk::system_instruction::transfer(
            &payer.pubkey(),
            &reporter.pubkey(),
            5_000_000_000, // 5 SOL
        );
        let bh = banks_client.get_latest_blockhash().await.unwrap();
        let tx = Transaction::new_signed_with_payer(
            &[transfer_ix],
            Some(&payer.pubkey()),
            &[&payer],
            bh,
        );
        banks_client.process_transaction(tx).await.unwrap();

        // Register
        let ix = build_register_reporter_ix(reporter.pubkey(), payer.pubkey(), registry_pda);
        let bh = banks_client.get_latest_blockhash().await.unwrap();
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&payer.pubkey()),
            &[&payer, reporter],
            bh,
        );
        banks_client.process_transaction(tx).await.unwrap();
    }

    // Verify registry has 3 reporters
    let account = banks_client.get_account(registry_pda).await.unwrap().unwrap();
    let registry: ReporterRegistry = deser_account(&account.data);
    assert_eq!(registry.reporters.len(), 3);
    assert_eq!(registry.active_reporter_count(), 3);

    // 4. Submit reports from all 3 reporters (with slight variance)
    let round = 1u64;
    let report_data = [
        (990_000u64, 500_000_000_000_000u64, 1200u32, 800u64),
        (992_000,    510_000_000_000_000,    1220,    810),
        (988_000,    490_000_000_000_000,    1180,    790),
    ];

    for (i, reporter) in reporters.iter().enumerate() {
        let (uptime, restaked, restakers, apy) = report_data[i];
        let ix = build_submit_report_ix(
            reporter.pubkey(),
            registry_pda,
            ncn_pk,
            round,
            uptime,
            restaked,
            restakers,
            apy,
        );
        let bh = banks_client.get_latest_blockhash().await.unwrap();
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&reporter.pubkey()),
            &[reporter],
            bh,
        );
        banks_client.process_transaction(tx).await.unwrap();
    }

    // Verify pending submission has 3 submissions
    let (pending_pda, _) = Pubkey::find_program_address(
        &[b"pending_submission", ncn_pk.as_ref(), &round.to_le_bytes()],
        &NCN_ORACLE_ID,
    );
    let account = banks_client.get_account(pending_pda).await.unwrap().unwrap();
    let pending: PendingSubmission = deser_account(&account.data);
    assert_eq!(pending.submissions.len(), 3);
    assert!(!pending.is_finalized);

    // 5. Finalize report
    let ix = build_finalize_report_ix(
        payer.pubkey(),
        registry_pda,
        pending_pda,
        perf_pda,
        yield_pda,
    );
    let bh = banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], bh);
    banks_client.process_transaction(tx).await.unwrap();

    // 6. Verify finalized values are medians
    let account = banks_client.get_account(pending_pda).await.unwrap().unwrap();
    let pending: PendingSubmission = deser_account(&account.data);
    assert!(pending.is_finalized);
    // Median of [988_000, 990_000, 992_000] = 990_000
    assert_eq!(pending.finalized_uptime_e6, 990_000);
    // Median of [490B, 500B, 510B] = 500B
    assert_eq!(pending.finalized_restaked_sol, 500_000_000_000_000);
    // Median of [1180, 1200, 1220] = 1200
    assert_eq!(pending.finalized_restaker_count, 1200);
    // Median of [790, 800, 810] = 800
    assert_eq!(pending.finalized_apy_bps, 800);

    // 7. Verify performance feed was updated with median values
    let account = banks_client.get_account(perf_pda).await.unwrap().unwrap();
    let feed: NcnPerformanceFeed = deser_account(&account.data);
    assert_eq!(feed.uptime_probability_e6, 990_000);
    assert_eq!(feed.total_restaked_sol, 500_000_000_000_000);
    assert_eq!(feed.restaker_count, 1200);
    assert_eq!(feed.governance_mode, 1); // Still MultiReporter
    assert_eq!(feed.performance_history.len(), 1);

    // 8. Verify yield feed was updated
    let account = banks_client.get_account(yield_pda).await.unwrap().unwrap();
    let feed: NcnYieldFeed = deser_account(&account.data);
    assert_eq!(feed.current_apy_bps, 800);
    assert_eq!(feed.governance_mode, 1);
    assert_eq!(feed.yield_history.len(), 1);
}
