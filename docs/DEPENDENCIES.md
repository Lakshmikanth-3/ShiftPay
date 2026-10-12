# Dependency disclosures

**App** (`app/`): Next.js, React, viem, `@category-labs/mera` (Mera passkey SDK), `@scure/bip32`, `@scure/bip39`, qrcode,
sharp, esbuild, Prisma client and Fastify (the bundled payroll service). `@privy-io/react-auth` remains in the lockfile but
is no longer imported or shipped; Mera is the only account layer.

**Payroll service** (`bridge/`): Fastify, Prisma with Postgres, viem, Zod, dotenv and tsx; TypeScript and Vitest for
verification.

**Contracts** (`contracts/`): Solidity, OpenZeppelin Contracts and forge-std / Foundry. `MockERC20` and the standard
public Anvil development mnemonic are used only in local tests; `NaiveVault` is a benchmark control, not a product contract.

**External services**: Agora (AUSD token, testnet faucet, Instant Settlement pair and whitelister, public metrics API),
Envio HyperSync (payroll event indexing), Alchemy and public Monad RPCs, Vercel hosting and Neon Postgres.

Exact versions are recorded in each package lockfile; compiler settings are in `contracts/foundry.toml`.
Each dependency is used under its own published licence. ShiftPay is MIT-licensed.

**AI tools**: Claude Code (Anthropic) assisted with code, tests, documentation and deployment; disclosed in the README.
