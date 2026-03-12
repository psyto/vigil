# Vigil

Pricing and hedging restaking risk on Solana.

Vigil provides market infrastructure for evaluating NCN (Node Consensus Network) reliability and yield — enabling traders to go long or short on restaking performance through perpetual markets built on [Percolator](https://percolator.trade/).

## Architecture

```
vigil/
├── programs/
│   ├── ncn-oracle/              # Anchor — NCN performance & yield oracle
│   ├── restaking-yield-matcher/ # Native — Percolator matcher for yield perps
│   ├── ncn-uptime-matcher/      # Native — Percolator matcher for uptime perps
│   ├── index-matcher/           # Native — Percolator matcher for NCN index perps
│   └── volatility-mining/       # Anchor — LP reward distribution with regime multipliers
├── sdk/                         # TypeScript client library
├── keeper/                      # Off-chain data feeds and signal detection
├── cli/                         # Market creation, LP init, trading
└── demo/                        # Interactive browser-based pricing simulator
```

### Data Flow

```
Jito/Fragmetric APIs
        │
        ▼
   ┌─────────┐     ┌───────────────┐     ┌──────────────────┐
   │  Keeper  │────▶│  ncn-oracle   │────▶│  Matcher programs │
   │ services │     │  (on-chain    │     │  (yield/uptime/   │
   └─────────┘     │   feeds)      │     │   index pricing)  │
        │           └───────────────┘     └──────────────────┘
        │                                          │
        ▼                                          ▼
   ┌──────────┐                           ┌──────────────────┐
   │  Signal  │                           │ volatility-mining │
   │ detector │                           │ (LP rewards by   │
   └──────────┘                           │  regime)         │
                                          └──────────────────┘
```

## Programs

### ncn-oracle

Anchor program maintaining on-chain oracle feeds for NCN performance and yield data.

- **Performance feeds**: uptime probability (0-1M e6 scale), total restaked SOL, restaker count, slashing events
- **Yield feeds**: APY in basis points with decomposition (base staking, MEV, restaking premium), variance, regime classification
- **Aggregated feed**: protocol-level metrics across all NCNs (up to 32)
- **Multi-reporter consensus**: decentralized oracle mode with staking, median aggregation, and slashing for deviating reporters
- **History**: 7-day hourly circular buffer (168 samples) per feed
- **Governance modes**: SingleAuthority (trusted keeper) or MultiReporter (staked consensus)

Program ID: `NCNRsk1111111111111111111111111111111111111`

### restaking-yield-matcher

Native Solana program implementing a Percolator matcher for restaking yield perpetuals.

- Regime-adjusted spreads derived from yield volatility (VeryLow/Low/Normal/High/Extreme)
- 320-byte matcher context with fixed byte-offset layout
- Regime multipliers: 0.5x-2.5x scaling
- Oracle staleness checking (100-slot tolerance)

### ncn-uptime-matcher

Native Solana program implementing a Percolator matcher for NCN uptime perpetuals.

- Binary resolution: SLASHED or SAFE outcomes
- Edge-spread probability pricing
- Kalshify-style signal severity adjustments (0-3 levels)
- Market resolution logic with outcome recording

### index-matcher

Native Solana program implementing a Percolator matcher for NCN index perpetuals.

- Full index or exclusion index modes
- Weighted average APY calculation across NCNs
- Index regime classification
- Min NCN count validation

### volatility-mining

Anchor program distributing LP rewards based on participation during volatile regimes.

- Emission rate per slot with 5 regime multipliers
- Epoch-based reward distribution with configurable duration
- LP registration per matcher type
- Participation tracking with regime-weighted rewards
- SPL token reward claims via PDA signing
- Checked arithmetic throughout

Program ID: `VMine11111111111111111111111111111111111111`

## SDK

TypeScript client library (`vigil-sdk`) for interacting with all Vigil programs.

| Module | Description |
|--------|-------------|
| `ncnOracle` | Account deserialization, instruction builders, PDA derivation for performance/yield feeds and reporter consensus |
| `yieldMatcher` | Yield matcher context deserialization, execution price simulation with regime-adjusted spreads |
| `uptimeMatcher` | Uptime probability management, edge-spread pricing, market resolution |
| `indexMatcher` | Index pricing across NCNs, regime classification |
| `volatilityMining` | LP stake tracking, epoch snapshots, reward calculation, PDA derivation |
| `types` | Shared BigInt pricing arithmetic (exact port from on-chain Rust) |

## Keeper Services

Off-chain services that monitor external data sources and push updates on-chain.

| Service | File | Description |
|---------|------|-------------|
| `ncn-monitor` | `ncn-monitor.ts` | Monitors NCN performance (uptime, TVL, slashing) |
| `yield-sync` | `yield-sync.ts` | Pushes yield data and regime to the yield matcher |
| `uptime-sync` | `uptime-sync.ts` | Pushes uptime probability and signal to the uptime matcher |
| `index-sync` | `index-sync.ts` | Syncs index-level data across NCNs |
| `signal-detector` | `signal-detector.ts` | Anomaly detection: uptime drops, TVL decline, restaker drain, slashing contagion |
| `mining-keeper` | `mining-keeper.ts` | Epoch finalization and reward distribution |
| `reporter-finalizer` | `reporter-finalizer.ts` | Finalizes multi-reporter consensus rounds |

External data clients:
- `jito-yield-client.ts` — Jito restaking yield data
- `fragmetric-client.ts` — Fragmetric NCN performance data

## CLI

| Command | Description |
|---------|-------------|
| `create-yield-market` | Initialize a Percolator market with yield oracle |
| `create-uptime-market` | Initialize a Percolator market with uptime oracle |
| `create-index-market` | Initialize a Percolator market for NCN index |
| `init-lp` | Create context account and initialize matcher |
| `trade` | Long/short yield or uptime via matcher |
| `mining` | Manage volatility mining (register LP, claim rewards) |
| `list-markets` | Show active restaking risk markets |

## Build

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Solana CLI / Agave](https://docs.solanalabs.com/cli/install) v2.2+ (for BPF compilation)
- [Node.js](https://nodejs.org/) v18+

### Build Programs

```bash
# Build all programs to BPF
cargo build-sbf

# Run Rust tests (unit + integration)
# Integration tests require BPF-compiled programs
BPF_OUT_DIR=target/deploy cargo test
```

### Install Dependencies

```bash
# SDK (required by CLI, keeper)
cd sdk && npm install

# CLI
cd cli && npm install

# Keeper
cd keeper && npm install

# Demo
cd demo && npm install
```

### Run SDK Tests

```bash
cd sdk && npm test
```

## Testing

### Test Summary

| Suite | Framework | Tests | Description |
|-------|-----------|-------|-------------|
| ncn-oracle unit | Rust | 41 | Median, variance, regime, reporter registry, pending submission |
| ncn-oracle integration | solana-program-test | 6 | Init/record feeds, multi-reporter consensus flow with median finalization |
| volatility-mining integration | solana-program-test | 3 | Mining config, LP registration, full lifecycle with SPL token claims |
| SDK unit | Jest | 90+ | Pricing simulation, account deserialization, PDA derivation, enum coverage |

### Running Integration Tests

Integration tests deploy BPF-compiled programs to a local validator via `solana-program-test`. The programs must be compiled first:

```bash
# Build BPF programs
cargo build-sbf

# Run all Rust tests (unit + integration)
BPF_OUT_DIR=target/deploy cargo test

# Run a specific integration test
BPF_OUT_DIR=target/deploy cargo test --package ncn-oracle --test integration
BPF_OUT_DIR=target/deploy cargo test --package volatility-mining --test integration
```

### Integration Test Coverage

**ncn-oracle** tests cover:
- Performance feed initialization and recording (with and without slashing)
- Yield feed initialization and recording with APY decomposition
- Governance mode upgrade from SingleAuthority to MultiReporter
- Full multi-reporter consensus: 3 reporters stake SOL, submit reports with variance, finalize with median aggregation writing to both performance and yield feeds

**volatility-mining** tests cover:
- Mining config initialization with SPL token vault
- LP registration and stake PDA creation
- Full mining lifecycle: participation recording with regime multipliers, slot advancement, epoch finalization, and SPL token reward claims via PDA-signed transfer

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `RPC_URL` | `https://api.devnet.solana.com` | Solana RPC endpoint |
| `AUTHORITY_KEYPAIR` | _(generated)_ | JSON array of secret key bytes |
| `MONITOR_INTERVAL_MS` | `5000` | Keeper: NCN monitor polling interval |
| `SYNC_INTERVAL_MS` | `5000` | Keeper: yield/uptime sync interval |
| `POLL_INTERVAL_MS` | `30000` | Keeper: signal detector polling interval |

## Usage

### Keeper

```bash
# Run unified pipeline (all services)
cd keeper && npm start

# Run individual services
cd keeper && npm run monitor
cd keeper && npm run yield-sync
cd keeper && npm run uptime-sync
cd keeper && npm run signals
```

### CLI

```bash
cd cli

# Create markets
npm run create-yield-market -- --ncn <NCN_PUBKEY> --name "Pyth Oracle NCN"
npm run create-uptime-market -- --ncn <NCN_PUBKEY> --name "Wormhole Bridge NCN"
npm run create-index-market -- --ncn <NCN_PUBKEY> --name "Index NCN"

# Initialize LP
npm run init-lp -- --type yield --ncn <NCN_PUBKEY>

# Trade
npm run trade -- --type yield --context <CONTEXT_PUBKEY> --side long

# List markets
npm run list-markets -- --contexts <ADDR1,ADDR2>

# Volatility mining
npm run mining -- register --lp <LP_PUBKEY>
npm run mining -- claim --epoch 0
```

### Demo

```bash
cd demo && npm run dev
# Open http://localhost:3000
```

Interactive simulator for adjusting uptime, yield, regime, and signal severity to see pricing respond in real-time. The pricing engine is an exact BigInt port from the on-chain Rust programs. No blockchain connection required.

## Dependencies

- [Solana](https://solana.com/) v2.2+ — runtime
- [Anchor](https://www.anchor-lang.com/) 0.32.1 — ncn-oracle and volatility-mining framework
- [Percolator](https://percolator.trade/) — perpetuals execution layer
- [matcher-common](https://github.com/nicholasgasior/percolator-fabrknt) — shared Percolator matcher SDK

## License

MIT
