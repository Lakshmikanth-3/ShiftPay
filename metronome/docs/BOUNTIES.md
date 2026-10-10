# Sponsor bounty verification

The official portal at https://hackathon.monad.xyz currently displays sign-in for its bounty rules. Public sponsor listings confirm Agora and Privy participation but do not establish the exact eligibility requirements.

Browser access failed with a Windows sandbox initialization error. No authenticated bounty cards have been inspected. The owner supplied bounty descriptions, including Agora's AUSD cross-border mobile payments with Mera onboarding, Privy beyond basic authentication, and Envio powering a core feature. These descriptions guide the plan; exact eligibility and prizes still require checking the sponsor cards. Do not describe planned integrations as completed or bounty-qualified.

## ShiftPay priorities

| Sponsor | Useful payroll integration | Current evidence / remaining work |
| --- | --- | --- |
| Agora + Mera | Mobile app sending AUSD across borders with Mera passkey onboarding and Instant Settlement | Employee mobile wallet (installable PWA) at https://shiftpay-employee.vercel.app: Mera passkey account, Agora faucet `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`, AUSD send/receive, and Instant Settlement through the published CTK/AUSD pair `0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae` after self-whitelisting via `0x7c10F56d6f04a51376393a1C3670e966863F6BD5`. Recorded transaction evidence and the AUSD payroll vault remain pending. Testnet supports AUSD → CTK only. |
| Privy | Employee account access, embedded signing, employer-paid withdrawal relay | Existing authentication and relay implementation; complete live proof with the registered payout signer remains pending. |
| Envio | Index employee registration, allocation, withdrawals and withholding to drive both dashboards | HyperSync event source implemented in the backend; activation and real-service validation require a server-side token and deployed payroll vault. Existing RPC indexing remains explicitly selected until configured. |
| Aurora Intents | Company funds Monad payroll using assets from another chain | Pending verification of supported networks, assets and actual settlement; no integration yet. |
| Monad community | Community team eligibility | Requires the team's actual qualifying community relationship. |

Kuru, Perpl and the Agora trading bounty require trading features beyond ShiftPay's payroll purpose. Connecting MetaMask does not satisfy the MetaMask Agent Wallet trading-plugin bounty. Using AUSD does not establish Cleanverse CVI/CVA compliance integration. Dynamic would duplicate the existing authentication provider unless a concrete requirement justifies changing it.

## Optimized company registration

The owner subsequently removed MetaMask integration. Company registration now requires the actual Mera passkey account. The previously supplied external company address remains the approved tax recipient, and its balances remain external; no funds or account ownership were migrated automatically. Employee registration requires the actual Mera or Privy embedded payout account and no longer prefills an external address.

1. Enter company name and payroll currency.
2. Create or unlock the company payroll passkey, then choose **Register company**. Signing uses the real Mera session.
3. Submit actual vault deployment and company registration sequentially. Resume pending transactions from their real receipts instead of repeating them.
4. Add employee details, payout address, payroll allocation and notes. Skip token approval when sufficient allowance already exists; combine approval and funding only for a wallet reporting ready atomic support.
5. Show confirmed allocation and earned wages in the employee dashboard through the signed payroll service.

Registration uses the unlocked passkey signer; no browser extension or external-wallet account permission prompt is requested.

For future new-company onboarding, Mera can create a passkey-derived payroll account and unlock a signing session. This account is different from the owner's funded MetaMask account; it cannot automatically sign for that address. Do not change company ownership, import private keys, transfer funds or enable account delegation implicitly. A passkey account also needs an explicit funding source, gas strategy, supported authenticator, recovery flow and deployed payroll service before claiming seamless live registration.

Official technical references:

- [Mera account derivation and signing sessions](https://github.com/category-labs/mera)
- [Envio September 2026 update](https://docs.envio.dev/blog/developer-update-september-2026)
- [Wallet call batching specification](https://eips.ethereum.org/EIPS/eip-5792)

## Envio activation

The bridge supports `PAYROLL_EVENT_SOURCE=envio` and `ENVIO_API_TOKEN` in its server environment. Obtain a **HyperSync** token using the free package in [Envio's dashboard](https://envio.dev/app/api-tokens). HyperRPC tokens can have different product access and billing; this implementation uses HyperSync's JSON query API and adds no SDK dependency.

Keep the token in `metronome/bridge/.env` locally and the backend's environment settings when hosted. Do not put it in browser variables, the frontend or source control. For the USDC and AUSD services, select Envio and configure the actual vault address and deployment block for each service separately. The token's rate budget is shared when using it across services.

The endpoint is the officially listed Monad Testnet service, `https://monad-testnet.hypersync.xyz/query`. Queries select the configured vault and confirmed block range. Pagination uses `next_block`; lag never counts as completed indexing. Invalid responses, wrong-vault events, conflicting/noncanonical block hashes, token errors and rate limits stop updates. There is no automatic provider substitution after selecting Envio. Contract balance reads and transaction submission continue through the Monad RPC because HyperSync is an event-data service.

## Current wallet onboarding

The owner's latest instruction removes MetaMask integration and its bounty from the payroll product. Company registration uses Mera. Both employee and employer dashboards support Mera account access and Privy email embedded accounts; previously linked external accounts are excluded from the active account list. A new Mera account is derived from real WebAuthn PRF output using the official BIP-39/BIP-32 recipe and Ethereum path `m/44'/60'/0'/0/0`. No arbitrary wallet address is generated or prefilled for Mera.

Public credential metadata is scoped to the current hostname. The app stores no PRF output, seed, recovery phrase or private key. Temporary derivation buffers are cleared, and the Mera signing session ends at sign-out or after 15 minutes. Restoring an existing credential checks that its derived address matches the saved public address. Unsupported authenticators fail visibly rather than selecting another wallet or weaker key mechanism.

The existing payroll controller uses the selected Mera local signer for actual contract deployment, company/employee registration, funding, dashboard access and withdrawal signatures. Account permissions still come from the deployed payroll contract. Passkey access alone does not grant company or employee authority. Existing wallet balances do not move automatically. Setup records are scoped to the actual selected account, chain and token.

Passkeys on localhost and the two separate `vercel.app` dashboard hosts are independent. Create the company's production passkey on the final business host; employees use their own account credentials on the employee host. The published Mera package requires Node 24; the frontend now specifies `24.x`, supported by Vercel. The backend runtime is unchanged.

No owner passkey account has been created, no owner funds transferred and no new deployment performed during implementation. SDK signature tests are distinct from a live owner WebAuthn ceremony and payroll settlement.

## MetaMask Agent Wallet bounty scope

Removed from the implementation plan at the owner's request. No Agent Wallet plugin or trading execution is implemented. The earlier treasury trading investigation question is superseded; do not pursue it without a new instruction.

Current integration evidence:

- Privy email/wallet authentication and embedded account creation are implemented. Worker signed withdrawals are relayed at employer expense. Owner login was reported earlier; a complete live testnet payroll flow remains unverified.
- Official AUSD and USDC testnet contracts are configured. Token-specific funded payroll and withholding rules are implemented; actual deployed payroll services and completed real token withdrawal receipts remain pending.
- Connected company accounts are reused. Company registration uses one application action, resuming confirmed setup transactions rather than repeating them.
- Token authorization is skipped when allowance is sufficient. Already-ready atomic wallets can submit approval and allocation together using EIP-5792. No EOA account upgrade/delegation or sequential resubmission of a failed batch occurs automatically. Batch success requires matching chain receipts and the vault's actual employee funding event.

Provider or SDK usage alone is not evidence that a sponsor bounty is satisfied.
