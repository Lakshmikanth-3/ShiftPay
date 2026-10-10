# Track and bounties

Checked against the signed-in Metropolis portal (hackathon.monad.xyz/tracks) on 11 Oct 2026.
Deadline shown by the portal: 14 Oct 2026, 09:29 IST.

## Primary track: Consumer Products & Payments

The track lists *salary streaming: get paid every second rather than bi-weekly* among its suggested ideas.

| Criterion | Weight | ShiftPay evidence |
|---|---|---|
| Technical execution | 20% | Vault on Monad testnet with funded accrual, signed shifts, relayed withdrawals, tax escrow; 36 tests + 5 invariants |
| Design & craft (invisible blockchain) | 20% | Passkey-only accounts, dollar wording, automatic fee credit, no wallet prompts |
| Originality & track insight | 15% | Wages capped by deposited money: earned-wage access with no lender |
| Founder & market readiness | 25% | Named segment and pain: [USE_CASE.md](USE_CASE.md) |
| Traction & path forward | 20% | Distribution plan in [USE_CASE.md](USE_CASE.md); testing kit and results log in [USER_TESTING.md](USER_TESTING.md) |

Deliverables: logo, public repo accessible to metropolis@hackathon.monad.xyz, technical demo video (≤3 min, live
product), pitch video (≤2 min), live link with access instructions ([JUDGE_ACCESS.md](JUDGE_ACCESS.md)).

## Sponsor bounties entered

| Bounty | Requirement | ShiftPay |
|---|---|---|
| **Agora Cross-Border Payments** ($10k) | Mobile app; send AUSD to another person or across borders; Mera passkey onboarding; instant settlement for the transfer itself; Agora public API; Instant Settlement contract on Monad testnet | Employee mobile wallet. *Send → Abroad* routes the sender's AUSD through Agora's CTK/AUSD pair `0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae` with the recipient as the swap's receiver, so the transfer itself is the instant settlement. Agora public API `/v0/metrics` shown live. Faucet and whitelister from Agora's deployments page. |
| **Best Mera-Powered UX** ($2.5k) | Mera as the entire account layer; one-prompt onboarding; scoped prompt-free sessions; stateless test; time to first transaction | Privy removed; passkey-only. 15-minute signing session, then re-prompt. Payroll found from the passkey address on chain after storage is cleared. Automatic fee credit for new accounts. |
| **Mera: One Passkey, Many Keys** ($2.5k) | A PRF namespace doing non-account work, cross-device | Private payslips: separate salt `sha256("shiftpay.payslips.v1")`, HKDF → AES-256-GCM key and opaque storage id; ciphertext only on the server; decrypts on any device with the passkey. |
| **Best Use of Envio** ($1k) | HyperIndex/HyperSync/HyperRPC driving a feature | HyperSync source implemented in `bridge/src/envio.ts` for vault event indexing; activation needs the team's Envio API token. |
| **Best Community Team Project** ($5k) | Team represents an onboarded campus community | Eligible only if the team's campus group is selectable in the portal profile. |

## Not entered

Privy (login-only would not qualify, and Mera is the whole account layer), Dynamic (replaces Mera), Agora
Trading, Kuru, Perpl, MetaMask Agent Wallet (trading), Cleanverse (identity-gated assets), Aurora Intents,
Alchemy, Chainlink CRE, Nansen and AI-model bounties (no genuine fit with payroll).
