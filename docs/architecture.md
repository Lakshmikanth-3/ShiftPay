# ShiftPay architecture and accounting (Phase 2)

Source: `METRONOME_PRD.md`. This document fixes the ledger before contract code and records the decisions taken with the project owner on 2026-10-06.

## Decisions

| Topic | Decision |
|---|---|
| Network | Monad testnet: RPC `https://testnet-rpc.monad.xyz/`, chain ID 10143 (owner-supplied, verified live 2026-10-06). Values live in `.env` / `foundry.toml`, not in contract code. |
| Settlement token | Agora AUSD (address from `.env`). Foundry tests use a mock ERC-20 only inside the test suite. |
| Tenancy | One multi-employer vault. Each employer has its own admin, attestor, and tax address. |
| Custody | 64 shard sub-vaults (EIP-1167 clones). A worker lives in shard `workerId % 64`. Each shard holds its own AUSD. |
| Over-estimate | PRD behaviour: workers may withdraw against the open-shift estimate. A shorter final shift is recovered from future accrual only. |
| Unfunded work | Open-shift accrual stops at the funded gross budget. Top-ups resume from their receipt time without paying paused intervals. Offline settlements and upward corrections exceeding the available budget revert. |
| Withdrawal auth | Worker-signed EIP-712 `Withdraw` from `payoutAddr`; anyone (the bridge relayer) may submit. Funds go only to `payoutAddr`. |
| Gas | The bridge relayer submits attestations and withdrawals with a key supplied in `.env`. |
| Keys | Company and employee signing accounts use owner-created Mera passkeys or employee Privy embedded accounts. Locally prepared service keys remain in ignored environment files. |

### Deviations from the PRD's illustrative Solidity

- **`ratePerHour` instead of `ratePerSec`.** AUSD has 6 decimals; $24/h is 6,666.67 units/s and cannot be stored exactly. Gross is `ratePerHour × seconds / 3600`, rounded down.
- **No explicit `owedBack` field.** Over-estimates and downward corrections lower `netSettled`; while `withdrawn > earnedNet` the worker's claimable is zero, so the gap is recovered from future accrual automatically. `owedBack = max(0, withdrawn − earnedNet)` is a derived view.
- **No relayer privilege.** The PRD lets a relayer call `withdraw` directly; here the relayer can only submit a worker-signed request.
- **No shared replay bitmap.** A 256-bit bitmap word would be written by many workers and serialise the burst. Replay protection uses the per-shift record `shifts[shiftId]`, one slot set per shift.
- **`taxAddr` is immutable per employer.** If the admin could change it, withheld funds could be redirected. The attestor can be rotated.

## Ledger

All amounts are AUSD base units (6 decimals). Per worker:

```text
funded       cumulative gross deposited for this worker, minus reclaims
netSettled   Σ net of closed shifts, after corrections
taxSettled   Σ withholding of closed shifts (never decreases)
taxEscrowed  withholding moved into the employer's tax escrow (never decreases)
withdrawn    cumulative net paid to payoutAddr (never decreases)
```

Each closed shift is split at the worker's withholding rate when it closes:

```text
gross = ratePerHour × (endAt − startAt) / 3600
tax   = gross × bps / 10000         (rounded down — in the worker's favour)
net   = gross − tax
```

The open shift is estimated lazily, with no writes:

```text
budget    = max(0, funded - netSettled - taxSettled)
at        = min(now, clockInAt + maxShiftSeconds)
segment   = latest checkpoint at or before at
openGross = min(segment.grossStart + segment.rate * (at - segment.startAt) / 3600,
                segment.ceiling)
earnedNet = netSettled + openNet
earnedTax = taxSettled + openTax
```

Claimable — the number the worker app shows:

```text
claimable = 0                                         if suspended
          = max(0, min(earnedNet − withdrawn,
                       funded − earnedTax − withdrawn))
```

Checkpoints record funding, reclaim, correction, suspension and reinstatement boundaries for the open shift. A suspended segment has zero rate. A top-up preserves gross already earned and increases the ceiling from that moment. Historical close times use the segment active at their attested end. Gross earnings never exceed allocation; withholding is reserved before net pay.

Derived views for dashboards:

