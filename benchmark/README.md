# Payroll benchmark procedure

The harness compares identical accounting and attestation behavior: 64-shard payroll versus a control routing every worker through shard 0. Setup and signing are outside measured open/close/withdraw stages. Each sender lane waits for receipts; this is bounded client concurrency rather than unlimited mempool saturation.

Run npm run benchmark from bridge. Local mode uses isolated Anvil fixtures and development tokens exclusively to validate the harness. Anvil is sequential and cannot establish Monad parallel-execution performance.

For a real network run, use BENCH_MODE=testnet with chain 10143, two fresh benchmark-only vaults, issuer test tokens, configured attestor and separately funded relayer lanes. Set BENCH_WORKERS, BENCH_CONCURRENCY and BENCH_SHIFT_SECONDS explicitly. Never reuse company payroll allocations or worker accounts for the benchmark.

Preparation uses npm run benchmark:prepare. Its BENCH_ADMIN_KEY and service/worker keys are isolated benchmark credentials stored privately. It spends real test MON and funds both fixtures from existing issuer-token balances. Do not generate, copy or fund benchmark accounts without the owner's authorized configuration.

Each run records raw.json, raw.csv, summary.json, environment.json and latency.svg. Keep transaction hashes, receipt status, confirmation times, blocks, gas, failure counts, client limits and source commit. Repeat with fresh fixtures and both execution orders before reporting a comparison.

Historical local runs validate only their own harness revision. A 5,000-worker real-network workload has not been measured, and no production speedup is claimed. The admin UI correctly leaves real-network results unpublished until evidence exists.

## Monad testnet run, 11 Oct 2026 (`results/2026-10-11T07-26-25-048Z`)

16 workers, 8 parallel sender lanes, 60-second shifts; the same burst of clock-in, clock-out and relayed withdrawal
against a 64-shard `MetronomeVault` (`0xe9b026a8f366615ee0c10f2fbf162a87f300dc3b`) and a single-storage
`NaiveVault` control (`0x3c18ec3d1a0ecb3f8febc5d76525b65f0c1d2311`). All 96 transactions confirmed, none failed.

| Design | Stage | Confirmed | p50 latency | p95 latency | Blocks used | Avg gas |
|---|---|---|---|---|---|---|
| sharded | open | 16/16 | 2.25 s | 3.81 s | 10 | 185,973 |
| sharded | close | 16/16 | 1.94 s | 3.05 s | 8 | 267,964 |
| sharded | withdraw | 16/16 | 1.68 s | 2.11 s | 5 | 188,826 |
| naive | open | 16/16 | 1.96 s | 3.00 s | 6 | 185,975 |
| naive | close | 16/16 | 2.04 s | 3.11 s | 7 | 257,669 |
| naive | withdraw | 16/16 | 1.57 s | 2.12 s | 5 | 168,300 |

**What this shows:** Monad settled a 16-worker shift change in both designs within 2–4 seconds end to end, and every
worker could withdraw within about 2 seconds of asking. **What it does not show:** at this size the two designs
perform the same; latency is dominated by client and RPC round trips, not storage contention, and sharding costs
4–12% more gas per call. Demonstrating the sharding advantage needs hundreds of simultaneous workers from several
independent senders; that run has not been done, and no speed-up is claimed.
