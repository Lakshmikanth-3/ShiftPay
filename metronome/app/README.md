# ShiftPay dashboards

Use Node 24. Run npm ci, configure public settings and server-only bridge URLs from .env.example, then npm run dev. Open http://localhost:3000. The two products are /employer and /employee. /deploy is company setup; former /demo and /preview routes return 404.

The original off-white, dark green and lime identity is retained. Both experiences read real payroll records and use their registered signing accounts. Runtime sample balances, simulation controls and external MetaMask connections are removed.

Company setup uses an owner-created Mera passkey. Employees can use Mera or a Privy email embedded account. Login alone grants no employer or employee authority; signatures must match the registered contract administrator or payout address.

Company profiles, employee notes, allocations and settlement histories are handled by the signed bridge API. Earnings stop at funded allocation. Funding resumes from receipt time without paying unfunded intervals. Employee withdrawals are signed by the employee and relayed at employer expense.

## Tests

- npm test: prepare generated ABI, then wallet and funding unit tests.
- npm run check: unit suite plus production build.
- npm run test:browser: localhost route, mobile and login checks; set TARGET_URL=http://127.0.0.1:3000.
- npm run test:production: approved public portal checks.
- python selenium-test.py: Selenium checks against the live portals and actual public company balance; install requirements-test.txt first.

Browser runners use an isolated Chrome profile. On Linux, Chrome must be on PATH or supplied through CHROME_PATH. Reports live under root data and are excluded from Git.

Current verified public URLs: https://shiftpay-business.vercel.app and https://shiftpay-employee.vercel.app. Real funded settlement remains pending backend/vault setup. See ../docs/SETUP.md and ../docs/PHASES.md.
