# Feedback for sponsor technologies

ShiftPay was built on Monad testnet with **Mera**, **Agora**, **Envio** and **Alchemy**. This file records one main
architectural pain point we hit, with evidence from our code and a proposed fix, followed by smaller issues for each
sponsor. Everything here comes from problems we hit while building and testing ShiftPay, not from guesses.

---

## Contents

1. [Summary](#1-summary)
2. [Main issue: Mera stops at the key, so every app rebuilds the account](#2-main-issue-mera-stops-at-the-key-so-every-app-rebuilds-the-account)
   - [The problem](#21-the-problem)
   - [The real pain point](#22-the-real-pain-point)
   - [Evidence from ShiftPay](#23-evidence-from-shiftpay)
   - [Root cause](#24-root-cause)
   - [What could have been done](#25-what-could-have-been-done)
   - [Near-perfect solution](#26-near-perfect-solution)
   - [Implementation plan](#27-implementation-plan)
   - [Impact](#28-impact)
   - [Risks and trade-offs](#29-risks-and-trade-offs)
   - [How to verify](#210-how-to-verify)
3. [Other issues by sponsor](#3-other-issues-by-sponsor)
4. [Priority table](#4-priority-table)

---

## 1. Summary

| | |
|---|---|
| **Main issue** | Mera derives a signing key from a passkey and stops there. It returns a plain externally owned account (EOA) with a local signer. "No seed phrase, no extension" is solved, but three things a consumer app also needs are left to every app: **atomic batching**, **gas sponsorship** and **account recovery** |
| **Effect on ShiftPay** | Funding an employee needs two separate signatures and transactions (approve, then fund); we built our own relayer, gas-grant service and abuse budgets; a worker who loses their passkey has no way back |
| **Root cause** | The account is the key itself (an EOA), not a programmable account. Programmable features need code at the account address |
| **Proposed fix** | Ship Mera as a passkey-owned **EIP-7702 smart account**: the passkey-derived EOA delegates to a small, audited account contract, and the Mera client implements **EIP-5792** (`wallet_getCapabilities`, `wallet_sendCalls`) with atomic batching, a paymaster hook and passkey-based recovery |
| **Why Monad** | Monad lists EIP-7702 among its supported features, so this needs no new chain feature, only the account layer |

---

## 2. Main issue: Mera stops at the key, so every app rebuilds the account

### 2.1 The problem

Mera's promise is that a user signs in with a passkey and never sees a seed phrase or a wallet extension. It delivers
that: `createPasskeyWithPrfOutput` and `getPasskeyPrfOutput` return a PRF secret, and the app derives a secp256k1 key
from it (`createSecp256k1SigningSession`).

But the result is a **bare EOA with a local signer**. A consumer payments app needs more than a key:

```text
  WHAT A CONSUMER APP NEEDS              WHAT MERA PROVIDES TODAY
  ─────────────────────────              ────────────────────────
  sign in without a seed phrase   ──▶    ✅ passkey → PRF → key
  one tap for a multi-step action ──▶    ❌ no batching (EOA: one call per tx)
  no gas for the user             ──▶    ❌ user's EOA must hold MON
  get the account back if lost    ──▶    ❌ key = passkey; lose it, lose the account
  standard wallet interface       ──▶    ❌ no EIP-5792 capabilities to discover
```

### 2.2 The real pain point

The pain is not one bug. It is that the **same three systems get rebuilt by every Mera app**, each slightly
differently and each with its own security risks:

1. **Batching.** An ERC-20 deposit is `approve` then `transferFrom`. With an EOA that is two signatures and two
   transactions. If the second fails, the user is left with a dangling allowance and no deposit.
2. **Gas.** A passkey user arrives with 0 MON. Every app must either ask a "non-crypto" user to buy gas (which breaks
   the point of Mera) or run its own relayer, top-up service, rate limits and abuse controls.
3. **Recovery.** The account *is* the passkey. Synced passkeys (Google Password Manager, iCloud Keychain) help, but a
   passkey that is deleted, or a device-bound one that is lost, means the funds in that account are unreachable.

For a payroll product this is serious: the users are the people least able to recover from losing wages.

### 2.3 Evidence from ShiftPay

| What we hit | Where in our code | What we had to build |
|---|---|---|
| The Mera wallet has no `wallet_getCapabilities`; asking for it went to the public RPC and failed, so funding broke until we special-cased it | `app/lib/funding.mjs`: *"A local signer (Mera passkey) has no wallet capabilities endpoint; asking the public RPC fails."* | A fallback mode `approve-then-fund`: two signatures, two transactions, no atomicity |
| Passkey users start with 0 MON | `bridge/src/dashboard.ts` `/gas-grants` | A gas-grant service: 0.1 MON once per new address, 0.2 MON a day per worker |
| A free gas service is a drain target | `bridge/src/employers.ts` `assertSponsoredBudget` | Per-company daily budgets (60 transactions), worker-credit caps, a global daily cap. We lost hours to a cap being exhausted during testing |
| Workers must not pay gas to withdraw | `withdrawWithSig` in the contract and `bridge/src/services/withdrawals.ts` | A custom EIP-712 meta-transaction, a relayer queue with retries, and a weekly free-withdrawal policy |
| Monad reserves `gasLimit × maxFee` up front | `app/components/wallet-app.jsx` (`lowFee`) | A 0.05 MON headroom rule so an Agora settlement does not fail for lack of reserve |
| No recovery path | `docs/LIMITATIONS.md` | Nothing yet: a fully lost passkey is a stated known gap |

A large part of our backend (the relayer, gas grants, budgets and withdrawal policy) exists only because the account
is a bare EOA.

### 2.4 Root cause

```text
  passkey ──PRF──▶ 32-byte secret ──derive──▶ secp256k1 key ──▶ EOA address
                                                                  │
                                         no code at this address  │
                                                                  ▼
                                     cannot batch · cannot be sponsored natively
                                     cannot change owner · cannot recover
```

Every missing feature needs **code at the account address**: a batch executor, a validation hook a sponsor can pay
for, an owner that can be rotated. An EOA has none. This is an architectural choice, not a missing parameter.

### 2.5 What could have been done

| Option | Pros | Cons |
|---|---|---|
| Leave it to apps (today) | Simple SDK | Every app rebuilds relayers and budgets; inconsistent security; no recovery |
| ERC-4337 smart account at a new address | Mature ecosystem: bundlers, paymasters | Needs bundler infrastructure; the account address differs from the passkey EOA; heavier |
| **EIP-7702 delegation of the passkey EOA** | Same address the user already has; batching and sponsorship via the delegate's code; supported on Monad | Delegate contract must be audited; delegation needs one signed authorization |

### 2.6 Near-perfect solution

**Mera Account: the passkey-derived EOA delegates, via EIP-7702, to a minimal audited account contract, and the Mera
client exposes it through the standard EIP-5792 wallet interface.**

```text
  passkey ──PRF──▶ key ──▶ EOA ──EIP-7702 authorization──▶ MeraAccount (delegate code)
                                                             ├─ executeBatch(calls)        atomic
                                                             ├─ validate(sponsor, policy)  gasless
                                                             └─ recovery(newOwnerKey)      passkey rotation
  Mera client
   ├─ wallet_getCapabilities → { atomic: ready, paymasterService, recovery }
   ├─ wallet_sendCalls       → one passkey prompt, one atomic transaction
   └─ wallet_getCallsStatus  → status + receipts
```

What each part fixes:

| Part | Fixes |
|---|---|
| `executeBatch` in the delegate | approve + fund (and any multi-step action) becomes **one signature, one atomic transaction** |
| EIP-5792 in the client | Apps discover features in a standard way; viem's `sendCalls` works unchanged; no special-casing of "local signers" |
| Sponsor hook (paymaster-style, policy signed by the sponsor) | Apps sponsor gas without running their own relayer, gas grants or top-up logic; budgets become a signed policy (per user, per day, per contract), checked on chain |
| Passkey rotation and recovery | The account owner can add a second passkey (a backup device) or a guardian; a lost passkey is no longer lost money |
| Separate PRF namespaces kept as they are | Non-account uses, such as ShiftPay's encrypted payslips (`shiftpay.payslips.v1`), keep working |

### 2.7 Implementation plan

1. **Delegate contract (MeraAccount):** batch executor, owner = passkey-derived key, optional second owner, sponsor
   validation hook. Keep it small; audit it; publish one canonical address per chain.
2. **Delegation on first use:** the Mera client signs a single EIP-7702 authorization when the account is created,
   bundled into the first sponsored transaction so the user sees nothing extra.
3. **EIP-5792 in the Mera client:** implement `wallet_getCapabilities` (atomic: `ready`), `wallet_sendCalls` and
   `wallet_getCallsStatus`, mapped onto `executeBatch`.
4. **Sponsor policy:** a sponsor signs a policy (allowed contracts, per-user daily limit, expiry); the delegate
   checks it and the sponsor's balance pays. This replaces app-run relayers for most uses.
5. **Recovery:** "Add a backup passkey" in the SDK (a second device or a security key), plus an optional guardian
   with a time delay.
6. **Migration:** existing Mera EOAs keep their address; delegation is opt-in and reversible.

### 2.8 Impact

For ShiftPay specifically:

| Today | With Mera Account |
|---|---|
| Fund an employee: 2 prompts, 2 transactions, possible dangling allowance | 1 prompt, 1 atomic transaction |
| Relayer + gas grants + per-company budgets + weekly allowance (custom code) | A signed sponsor policy |
| Lost passkey = lost wages (known gap) | Backup passkey or guardian recovery |
| Custom `withdrawWithSig` meta-transactions | A sponsored `withdraw()` call |

For the Mera ecosystem: every app gets one-tap actions, gasless onboarding and recovery from the SDK, with one
audited implementation instead of many home-made relayers.

### 2.9 Risks and trade-offs

- **Delegate security:** a bug in the shared delegate affects every account; mitigate with a minimal contract, an
  audit, and opt-in delegation.
- **Sponsor abuse:** a sponsor policy must include limits; the delegate enforces them on chain instead of each app's
  server.
- **Recovery trust:** a guardian is a trust assumption; offer "backup passkey only" as the default.
- **Wallet compatibility:** EIP-7702 support must be present in tooling; viem already supports authorizations and
  EIP-5792.

### 2.10 How to verify

- Before: in ShiftPay, fund an employee whose allowance is too low; observe two passkey-signed transactions
  (`approve`, then `fundWorkers`) on MonadScan.
- After: the same action produces one transaction calling `executeBatch`, and `wallet_getCapabilities` returns
  `atomic: ready`.
- Gas: a new passkey account with 0 MON can withdraw and send without any app-run top-up service.
- Recovery: delete the main passkey, sign in with the backup passkey, and reach the same address and balance.

---

## 3. Other issues by sponsor

### Envio HyperSync

| | |
|---|---|
| **Problem** | The HyperSync JSON response did not match the shape we expected from the docs: `data` arrives as a list of batches (sometimes a single object), and absent topics are **omitted** rather than sent as `null` |
| **Evidence** | `bridge/src/envio.ts`: *"HyperSync omits absent topics instead of sending null"* and *"returns data as a list of batches"*; our first parser silently missed events |
| **Pain** | Silent data loss is the worst failure for an indexer: payroll history looked empty |
| **Fix** | Publish a JSON Schema / typed client for the HTTP API, with one stable shape (always an array; topics always present, `null` when absent), and an example for Monad testnet |

### Agora

| | |
|---|---|
| **Problem 1** | The testnet faucet's cooldown reverts with a bare custom-error selector (`0x20e5bc67`), so apps show "execution reverted" unless they hard-code the selector |
| **Fix 1** | Ship the faucet ABI with named errors (e.g. `CooldownActive(uint256 nextAllowedAt)`) so apps can show "try again at …" |
| **Problem 2** | On testnet the Instant Settlement pair settles AUSD only to a test token (CTK), so a "send home in local currency" flow cannot be shown end to end |
| **Fix 2** | Publish testnet pairs that mirror the planned mainnet corridors (for example a test INR or PHP token) and document them |

### Monad testnet

| | |
|---|---|
| **Problem 1** | The public RPC allows about 25 requests a second; a live balance that refreshes every second for several users hits it quickly |
| **Fix 1** | Document recommended fallback providers per tier, or offer a websocket subscription for `eth_call` results |
| **Problem 2** | The testnet explorer (monadexplorer.com) shows a bot check, which blocks automated receipt checks and some judge links; MonadScan works |
| **Fix 2** | Exempt read-only transaction pages from the challenge, or link MonadScan as the default explorer in the docs |
| **Problem 3** | Monad reserves `gasLimit × maxFee` up front, so a sponsored account needs headroom well above the real cost; this surprised us when funding new accounts |
| **Fix 3** | State the reserve rule prominently in the "differences from Ethereum" docs, with a worked example |

### Alchemy

No blocking issue. The dedicated Monad endpoint removed the public-RPC rate-limit failures we saw in bursts.

---

## 4. Priority table

| Priority | Sponsor | Issue | Effort | Benefit |
|---|---|---|---|---|
| 1 | Mera | Bare EOA: no batching, sponsorship or recovery | High | Every Mera app drops its relayer and gets recovery |
| 2 | Envio | HyperSync JSON shape not documented as returned | Low | Prevents silent data loss |
| 3 | Agora | Faucet errors not decodable; no local-currency test pairs | Low | Clearer demos of cross-border flows |
| 4 | Monad | RPC limits, explorer bot check, gas reserve rule | Low to medium | Smoother consumer-app development |
