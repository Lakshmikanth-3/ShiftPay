# ShiftPay registration and payroll workflow

## Confirmed accounts

- Previously funded external company address and still-approved testnet tax recipient: `0x4e3f8497F732326CFB8cC4d17Ad0688b74582776`
- Previously supplied external employee address: `0x306037A2FdE5e44C0bd2f017BfC4fDB3Cd0bAa1D`. New employee registration must use the actual account the employee can sign with in ShiftPay; the form no longer prefills this external address.
- Company signing account: `0x430ff06AB045911e5dC6B7a742ddC11f27F47487`, confirmed by the owner after creating the real Mera passkey on the business domain. Read-only checks after owner funding confirmed 3 MON and zero USDC. Registration can proceed; wage-token funding remains pending.
- Vercel account verified: `lakshmikanth.27csb@licet.ac.in`
- Live, publicly checked domains: `shiftpay-business.vercel.app`, `shiftpay-employee.vercel.app`. Public route/login checks are not proof of authenticated payroll settlement.

## Product flow

1. Company setup collects its name and requires an unlocked Mera payroll passkey. Vault deployment and employer registration are real transactions. The public deployment record preserves the company name until the backend is configured; saving the company profile requires the signed backend request. MetaMask integration and external-wallet connection controls have been removed at the owner's request. Privy email access creates an embedded account, including for users who previously linked external wallets; external accounts are filtered from the active payroll selector.
2. Funding displays actual USDC/AUSD balances. Copy the company receive address or use the issuer faucet to receive test tokens. Allocation cannot exceed the company token balance.
3. The employee creates/unlocks a passkey on the employee portal, or signs in by email to create a Privy embedded account, and gives that actual public address to the employer. Add employee collects name, role, department, payroll ID, payout address, hourly rate, withholding, allocation, and notes. Registration confirms first, allocation confirms next, and signed profile persistence completes the workflow. Failure at a later step does not undo earlier confirmed transactions; the UI reports partial failure.
4. The employer verifies the shift. Employee payroll refreshes every second. Signed profile, company and settlement records refresh every five seconds during the ten-minute account authorization.
5. The employee sees funded allocation, earned wages, withholding, company notes and claimable wages. The registered employee account signs a withdrawal. The employer relayer pays settlement gas. The contract sends only claimable wages to the registered payout address.

## Remaining live release requirements

- Deployed token-specific payroll vaults and confirmed employer IDs, including `VAULT_DEPLOY_BLOCK` from each real deployment receipt.
- Hosted Render services and database with migrations, attestor/relayer configuration and funded service accounts.
- Actual Render bridge URLs configured on both live Vercel products; current sites truthfully show payroll setup pending.
- Privy allowed origins for the new domains; owner email login and real Mera passkey ceremonies on the final hosts.
- Real testnet shift, funding and withdrawal acceptance tests.
- Measured real-network benchmark.
- Funded-only gross accrual and pause/resume behavior are implemented: 41 contract tests pass locally. Real deployed funding exhaustion and top-up acceptance remain pending.
