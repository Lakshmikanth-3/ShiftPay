# ShiftPay attestation bridge

Receives clock events from timekeeping, signs EIP-712 shift attestations as the employer's attestor, persists every record in Postgres, and submits transactions through a pool of relayer keys (shard `s` → key `s % N`) so workers never pay gas. It also relays worker-signed withdrawals.

## Run

```sh
npm install
npm run db:up                 # Postgres 16 in Docker on localhost:5433
cp .env.example .env          # fill in Monad RPC/chain id, vault, keys, secrets
npm run db:push && npm run generate
npm start
```

Startup refuses to run if the RPC's chain id differs from `MONAD_CHAIN_ID`, the vault has no code, or the attestor key is not registered for `EMPLOYER_ID`.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | — | Chain, vault, attestor registration, relayers |
| POST | `/webhooks/clock` | HMAC-SHA256 `x-metronome-signature: sha256=…` over the raw body | `{idempotencyKey, workerId, type: clock_in\|clock_out, at?}` |
| GET | `/workers/:id` | — | On-chain claimable, earned, owedBack, arrears, runway |
| GET | `/workers/:id/shifts` | — | Shift history with every signed attestation and tx |
| GET | `/workers/:id/withdraw-typed-data?amount=` | — | EIP-712 payload for the worker wallet to sign |
| POST | `/withdrawals` | Worker signature | `{workerId, amount, deadline, signature}` |
| GET | `/txs/:id` | — | Transaction status |
| POST | `/admin/shifts/:shiftId/corrections` | `Bearer ADMIN_API_TOKEN` | `{correctGross}` |
| GET | `/admin/txs?status=` | `Bearer ADMIN_API_TOKEN` | Queue inspection |

## Guarantees

- **Idempotent intake.** Webhook redeliveries return the original result; shift ids are derived from `(vault, employer, worker, clock-in key)`.
- **No duplicate settlement.** Before sending, every transaction is simulated. Reverts that mean "already applied" (`AlreadySettled`, `OnShift`, `BadVersion`) are confirmed against chain state and marked done. Expired attestations are re-signed with a fresh deadline, and the old signature stays in the history.
- **Ordering.** One in-flight transaction per worker; nonces tracked per relayer; transactions are never batched into one sequential EVM call.
- **Retries.** RPC errors back off exponentially up to `MAX_TX_ATTEMPTS`; receipts are re-checked after restarts.
- **Reconciliation.** `npm run reconcile` compares bridge records with vault state and flags any shift settled on-chain for this employer that the bridge never signed, such as a leaked attestor key.

Assumes one bridge process per database.

## Scripts

- `npm test`: unit tests, plus an end-to-end test that starts anvil, deploys the contracts, and drives clock-in, duplicate delivery, clock-out, expired-attestation retry, crash-replay, correction, relayed withdrawal, history verification, and reconciliation. Needs `npm run db:up` and Foundry. Each run uses a fresh Postgres schema and drops it afterwards.
- `npm run demo:clock -- in 7`, `npm run demo:clock -- out 7`: demo timekeeping adapter.
- `npm run abi`: refresh `src/abi` after changing the contracts.
