# Security and code-quality review

Reviewed 13 Oct 2026 across `contracts/`, `bridge/` and `app/`. Testnet software, not audited.

## Automated checks

| Check | Result |
|---|---|
| Contract tests (`forge test`) | 43 passed: 38 unit/fuzz + 5 invariants (solvency, conservation, no unbacked claims, monotonic totals, all earnings funded) |
| Bridge typecheck + tests | Clean; 25 unit, config and Envio tests pass |
| App tests | 42 pass (passkey derivation, funding, Agora, private payslips, pay plans) |
| Live agent (`npm run test:agent`) | 26/26 on the deployed sites with real Monad transactions |
| `npm audit` (production deps) | bridge 0, contracts 0. app: `prisma` CLI (build-time only) via `deepmerge-ts` (high, not reachable at runtime); `@privy-io/react-auth` (moderate) is installed but no longer imported or shipped |
| Secrets in git history | None of the service keys appear in any commit; `.env*`, `.env.runtime-keys`, `.env.benchmark` are ignored |
| Static analysis (Slither 0.11, 102 detectors) | 0 high, 0 true positives in 26 results; triage below |
| Dangerous browser patterns | No `dangerouslySetInnerHTML`, `eval` or `new Function`; nothing secret in `NEXT_PUBLIC_*` |

## Slither triage

Run: `uvx --from slither-analyzer slither contracts --filter-paths "lib/|test/|script/"` (13 Oct 2026).

| Detector (count) | Verdict |
|---|---|
| `reentrancy-no-eth` (1): `remitWithholding` | False positive. Each shard's `withheld` is zeroed before its transfer, and the token is the immutable AUSD/USDC set at deploy (no transfer hooks). Only the company admin can call it |
| `reentrancy-events` (3): `_withdraw`, `reclaim`, `remitWithholding` emit after transfer | Informational. State is final before the call; event order has no security effect |
| `incorrect-equality` (1): `_checkpoint` compares segment start to `block.timestamp` | Intended: merges two checkpoints in the same block into one segment |
| `uninitialized-local` (1): `perShard` in `fundWorkers` | False positive. Fixed-size memory arrays start at zero |
| `calls-loop` (2): constructor shard set-up, `remitWithholding` | Accepted. Bounded by the 64 shards; callees are the vault's own shard contracts |
| `timestamp` (17) | Intended. Wages accrue per second; a few seconds of block-time skew cannot move more than that much pay, and accrual is capped by funding |
| `pragma` (1) | Informational. Both contracts pin 0.8.28; OpenZeppelin libraries use their own `^0.8.20` range |

## Findings fixed in this review

| Severity | Finding | Fix |
|---|---|---|
| High | Self-serve companies could make the shared relayer pay gas without limit (many workers claiming fee credits; unlimited clock-ins and withdrawals) | Per-company daily budget: 60 sponsored transactions and 5 worker fee credits per self-serve company; 30 worker credits per day overall; new-account credit once per address, 15 per day. The home company is not limited |
| Low | Address and admin lookups re-read every worker or company on each request (RPC quota exhaustion) | 20-second cache per address |

## Controls in place

| Area | Control |
|---|---|
| Money | Accrual capped by funded allocation; tax escrow only to the immutable tax address; reclaim limited to unearned funds; OpenZeppelin `SafeERC20` |
| Sponsored gas | Relayed withdrawals must be at least 1 AUSD/USDC (or the whole balance) and are free 5 times a week per worker; after that the app withdraws directly from the worker's wallet with `withdraw()`, so wages are never locked |
| Withdrawals | EIP-712 signature by the registered payout address, per-worker nonce and deadline; the relayer cannot change amount or recipient |
| Shifts | Signed by the service attestor for companies that registered it; clock requests require the company admin's signature (10-minute deadline, unique nonce) |
| API | POST requires same-origin or the timing-safe relay secret (CSRF protection); request bodies limited to 64 KB; strict schemas (zod) |
| Dashboard | Signed, 10-minute access proofs; profile writes are single-use (consumed signatures) |
| Keys | Mera passkey keys live only in the browser tab and are wiped after 15 minutes; service keys only in Vercel sensitive variables |
| Private payslips | AES-256-GCM, key and storage id derived from a separate PRF namespace; server stores ciphertext only |
| Startup | Refuses to serve if chain id, vault code, token, decimals, attestor or expected admin do not match |

## Known limitations

- Not audited. A shared vault means a contract bug would affect every company using it.
- No reentrancy guard: safe for USDC and AUSD (no transfer hooks); the vault must not be used with hook tokens.
- Shift times are attested by the employer's service; the chain proves funding and signatures, not hours worked.
- Encrypted payslip storage is keyed by an unguessable id but has no global write quota beyond the 40 KB size limit.
- The relayer and attestor keys are hot keys in the hosting environment; compromise is bounded by funded allocations and the daily budgets above.
