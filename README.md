# Vigil

Pricing and hedging restaking risk on Solana.

Vigil provides market infrastructure for evaluating NCN (Node Consensus Network) reliability and yield — enabling traders to go long or short on restaking performance through perpetual markets built on Percolator.

## Architecture

```
vigil/
├── programs/
│   ├── ncn-oracle/              # Anchor — NCN performance & yield oracle
│   ├── restaking-yield-matcher/ # Native — Percolator matcher for yield perps
│   └── ncn-uptime-matcher/      # Native — Percolator matcher for uptime perps
├── keeper/                      # Off-chain data feeds and signal detection
├── cli/                         # Market creation, LP init, trading
└── sdk/                         # TypeScript client library
```

### Programs

**ncn-oracle** — Anchor program that maintains on-chain oracle feeds for NCN performance (uptime, slashing, TVL) and yield (APY decomposition, variance, regime classification). Stores 7-day hourly history per NCN.

**restaking-yield-matcher** — Native Solana program implementing a Percolator matcher for restaking yield perpetuals. Prices trades using regime-adjusted spreads (VeryLow → Extreme) derived from yield volatility. Adapted from vol-matcher.

**ncn-uptime-matcher** — Native Solana program implementing a Percolator matcher for NCN uptime perpetuals. Prices trades using edge-spread probability pricing with Kalshify-style signal severity adjustments. Supports binary resolution (SLASHED/SAFE). Adapted from event-matcher.

### Keeper Services

| Service | Description |
|---------|-------------|
| `ncn-monitor` | Monitors NCN performance data (uptime, TVL, slashing) |
| `yield-sync` | Pushes yield data and regime to the yield matcher |
| `uptime-sync` | Pushes uptime probability and signal to the uptime matcher |
| `signal-detector` | Anomaly detection across uptime drops, TVL decline, restaker drain, slashing contagion |

### CLI

| Command | Description |
|---------|-------------|
| `create-yield-market` | Initialize a Percolator market with yield oracle |
| `create-uptime-market` | Initialize a Percolator market with uptime oracle |
| `init-lp` | Create context account and initialize matcher |
| `trade` | Long/short yield or uptime via matcher |
| `list-markets` | Show active restaking risk markets |

## Build

```bash
# Build all programs to BPF
cargo build-sbf

# Run tests
cargo test
```

## Keeper

```bash
npm install

# Run individual keepers
npm run keeper:monitor
npm run keeper:yield-sync
npm run keeper:uptime-sync
npm run keeper:signal
```

## CLI

```bash
# Create markets
npm run cli:create-yield-market -- --ncn <NCN_PUBKEY> --name "Pyth Oracle NCN"
npm run cli:create-uptime-market -- --ncn <NCN_PUBKEY> --name "Wormhole Bridge NCN"

# Initialize LP
npm run cli:init-lp -- --type yield --ncn <NCN_PUBKEY>

# Trade
npm run cli:trade -- --type yield --context <CONTEXT_PUBKEY> --side long

# List markets
npm run cli:list-markets -- --contexts <ADDR1,ADDR2>
```

## Dependencies

- [Solana](https://solana.com/) — runtime
- [Anchor](https://www.anchor-lang.com/) — ncn-oracle framework
- [Percolator](https://percolator.trade/) — perpetuals execution layer
- [matcher-common](../percolator-matchers/packages/matcher-common) — shared matcher utilities

## License

MIT
