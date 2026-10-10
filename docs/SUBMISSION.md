# Submission checklist

Event: Monad Metropolis · Track 02 — Consumer Products & Payments · bounties: Agora (cross-border AUSD), Privy.

## Done
- [x] Architecture and trust model documented ([architecture](architecture.md), [trust model](trust-model.md)).
- [x] Contract suite and accounting invariants (36 unit/fuzz tests, 5 invariants).
- [x] Payroll bridge with Postgres persistence, hosted on Vercel + Neon.
- [x] Business website: https://shiftpay-business.vercel.app
- [x] Employee mobile wallet: https://shiftpay-employee.vercel.app
- [x] Mera passkey accounts for company and employee; Privy email as an alternative.
- [x] Agora integration: faucet, AUSD send/receive, Instant Settlement (AUSD → CTK).
- [x] USDC vault deployed: `0xA1C794EA48A1D86294848D28E85c76328070DB24` (block 69456787, employer 1).
- [x] Live read-only acceptance checks (`npm run test:live` in `app`).
- [x] MIT licence and dependency disclosure ([DEPENDENCIES.md](DEPENDENCIES.md)).

## Remaining
- [ ] Register an employee and complete a real USDC cycle: shift, accrual, relayed withdrawal, ledger.
- [ ] Record Agora proof transactions: faucet, AUSD transfer, Instant Settlement.
- [ ] Deploy the AUSD vault and repeat the payroll cycle in AUSD.
- [ ] Exhaustion and top-up check with real allocations.
- [ ] Real-network shift-change benchmark with raw data.
- [ ] Record the demo video (under three minutes); see [DEMO.md](DEMO.md).
- [ ] Confirm the submission form fields and bounty rules in the portal.
