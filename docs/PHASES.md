# ShiftPay release phases

Local tests do not prove hosted payroll works. This checklist replaces the earlier prototype status.

## 1. Funded payroll safety: passed locally

Gross accrual stops at funded allocation. Top-ups resume from receipt time without paying paused intervals. Historical clock-out respects funding at its attested end. Suspension pauses accrual, and on-shift rate changes are rejected. Unfunded settlement and corrections consuming open reserves revert.

Verification: 36 unit/fuzz tests and 5 stateful invariants passed. Backend verification: 38 tests passed against the updated contract, including PostgreSQL integration and public-account preflight.

## 2. Connected dashboards: local verification

Separate business and employee routes use real contract reads and signed actions. Company registration requires Mera. Both portals use Mera passkeys as the only account layer. External MetaMask controls and public simulation are removed. Profiles, employee notes and settlement histories persist through the bridge.

Verification: 25 wallet/funding tests, 23 localhost browser checks, 22 public production browser checks and 22 Selenium checks passed. Production build passed. These public checks do not prove authenticated payroll settlement. Saved company registration can be displayed while the signing session is locked; signing still requires the actual Mera session.

## 3. GitHub and hosting: done

Repository: https://github.com/Lakshmikanth-3/ShiftPay. Source commits stay below 1,000 changed lines; timestamps are actual creation times, with no fabricated hackathon history.

- Business website: https://shiftpay-business.vercel.app (`/employer`, `/deploy`)
- Employee mobile wallet: https://shiftpay-employee.vercel.app (`/employee`, `/send`, `/receive`, `/cashout`, `/history`, `/profile`)

The payroll bridge runs inside the business Vercel project (`/api/bridge/*`) on Neon Postgres with one schema per token; build applies Prisma migrations. The employee project relays bridge calls to the business project with a shared secret. Render is no longer used. Vault events are indexed into Postgres because the public Monad RPC limits `eth_getLogs` to 100 blocks and 25 requests per second. `npm run test:live` checks both deployments read-only.

## 4. Owner setup and real testnet acceptance: in progress

1. Done: company Mera passkey `0x430ff06AB045911e5dC6B7a742ddC11f27F47487` on the business domain, holding 20 USDC and test MON.
2. Done: USDC vault `0xA1C794EA48A1D86294848D28E85c76328070DB24`, deployment block 69456787, employer ID 1; administrator, attestor and tax recipient verified on chain.
3. Done: USDC bridge live and healthy on Vercel; relayer `0xC3cDFA6fB75c91c1B26A6067111b1679e2edE494` funded with MON.
4. Done: employee Mera passkey created on the employee domain.
5. Pending: register the employee with an allocation and 0.1 MON for fees.
6. Pending: verified shift, growing balance, relayed withdrawal, employer ledger and withholding.
7. Pending: exhaustion and top-up with real allocations; retain transaction evidence.
8. Pending: AUSD vault (fund relayer `0x2FcE83C7Ea6708e831F9D5bD9F12A8154587CfAD`, deploy from `/deploy`, run `node scripts/configure-vercel.cjs ausd …`, redeploy).

The earlier external address `0x4e3f8497F732326CFB8cC4d17Ad0688b74582776` remains the testnet tax recipient. It is not the Mera administrator.

## 5. Sponsor proof, benchmark and submission: pending

Agora/Mera features are implemented against Agora's published testnet contracts: Mera passkey onboarding, AUSD faucet, person-to-person AUSD transfers and Instant Settlement (AUSD → CTK) in the employee mobile wallet. On-chain proof transactions remain to be recorded. Send-abroad uses Instant Settlement for the transfer itself; private payslips use a separate PRF namespace; new accounts receive an automatic fee credit.

A real-network benchmark, the demo recording and the final submission follow end-to-end acceptance. Local benchmark output is not proof of testnet performance.
