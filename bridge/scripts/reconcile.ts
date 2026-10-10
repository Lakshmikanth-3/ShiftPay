// Compare bridge records with vault state. Usage: npm run reconcile -- [fromBlock]
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { makeAttestor } from '../src/attestor.js';
import { makeChain } from '../src/chain.js';
import { loadConfig } from '../src/config.js';
import { wallClock } from '../src/context.js';
import { reconcile } from '../src/reconcile.js';

const cfg = loadConfig();
const prisma = new PrismaClient();
const log = { info: console.log, warn: console.warn, error: console.error };
const ctx = {
  cfg,
  prisma,
  chain: makeChain(cfg),
  attestor: makeAttestor(cfg.attestorKey, cfg.chainId, cfg.vault),
  now: wallClock,
  kick: () => {},
  log,
};
const report = await reconcile(ctx, BigInt(process.argv[2] ?? '0'));
console.log(JSON.stringify(report, null, 2));
await prisma.$disconnect();
process.exit(report.mismatches.length || report.unknownOnChain.length ? 1 : 0);
