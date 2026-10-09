# ShiftPay release phases

Local tests do not prove hosted payroll works. This checklist replaces the earlier prototype status.

## 1. Funded payroll safety: passed locally

Gross accrual stops at funded allocation. Top-ups resume from receipt time without paying paused intervals. Historical clock-out respects funding at its attested end. Suspension pauses accrual, and on-shift rate changes are rejected. Unfunded settlement and corrections consuming open reserves revert.

Verification: 36 unit/fuzz tests and 5 stateful invariants passed. Backend verification: 38 tests passed against the updated contract, including PostgreSQL integration and public-account preflight.

## 2. Connected dashboards: local verification

Separate business and employee routes use real contract reads and signed actions. Company registration requires Mera. Employees use Mera or Privy email embedded accounts. External MetaMask controls and public simulation are removed. Profiles, employee notes and settlement histories persist through the bridge.

Verification: 25 wallet/funding tests, 23 localhost browser checks, 22 public production browser checks and 22 Selenium checks passed. Production build passed. These public checks do not prove authenticated payroll settlement. Saved company registration can be displayed while the signing session is locked; signing still requires the actual Mera session.

## 3. GitHub and hosting: in progress

Repository: https://github.com/Lakshmikanth-3/ShiftPay

Source commits stay below 1,000 changed lines. The owner permits separate larger lockfile and generated ABI commits. Timestamps are actual creation times, with no fabricated hackathon history.

Both approved Vercel destinations are deployed and publicly checked: shiftpay-business.vercel.app and shiftpay-employee.vercel.app, under lakshmikanth.27csb@licet.ac.in. The obsolete shiftpay-monad-payroll, employee-dashboard and business-dashboard projects have been removed after replacement checks passed.

Render has two token-specific bridges and PostgreSQL schemas. Its administrator setting must use the actual Mera company address. The configuration passes the official schema validator. Free Render services do not guarantee continuous uptime. Cloud provisioning and healthy endpoints are still required.

## 4. Owner setup and real testnet acceptance: pending

1. Company passkey created: owner confirmed public address 0x430ff06AB045911e5dC6B7a742ddC11f27F47487 on the stable business domain.
2. Three test MON confirmed in the Mera company account; issuer USDC/AUSD wage funding remains pending.
3. USDC vault 0xA1C794EA48A1D86294848D28E85c76328070DB24 and employer ID 1 verified through public contract reads. Administrator, attestor and tax recipient match the approved accounts. Exact deployment receipt collection and AUSD setup remain pending.
4. Configure actual vault, employer, receipt block and service credentials privately on Render.
5. Create the employee's supported account and supply its public payout address.
6. Register the employee, save notes and fund its allocation.
7. Verify an attested shift, growing balance, relayed withdrawal, employee receipt, employer ledger and withholding.
8. Verify exhaustion and top-up behavior with real allocations and retain transaction evidence.

The earlier external company address remains the approved testnet tax recipient. It is not the new Mera administrator. External-wallet funds do not move automatically.

## 5. Sponsor proof, benchmark and submission: pending

Agora/Mera need actual passkey onboarding and AUSD cross-border payroll proof matching portal rules. Privy needs embedded signing beyond login. Envio integration is implemented; owner token and live activation remain pending. No MetaMask trading plugin or unrelated trading integrations are claimed.

A real-network benchmark, live demo recording and final submission follow successful end-to-end acceptance. Local benchmark output is not proof of testnet performance.