```text
owedBack  = max(0, withdrawn − earnedNet)                      over-estimate pending recovery
arrears   = max(0, earnedNet − withdrawn) − claimable           earned but not yet funded (net)
runway    = seconds of accrual left before claimable hits the funding cap
```

### Tax escrow sync

On every write that can raise the escrow target (close, correct, fund), settled tax is moved into escrow as far as funding allows. Withdraw and reclaim never need a sync: both are limited to `funded − earnedTax − …`, so afterwards `funded − withdrawn ≥ taxSettled` and the target is unchanged.

```text
target       = min(taxSettled, funded − withdrawn)
delta        = target − taxEscrowed   (only when target > taxEscrowed)
taxEscrowed += delta
alloc[employer][shard]    −= delta
withheld[employer][shard] += delta
```

Tokens never move during a sync. Escrowed tax stays in the shard sub-vault until `remitWithholding` sends it to the employer's `taxAddr`.

### Shard totals

```text
alloc[employer][shard]     Σ (funded − withdrawn − taxEscrowed) over the employer's workers in that shard
withheld[employer][shard]  escrowed tax not yet remitted
```

## Worked example

Rate $24/h, withholding 20%, funded $200. Figures in dollars.

| Step | Event | netSettled | taxSettled | withdrawn | taxEscrowed | claimable | alloc | withheld | sub-vault |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Fund $200 | 0 | 0 | 0 | 0 | 0 | 200 | 0 | 200 |
| 2 | Clock in; 2h later estimate is gross 48 / tax 9.60 / net 38.40 | 0 | 0 | 0 | 0 | 38.40 | 200 | 0 | 200 |
| 3 | Withdraw 30 | 0 | 0 | 30 | 0 | 8.40 | 170 | 0 | 170 |
| 4 | Shift closes attested at 1.5h: gross 36 / tax 7.20 / net 28.80 | 28.80 | 7.20 | 30 | 7.20 | 0 (owedBack 1.20) | 162.80 | 7.20 | 170 |
| 5 | 4h shift: gross 96 / tax 19.20 / net 76.80 | 105.60 | 26.40 | 30 | 26.40 | 75.60 | 143.60 | 26.40 | 170 |
| 6 | Remit withholding | 105.60 | 26.40 | 30 | 26.40 | 75.60 | 143.60 | 0 | 143.60 |
| 7 | Employer funds $124 before further work | 105.60 | 26.40 | 30 | 26.40 | 75.60 | 267.60 | 0 | 267.60 |
| 8 | Funded 8h shift: gross 192 / tax 38.40 / net 153.60 | 259.20 | 64.80 | 30 | 64.80 | 229.20 | 229.20 | 38.40 | 267.60 |
| 9 | Withdraw 229.20 | 259.20 | 64.80 | 259.20 | 64.80 | 0 | 0 | 38.40 | 38.40 |

Reconciliation after step 9: deposited 324 = withdrawn 259.20 + remitted 26.40 + escrow 38.40. The 1.20 over-estimate from step 4 was recovered from the step-5 shift; nothing was taken from the worker's wallet.

## Corrections

`correctShift(shiftId, correctGross, version, deadline, sig)` is signed by the employer's attestor. Each shift carries a version, and each correction must use `version = current + 1`.

- **Upward:** the extra gross is split at the shift's recorded rate; `netSettled` and `taxSettled` increase.
- **Downward:** only `netSettled` falls by the net difference. `taxSettled` and escrow do not fall. Tax already set aside on the phantom hours is the employer's loss, per PRD §20: "If the employer is wrong in their favour, that's their loss". If `withdrawn` now exceeds `earnedNet`, claimable is zero until future accrual closes the gap.
- `withdrawn` is never reduced and no tokens leave the worker's wallet.

## Rate and withholding changes

`setRate`, `setWithholding` and `setMaxShift` are refused during an open shift. Closed shifts retain their recorded split. The signed closing rate may lower settled gross; open-shift settlement remains capped by the funded accrual recorded at the closing time. Upward corrections must fit the funded budget after reserving any current open-shift earnings.

## Suspension

A suspended worker's claimable is zero. `openShift`, `closeShift`, `correctShift`, and `withdraw` revert until `reinstate`. Funding is still allowed.

## Reclaim

