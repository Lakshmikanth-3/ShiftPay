# ShiftPay

**Earned wages, paid as you work — on Monad.**

Employers fund payroll in USDC or AUSD. Verified shifts accrue wages every second, capped by the funded allocation, with tax withheld into escrow. Employees withdraw any time with a passkey, without paying gas, and can send AUSD anywhere or cash out through Agora Instant Settlement.

| | Link |
|---|---|
| Business website | https://shiftpay-business.vercel.app |
| Employee mobile wallet | https://shiftpay-employee.vercel.app |
| USDC payroll vault (Monad testnet) | `0xA1C794EA48A1D86294848D28E85c76328070DB24` |

## Repository

| Path | Contents |
|---|---|
| [contracts](contracts) | `MetronomeVault` (Foundry): funded accrual, withholding escrow, signed withdrawals |
| [bridge](bridge) | Attestation and relay service (TypeScript, Prisma) |
| [app](app) | Next.js business dashboard and employee wallet; hosts the bridge on Vercel |
| [docs](docs) | Architecture, trust model, setup, phases, bounties, submission, demo |
| [benchmark](benchmark) | Shift-change benchmark procedure and local harness results |

Start with [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for running and testing, and [docs/PHASES.md](docs/PHASES.md) for current status.

Built for Monad Metropolis, Track 02 — Consumer Products & Payments. MIT licence.
