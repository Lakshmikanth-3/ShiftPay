# Known limitations and how each is addressed

ShiftPay is a working testnet product. This is the honest list of what it does not yet do, and the plan for each.

| Limitation | Done now | Next |
|---|---|---|
| Testnet only, not audited | 43 Foundry tests incl. 5 invariants; Slither scan triaged in [SECURITY.md](SECURITY.md) | Professional audit before mainnet; launch with per-company deposit caps so any bug has bounded impact |
| Hours are attested by the employer | Every shift line is EIP-712 signed and verifiable; clock events need the company admin's signature; the bridge has an HMAC webhook (`/webhooks/clock`) for time clocks and POS systems | Worker co-signs each closed shift on their phone; "dispute this shift" flow using the contract's versioned `correctShift` |
| Flat tax rate | Per-worker withholding (bps) escrowed on chain and remitted only to the company's fixed tax address | Country tax tables (e.g. Indian TDS slabs) and downloadable tax reports from on-chain records |
| Employer pays gas | Sponsored withdrawals: minimum 1 AUSD/USDC (or the whole balance) and 5 free per worker per week; then the worker withdraws directly (daily gas grant). Self-serve companies have daily sponsored-gas budgets | Batched withdrawals; gas folded into the per-employee monthly fee |
| Funding locked up front | Low-runway alarm on the dashboard; funding can be weekly instead of monthly; unearned funding can be reclaimed at any time | Automatic top-up when runway is low; optional disclosed yield on idle funds |
| Testnet cash-out | AUSD sent abroad via Agora Instant Settlement in one transaction | Licensed off-ramp partner for bank/UPI payouts; real AUSD pairs on mainnet |
| Centralised service parts | Each company can register its own attestor (`createEmployer`); workers can always call `withdraw()` themselves without the relayer; multiple relayer keys supported | Per-company attestor keys by default; independent relayers |
| Parallelism at small scale | 96/96 transactions on testnet, about 2 s; reported honestly with no shard advantage at 16 workers ([benchmark](../benchmark/README.md)) | Rerun with hundreds of workers from several senders |
| Lost passkey | Passkeys sync via Google Password Manager or iCloud Keychain; same passkey restores the account on a new phone | Employer-assisted payout-address recovery for a fully lost passkey |
| Employer top-up | Funding page per employee; runway warning | Automatic top-up |
| Web app, not a store app | Installable mobile web app; passkeys work like a native app | Android Trusted Web Activity for the Play Store |
| No revenue yet | Business model: monthly fee per active employee, paid by the employer; no worker fees | Free campus pilot, then paid after 30 days |
