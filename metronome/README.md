# ShiftPay

Employer funded earned-wage access on Monad. The contract backs worker payouts and withholding with deposited tokens; work is attested by the employer bridge. Withdrawals are authorized by the registered payout wallet and submitted by employer-funded relayers.

## Run

Use Node 24, Docker Desktop, and Foundry (`forge`, `anvil`). On Windows add `%USERPROFILE%\.foundry\bin` to PATH.

1. In `bridge`, run `npm ci`, `npm run db:up`, and `npm run generate`.
2. Deploy/configure the contracts using [the setup guide](docs/SETUP.md), then configure `bridge/.env` from `.env.example`.
3. In `bridge`, run `npm run db:push`, then `npm start`.
4. In `app`, run `npm ci`, copy `.env.example` to `.env.local`, and run `npm run dev`.
5. Open http://localhost:3000. Business payroll is `/employer`; employee payroll is `/employee`. Former simulation routes return 404.

Payroll writes use wallet signatures. The connected UI never uses sample balances as contract balances. Employer funding requires token approval and MON in the employer wallet; worker withdrawals are relayed without worker gas. Privy login alone does not grant employer privileges.

## Verification

Contracts: `forge test` in `contracts`.
Bridge: `npm run typecheck` and `npm test` in `bridge`; full integration needs local Postgres and Foundry.
App: `npm run check` in `app` runs wallet/funding tests and the production build. Run `npm run test:browser` with `TARGET_URL=http://127.0.0.1:3000` for browser regression.
Benchmark: `npm run benchmark` in `bridge`; see [benchmark instructions](benchmark/README.md).

## Scope and trust

This is a hackathon implementation, not a jurisdiction-specific payroll/tax calculation. The employer attestor controls recorded work; correction recovery uses future accrual rather than wallet clawback. See [architecture](docs/architecture.md) and [trust model](docs/trust-model.md).

Deployment and performance claims must include recorded addresses, raw measurements and the target environment. Local Anvil measurements do not demonstrate Monad parallel execution.
