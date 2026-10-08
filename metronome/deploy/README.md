# Persistent testnet backend

The frontend remains on Vercel. This package runs two real Monad bridges, isolated PostgreSQL databases, and Caddy HTTPS on a persistent Linux VM. It never deploys a token, mints tokens, starts Anvil or creates sample payroll.

Deployment requires an accessible VM, two DNS names pointing at its IP, both deployed vault addresses/employer IDs, attestor keys registered in those vaults, and funded relayer keys. Those values are required; absent configuration stops deployment.

1. Install Docker Engine and the Compose plugin on the VM. Allow inbound TCP 80/443; keep PostgreSQL and bridge ports private.
2. Copy this repository to the VM. In this directory, create `.env` containing `POSTGRES_PASSWORD` (a long random hexadecimal value), `AUSD_HOST` and `USDC_HOST` (actual DNS names).
3. Create `.env.ausd` and `.env.usdc`. For each, copy the key/settings names from `../bridge/.env.example`, set its actual `VAULT_ADDRESS` and `EMPLOYER_ID`, and configure attestor/relayer keys and independent webhook/admin secrets. The Compose file supplies the database URL, port and fixed Monad network settings. Protect these files with `chmod 600 .env .env.ausd .env.usdc`. Never upload them to source control.
4. Run `docker compose config --quiet`, then `docker compose build` and `docker compose up -d`. Database migrations run before the service starts; startup verifies the real vault and registered attestor. `/health` also checks PostgreSQL and the chain.
5. Verify both public HTTPS `/health` and `/config` endpoints. Set `BRIDGE_AUSD_URL` and `BRIDGE_USDC_URL` in Vercel to those actual HTTPS URLs and redeploy the app.
6. Run `npm run test:testnet` in `../bridge`. Complete employer/worker signatures and verify the funded shift and withdrawals before claiming release acceptance.

`restart: unless-stopped` restarts processes after failure or a VM reboot when Docker starts. It cannot guarantee cloud availability or prevent a free-tier VM being reclaimed. Docker health checks identify an unhealthy process but do not themselves restart it.

Persist the named volumes. Do not use `docker compose down -v`. Back up each database before upgrades with `pg_dump`; retain copies away from the VM. This package is not yet deployed, and its image must be built and checked before release.
