# Render migration

`render.yaml` at the repository root defines two token-specific real Monad bridge services and one PostgreSQL database with separate `ausd`/`usdc` schemas. The live Next.js frontend remains on Vercel. Render only allows one free database per workspace. No guessed deployment URLs are recorded.

## Requirements

- A GitHub/GitLab/Bitbucket repository containing these files, connected to your Render account.
- Actual Monad vault addresses and employer IDs for both tokens.
- Registered attestor and funded relayer keys entered privately into Render's secret environment settings.
- Your company and employee public wallet addresses and the chosen withholding recipient.
- Test AUSD and USDC for payroll funding, and MON for transaction gas.

Create a Blueprint from the repository in Render and select this `render.yaml`. Missing contract/key fields are requested at setup. Do not insert example addresses or public development keys. Services will not start successfully until the actual contracts and keys match. Each backend applies checked-in Prisma migrations before startup. Validate both `/health` endpoints and the app's asset-specific `/api/bridge/config` endpoints.

After successful deployment, set `BRIDGE_AUSD_URL` and `BRIDGE_USDC_URL` on both approved Vercel projects to the observed Render HTTPS URLs and redeploy them. Allow `https://shiftpay-business.vercel.app` and `https://shiftpay-employee.vercel.app` in Privy. Set `TESTNET_APP_URL` to the actual business portal and `TESTNET_EMPLOYER_ADDRESS` to its registered Mera administrator for live acceptance. The frontend remains on Vercel; Render hosts only the payroll backend and database.

## Free-tier constraints

[Render's free-tier documentation](https://render.com/docs/free) specifies idle sleep after 15 minutes, approximately one minute to wake, 750 free instance hours shared per workspace per month, one free PostgreSQL database, and database expiry after 30 days. Both running bridges share those hours. Deleting projects does not reset usage allowances. Free service sleep also pauses the backend transaction processor; queued transactions persist in Postgres and resume when the backend starts again.

This is a real testnet implementation suitable for a temporary demo, subject to these constraints. It cannot satisfy continuous 24/7 availability on Render's free plan. No artificial keepalive traffic is included. A paid plan or suitable persistent VM is required for continuous processing. This file records deployment preparation, not an observed successful Render deployment.
