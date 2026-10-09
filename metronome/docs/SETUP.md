# ShiftPay real testnet setup

## Live portals

- Company: https://shiftpay-business.vercel.app/deploy
- Employee: https://shiftpay-employee.vercel.app
- Repository: https://github.com/Lakshmikanth-3/ShiftPay

The portals are deployed. Real payroll vaults, hosted bridge endpoints and funded employee settlement are still pending. See PHASES.md for verified release gates.

## Company account

Enter the company name on the company setup page and create its Mera payroll passkey. The account address is derived from the owner's actual passkey; it is not randomly assigned. Create it on the final business domain because a localhost passkey does not unlock on a different domain.

Use the displayed receive address to fund the account with Monad testnet MON and issuer test USDC/AUSD. Existing funds in an external wallet stay there until the owner sends them. ShiftPay has no external MetaMask connector. Never import a private key or recovery phrase into this flow.

The earlier address 0x4e3f8497F732326CFB8cC4d17Ad0688b74582776 remains the explicitly approved testnet withholding recipient. It is separate from the newly created company signing account and the employee payout account.

## Deploy payroll

Choose USDC or AUSD and register the company using the single primary action. The app signs real vault deployment and employer registration with the unlocked Mera account. Deployment success requires confirmed receipts. The token is immutable, so each asset needs its own vault.

Record the actual vault address, employer ID, deployment receipt block and transaction hash for each asset. Do not fill configuration with example addresses. The company name is retained with the browser deployment record; it is saved to the service once the backend is ready and the company authorizes its profile request.

## Render backend

Connect Lakshmikanth-3/ShiftPay in Render and create a Blueprint from root render.yaml, branch main. It defines two token-specific bridge services and one PostgreSQL database with separate schemas. See RENDER.md.

Set each service's actual VAULT_ADDRESS, VAULT_DEPLOY_BLOCK, EMPLOYER_ID and EXPECTED_EMPLOYER_ADMIN. The administrator must be the real Mera company address. Configure the matching attestor and relayer secrets privately. Locally prepared service keys are in an ignored environment file; app/deployment-accounts.json contains only public service addresses. Never paste keys into chat or commit them.

Startup applies Prisma migrations and checks chain, token, registered attestor and configured administrator before serving payroll. Fund the displayed gas-paying service account with test MON using the explicit company action. Check the observed service /health endpoint before attaching it to either portal.

Set BRIDGE_AUSD_URL and BRIDGE_USDC_URL on both Vercel projects to the observed HTTPS Render service URLs. Redeploy only the approved projects. Missing services produce a visible setup-pending state rather than sample payroll.

## Employee registration

The employee creates a passkey on the employee portal or signs in through Privy email to create an embedded account. They give their actual public address to the company. Previously supplied external accounts are not silently used for registration.

The company enters the employee's name, role, department, payroll ID, payout address, hourly rate, withholding rate, allocation and notes. Confirmed registration, funded allocation and signed profile persistence are separate recorded results. A later failure does not undo an earlier confirmed transaction.

The company starts a verified shift. The employee opens that payroll ID and their own payout account, sees wages increasing within the funded gross budget, and signs a withdrawal. The employer's relayer pays settlement gas. Funds go only to the registered employee address. Tax remains separate from net pay.

## Acceptance tests

Local contract fixtures and PostgreSQL tests are isolated tests, not deployed payroll proof. On the real release, configure TESTNET_APP_URL, TESTNET_EMPLOYER_ADDRESS, TESTNET_EMPLOYEE_ADDRESS and the asset-specific worker IDs and deployment blocks from observed records, then run npm run test:testnet in bridge.

Verify both assets: funded shift, increasing earnings, employee receipt, employer ledger update, withholding, exhausted-funding pause and top-up without retroactive accrual. Keep transaction and balance evidence. Missing setup is a failed release gate.

Envio activation requires the owner's API token stored privately in bridge/server configuration. Only enable the Envio event source after configuration; provider failures must stay visible. No trading plugin or liquidity integration is claimed.
