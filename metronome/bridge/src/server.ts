import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { metronomeVaultAbi } from './abi/metronomeVault.js';
import { buildApp } from './app.js';
import { makeAttestor } from './attestor.js';
import { makeChain } from './chain.js';
import { loadConfig } from './config.js';
import { wallClock, type Ctx } from './context.js';
import { Submitter } from './submitter.js';
import {erc20Abi} from 'viem';

const log = {
  info: (o: object, msg = '') => console.log(JSON.stringify({ level: 'info', msg, ...o })),
  warn: (o: object, msg = '') => console.warn(JSON.stringify({ level: 'warn', msg, ...o })),
  error: (o: object, msg = '') => console.error(JSON.stringify({ level: 'error', msg, ...o })),
};

async function main() {
  const cfg = loadConfig();
  if(cfg.chainId!==10143)throw new Error('The deployed payroll service requires Monad Testnet 10143');
  const chain = makeChain(cfg);
  const attestor = makeAttestor(cfg.attestorKey, cfg.chainId, cfg.vault);

  // Refuse to run against the wrong network or with an unregistered attestor.
  const chainId = await chain.publicClient.getChainId();
  if (chainId !== cfg.chainId) throw new Error(`RPC chain id ${chainId} does not match MONAD_CHAIN_ID ${cfg.chainId}`);
  const code = await chain.publicClient.getCode({ address: cfg.vault });
  if (!code || code === '0x') throw new Error(`No contract at VAULT_ADDRESS ${cfg.vault} on chain ${chainId}`);
  const token=await chain.publicClient.readContract({address:cfg.vault,abi:metronomeVaultAbi,functionName:'token'});
  const supported={AUSD:'0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC',USDC:'0x534b2f3A21130d7a60830c2Df862319e593943A3'};
  const asset=Object.entries(supported).find(([,address])=>address.toLowerCase()===token.toLowerCase())?.[0];
  if(!asset)throw new Error('Vault does not use issuer-published Monad testnet AUSD or USDC');
  if(process.env.SETTLEMENT_ASSET && process.env.SETTLEMENT_ASSET!==asset)throw new Error('Vault settlement asset does not match its configured bridge');
  const decimals=await chain.publicClient.readContract({address:token,abi:erc20Abi,functionName:'decimals'});
  if(decimals!==6)throw new Error('Settlement token precision mismatch');
  const employer = await chain.publicClient.readContract({
    address: cfg.vault,
    abi: metronomeVaultAbi,
    functionName: 'employers',
    args: [cfg.employerId],
  });
  if (employer[1] !== attestor.address) {
    throw new Error(`Attestor ${attestor.address} is not registered for employer ${cfg.employerId} (vault has ${employer[1]})`);
  }
  if(process.env.EXPECTED_EMPLOYER_ADMIN && employer[0].toLowerCase()!==process.env.EXPECTED_EMPLOYER_ADMIN.toLowerCase())throw new Error('Vault employer admin differs from the confirmed company wallet');

  const prisma = new PrismaClient();
  const ctx: Ctx = { cfg, prisma, chain, attestor, now: wallClock, kick: () => {}, log };
  const submitter = new Submitter(ctx);
  ctx.kick = submitter.kick;
  await submitter.start();

  const app = buildApp(ctx);
  await app.listen({ port: cfg.port, host: '0.0.0.0' });
  log.info({ port: cfg.port, chainId, vault: cfg.vault, relayers: chain.relayers.length }, 'bridge listening');

  const shutdown = async () => {
    await app.close();
    await submitter.stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error({ err: String(err) }, 'bridge failed to start');
  process.exit(1);
});
