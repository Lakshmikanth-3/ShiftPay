# ShiftPay real testnet setup

## Live portals

- Company: https://shiftpay-business.vercel.app/deploy
- Employee: https://shiftpay-employee.vercel.app
- Repository: https://github.com/Lakshmikanth-3/ShiftPay

The portals and the USDC payroll backend are live. Funded employee settlement and the AUSD vault are still pending. See PHASES.md for verified release gates.

## Company account

Enter the company name on the company setup page and create its Mera payroll passkey. The account address is derived from the owner's actual passkey; it is not randomly assigned. Create it on the final business domain because a localhost passkey does not unlock on a different domain.

Use the displayed receive address to fund the account with Monad testnet MON and issuer test USDC/AUSD. Existing funds in an external wallet stay there until the owner sends them. ShiftPay has no external MetaMask connector. Never import a private key or recovery phrase into this flow.

The earlier address 0x4e3f8497F732326CFB8cC4d17Ad0688b74582776 remains the explicitly approved testnet withholding recipient. It is separate from the newly created company signing account and the employee payout account.

## Deploy payroll

Choose USDC or AUSD and register the company using the single primary action. The app signs real vault deployment and employer registration with the unlocked Mera account. Deployment success requires confirmed receipts. The token is immutable, so each asset needs its own vault.

Record the actual vault address, employer ID, deployment receipt block and transaction hash for each asset. Do not fill configuration with example addresses. The company name is retained with the browser deployment record; it is saved to the service once the backend is ready and the company authorizes its profile request.

## Payroll backend (Vercel + Neon)

The bridge runs inside the business Vercel project. `sync-bridge.cjs` bundles `bridge/src` into the app, the build applies Prisma migrations to one Neon schema per configured token, and `/api/bridge/*` serves requests in-process. The employee project relays to it with `BRIDGE_ORIGIN` and `BRIDGE_RELAY_SECRET`.

Run `node scripts/configure-vercel.cjs` in `app` once to set both projects' variables from the ignored `bridge/.env.runtime-keys` file without printing secrets. After deploying a vault for another token, run `node scripts/configure-vercel.cjs ausd <vault> <deployBlock> <employerId>` and redeploy. Check `https://shiftpay-business.vercel.app/api/bridge/health?asset=USDC` before use.

## Employee registration

The employee creates a passkey on the employee portal or signs in through Privy email to create an embedded account. They give their actual public address to the company. Previously supplied external accounts are not silently used for registration.

The company enters the employee's name, role, department, payroll ID, payout address, hourly rate, withholding rate, allocation and notes. Confirmed registration, funded allocation and signed profile persistence are separate recorded results. A later failure does not undo an earlier confirmed transaction.

The company starts a verified shift. The employee opens that payroll ID and their own payout account, sees wages increasing within the funded gross budget, and signs a withdrawal. The employer's relayer pays settlement gas. Funds go only to the registered employee address. Tax remains separate from net pay.

## Acceptance tests

Local contract fixtures and PostgreSQL tests are isolated tests, not deployed payroll proof. On the real release, configure TESTNET_APP_URL, TESTNET_EMPLOYER_ADDRESS, TESTNET_EMPLOYEE_ADDRESS and the asset-specific worker IDs and deployment blocks from observed records, then run npm run test:testnet in bridge.

Verify both assets: funded shift, increasing earnings, employee receipt, employer ledger update, withholding, exhausted-funding pause and top-up without retroactive accrual. Keep transaction and balance evidence. Missing setup is a failed release gate.

Envio activation requires the owner's API token stored privately in bridge/server configuration. Only enable the Envio event source after configuration; provider failures must stay visible. No trading plugin or liquidity integration is claimed.
