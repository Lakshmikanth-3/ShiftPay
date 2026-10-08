# Dependency disclosures

App: Next.js, React/React DOM, Privy React SDK, viem and esbuild. Privy email login and wallet onboarding require configured allowed origins. Browser public settings contain no backend secrets.

Bridge: Fastify, Prisma/Postgres, viem, Zod, dotenv and tsx; TypeScript and Vitest for verification. The server assumes one bridge process per database and employer configuration; deploy multiple workers only after adding distributed coordination.

Contracts: Solidity 0.8.28, OpenZeppelin Contracts 5.1.0 and forge-std/Foundry. Reproducible npm versions are recorded in each package lockfile; compiler settings are in `contracts/foundry.toml`.

Sample preview typography uses externally hosted fonts; connected payroll uses the system font stack. MockERC20 and the standard public Anvil development mnemonic are used only for local testing. Benchmark control is an evaluation artifact, not a production payroll deployment.

Review each dependency's packaged licence and hackathon disclosure rules before submission. Do not present local timing results as measured Monad parallel execution.