An employer may take back unearned funding: `reclaim(workerId, amount)` requires

```text
amount ≤ funded − max(withdrawn, earnedNet) − earnedTax
```

The open-shift estimate is included, so funding reserved for the current shift cannot be pulled.

## Transaction boundaries and storage touched

| Function | Worker slots | Shard slots | Other |
|---|---|---|---|
| `openShift` | worker (clockInAt, openShiftId) | — | — |
| `closeShift` | worker | `alloc`, `withheld` for (employer, shard) only when tax escrow moves | `shifts[shiftId]` (new slot) |
| `correctShift` | worker | same as close | `shifts[shiftId]` |
| `withdraw` | worker (withdrawn, nonce) | `alloc[e][s]` | AUSD balances: shard sub-vault and payout address |
| `fundWorkers` | each worker | `alloc` for each touched shard | AUSD: employer → each touched sub-vault (one transfer per shard) |
| `remitWithholding` | — | `withheld[e][s]` per shard | AUSD: sub-vault → taxAddr |
| `claimable` / views | none (read) | — | — |

Two workers in different shards share no slot in any of the worker-path calls. Workers in the same shard share only `alloc` / `withheld` for their employer and the sub-vault's AUSD balance. The bridge submits one transaction per shift (grouped by shard for ordering), never a batched loop, so Monad can execute them in parallel.

## Invariants

| ID | Statement |
|---|---|
| I1 Solvency | For every worker: `withdrawn + taxEscrowed ≤ funded`. |
| I2 Conservation | For every shard: `AUSD.balanceOf(subVault) == Σ_e alloc[e][s] + withheld[e][s]`. |
| I3 No unbacked claims | `claimable(w) ≤ funded − withdrawn − earnedTax` and `claimable(w) ≤ alloc share of w`. |
| I4 Monotonic | `withdrawn`, `taxSettled`, `taxEscrowed` never decrease. Corrections never change `withdrawn`. |
| I5 Single settlement | A `shiftId` is recorded at most once; corrections need the next version. |
| I6 Authority | Only the employer's attestor can open, close, or correct; only `payoutAddr` can authorise withdrawal; withheld tax only goes to `taxAddr`. |
| I7 Suspension | A suspended worker has zero claimable and cannot withdraw or be attested. |

## Test matrix

Unit (Foundry), mapped to the PRD list:

| PRD test | Covered by |
|---|---|
| test_accrual_matches_rate_times_seconds | `test_ClosedShiftAccrual` |
| test_midshift_estimate_capped | `test_OpenEstimateCappedAtMaxShift` |
| test_closeshift_replaces_estimate | `test_CloseReplacesEstimate` |
| test_overestimate_recovered_from_future_only | `test_OverEstimateRecoveredFromFutureShift` |
| test_never_claws_back_withdrawn | `test_DownwardCorrectionNeverReducesWithdrawn` |
| test_withdraw_capped_by_allocation | `test_WithdrawCappedByFunding` |
| test_accrual_halts_when_underfunded | `test_OpenEstimateStopsAtFundingCap`, `test_TopUpResumesWithoutBackpayForPausedTime`, `test_UnfundedOfflineSettlementRejected` |
| test_withholding_routed_to_escrow | `test_WithholdingEscrowedOnClose` |
| test_withholding_only_to_taxAddr | `test_RemitOnlyToTaxAddr` |
| test_shift_replay_reverts | `test_ShiftReplayReverts` |
| test_wrong_attestor_reverts | `test_WrongAttestorReverts` |
| test_suspended_cannot_withdraw | `test_SuspendedCannotWithdrawOrAttest` |
| test_shard_totals_match_balance | `test_ShardTotalsMatchBalance` |
| testFuzz_claimable_never_exceeds_funded | `testFuzz_ClaimableNeverExceedsFunded` |
| invariant_vault_solvency | `invariant_Solvency`, `invariant_Conservation` |
| invariant_no_unbacked_claims | `invariant_NoUnbackedClaims`, `invariant_AllEarningsAreFunded` |

Additional cases: expired signatures, malformed windows, future-dated attestations, worker-signature replay (nonce), wrong signer for withdrawal, correction versioning, reclaim limits, rate rounding, and the worked example above as an end-to-end test.
