# ShiftPay dashboards

Use Node 24. Run npm ci, configure settings from .env.example (PAYROLL_BACKEND=local runs the bundled bridge in-process; the employee project uses BRIDGE_ORIGIN and BRIDGE_RELAY_SECRET), then npm run dev. Open http://localhost:3000. The two products are /employer and /employee. /deploy is company setup; former /demo and /preview routes return 404.

The original off-white, dark green and lime identity is retained. Both experiences read real payroll records and use their registered signing accounts. Runtime sample balances, simulation controls and external MetaMask connections are removed.

Company setup uses an owner-created Mera passkey. Employees can use Mera or a Privy email embedded account. Login alone grants no employer or employee authority; signatures must match the registered contract administrator or payout address.

Company profiles, employee notes, allocations and settlement histories are handled by the signed bridge API. Earnings stop at funded allocation. Funding resumes from receipt time without paying unfunded intervals. Employee withdrawals are signed by the employee and relayed at employer expense.

## Tests

- npm test: prepare generated ABI, then wallet and funding unit tests.
- npm run test:live: read-only live acceptance against both deployed sites and the USDC vault; set WORKER_ID to also compare one employee with on-chain state.
- npm run check: unit suite plus production build.
- npm run test:browser: localhost route, mobile and login checks; set TARGET_URL=http://127.0.0.1:3000.
- npm run test:production: approved public portal checks.
- python selenium-test.py: Selenium checks against the live portals and actual public company balance; install requirements-test.txt first.

Browser runners use an isolated Chrome profile. On Linux, Chrome must be on PATH or supplied through CHROME_PATH. Reports live under root data and are excluded from Git.

Live: https://shiftpay-business.vercel.app (company website: `/deploy`, `/employer`) and https://shiftpay-employee.vercel.app (mobile employee wallet: `/employee`, `/employee/send`, `/employee/receive`, `/employee/cashout`, `/employee/history`, `/employee/profile`). The payroll bridge runs inside the business Vercel project at `/api/bridge/*` with Neon Postgres; the employee project relays bridge calls to it.

The employee wallet (wallet-app.jsx, agora.mjs) adds Agora AUSD: faucet request, person-to-person AUSD/USDC send, receive QR, and Agora Instant Settlement (AUSD -> CTK). See ../docs/SETUP.md and ../docs/PHASES.md.

## Layout

| Folder | Contents |
|---|---|
| `app/` | Next.js routes: `/employer`, `/employee`, `/deploy`, and `/api/bridge/*` (payroll API) |
| `components/` | React screens: `business-app.jsx` (business dashboard), `wallet-app.jsx` (employee mobile wallet), `deployment.jsx` (company setup), `payroll.jsx` (shared payroll state and signing) |
| `lib/` | Agora (`agora.mjs`), Mera passkeys (`mera.mjs`), funding helpers, token list, vault ABI and deployment artifacts |
| `styles/` | CSS for each portal |
| `scripts/` | Build helpers (`sync-bridge.cjs`, `migrate-payroll.cjs`, `prepare-public.cjs`) and `configure-vercel.cjs` |
| `tests/` | Unit tests, live read-only checks (`e2e-live.test.mjs`), browser and Selenium checks |
