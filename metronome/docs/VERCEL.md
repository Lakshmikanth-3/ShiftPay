# Approved Vercel deployment

Account: lakshmikanth.27csb@licet.ac.in

| Product | Project | Public URL | Product environment |
|---|---|---|---|
| Business | shiftpay-business | https://shiftpay-business.vercel.app | METRONOME_PRODUCT=employer |
| Employee | shiftpay-employee | https://shiftpay-employee.vercel.app | METRONOME_PRODUCT=employee |

Both sites are deployed and passed 22 combined public browser checks. The former shiftpay-monad-payroll, employee-dashboard and business-dashboard projects were removed after replacement checks passed. These checks verify navigation, responsive layouts and login entry, not authenticated payroll settlement.

Root directory: metronome/app. Framework: Next.js. Node: 24.x. Install: npx --yes npm@11.13.0 ci. Build: npm run build.

The app root is self-contained. bridge npm run abi synchronizes the compiled contract ABI and deployment bytecode. prepare-public.cjs generates vault-abi.mjs from committed vault-abi.json. It runs before development, builds and unit tests, so a clean checkout does not require a generated module in Git.

Configure server-only BRIDGE_AUSD_URL and BRIDGE_USDC_URL on both projects with actual healthy Render HTTPS endpoints. Do not use localhost on Vercel. Private service keys, database credentials and webhook secrets belong only in the backend's secret settings, never NEXT_PUBLIC variables.

The frontend uses issuer-published USDC/AUSD on Monad testnet 10143. Each bridge must match its asset, deployed vault and PostgreSQL schema. Missing configuration remains visibly pending. The frontend deployment does not create the durable backend or database.

Allow both exact final origins in Privy and enable email embedded accounts. Company registration requires its Mera passkey; external MetaMask connection is removed. Passkey credentials are hostname-bound, so create company and employee credentials on their respective stable hosts.

Before another deployment, verify the account and exact project identity. Deploy only the existing approved project; do not create or publish to alternate names. CLI immutable deployment URLs are build records, while the approved aliases above are the user-facing portals.
