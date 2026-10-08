# ShiftPay release phases

Local tests do not prove hosted payroll works. This checklist replaces the earlier prototype status.

## 1. Funded payroll safety: passed locally

Gross accrual stops at funded allocation. Top-ups resume from receipt time without paying paused intervals. Historical clock-out respects funding at its attested end. Suspension pauses accrual, and on-shift rate changes are rejected. Unfunded settlement and corrections consuming open reserves revert.

Verification: 36 unit/fuzz tests and 5 stateful invariants passed. Backend verification: 37 tests passed against the updated contract, including PostgreSQL integration.

## 2. Connected dashboards: local verification

Separate business and employee routes use real contract reads and signed actions. Company registration requires Mera. Employees use Mera or Privy email embedded accounts. External MetaMask controls and public simulation are removed. Profiles, employee notes and settlement histories persist through the bridge.

Verification: 19 wallet/funding tests passed; production build passed. Browser regression must pass for the final release.

## 3. GitHub and hosting: in progress

Repository: https://github.com/Lakshmikanth-3/ShiftPay

Source commits stay below 1,000 changed lines. The owner permits separate larger lockfile and generated ABI commits. Timestamps are actual creation times, with no fabricated hackathon history.

Only approved Vercel destinations: shiftpay-business.vercel.app and shiftpay-employee.vercel.app, under lakshmikanth.27csb@licet.ac.in. Domain reservation alone is not deployment.

Render has two token-specific bridges and PostgreSQL schemas. Its administrator setting must use the actual Mera company address. The configuration passes the official schema validator. Free Render services do not guarantee continuous uptime. Cloud provisioning and healthy endpoints are still required.

## 4. Owner setup and real testnet acceptance: pending

1. Create the company passkey on the stable business domain.
2. Fund its resulting public address with test MON and issuer USDC/AUSD.
3. Sign real vault deployment and employer registration.
4. Configure actual vault, employer, receipt block and service credentials privately on Render.
5. Create the employee's supported account and supply its public payout address.
6. Register the employee, save notes and fund its allocation.
7. Verify an attested shift, growing balance, relayed withdrawal, employee receipt, employer ledger and withholding.
8. Verify exhaustion and top-up behavior with real allocations and retain transaction evidence.

The earlier external company address remains the approved testnet tax recipient. It is not the new Mera administrator. External-wallet funds do not move automatically.

## 5. Sponsor proof, benchmark and submission: pending

Agora/Mera need actual passkey onboarding and AUSD cross-border payroll proof matching portal rules. Privy needs embedded signing beyond login. Envio integration is implemented; owner token and live activation remain pending. No MetaMask trading plugin or unrelated trading integrations are claimed.

A real-network benchmark, live demo recording and final submission follow successful end-to-end acceptance. Local benchmark output is not proof of testnet performance.
