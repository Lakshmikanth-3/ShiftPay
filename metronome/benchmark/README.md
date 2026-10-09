# Payroll benchmark procedure

The harness compares identical accounting and attestation behavior: 64-shard payroll versus a control routing every worker through shard 0. Setup and signing are outside measured open/close/withdraw stages. Each sender lane waits for receipts; this is bounded client concurrency rather than unlimited mempool saturation.

Run npm run benchmark from bridge. Local mode uses isolated Anvil fixtures and development tokens exclusively to validate the harness. Anvil is sequential and cannot establish Monad parallel-execution performance.

For a real network run, use BENCH_MODE=testnet with chain 10143, two fresh benchmark-only vaults, issuer test tokens, configured attestor and separately funded relayer lanes. Set BENCH_WORKERS, BENCH_CONCURRENCY and BENCH_SHIFT_SECONDS explicitly. Never reuse company payroll allocations or worker accounts for the benchmark.

Preparation uses npm run benchmark:prepare. Its BENCH_ADMIN_KEY and service/worker keys are isolated benchmark credentials stored privately. It spends real test MON and funds both fixtures from existing issuer-token balances. Do not generate, copy or fund benchmark accounts without the owner's authorized configuration.

Each run records raw.json, raw.csv, summary.json, environment.json and latency.svg. Keep transaction hashes, receipt status, confirmation times, blocks, gas, failure counts, client limits and source commit. Repeat with fresh fixtures and both execution orders before reporting a comparison.

Historical local runs validate only their own harness revision. A 5,000-worker real-network workload has not been measured, and no production speedup is claimed. The admin UI correctly leaves real-network results unpublished until evidence exists.
