import { PrismaClient } from '@prisma/client';
import { erc20Abi } from 'viem';
import { metronomeVaultAbi } from './abi/metronomeVault.js';
import { buildApp } from './app.js';
import { makeAttestor } from './attestor.js';
import { makeChain } from './chain.js';
import { loadConfig } from './config.js';
import { wallClock, type Ctx } from './context.js';
import { assertHostedConfig } from './hosted-config.js';
import { Submitter } from './submitter.js';

export const log = {
  info: (o: object, msg = '') => console.log(JSON.stringify({ level: 'info', msg, ...o })),
  warn: (o: object, msg = '') => console.warn(JSON.stringify({ level: 'warn', msg, ...o })),
  error: (o: object, msg = '') => console.error(JSON.stringify({ level: 'error', msg, ...o })),
};

export const supportedTokens = {
  AUSD: '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC',
  USDC: '0x534b2f3A21130d7a60830c2Df862319e593943A3',
} as const;

/**
 * Validates the deployed vault against the hosted configuration and builds the payroll service.
 * Shared by the long-running server and the Vercel function so both refuse the same misconfiguration.
 */
export async function createRuntime(env: NodeJS.ProcessEnv = process.env) {
  const cfg = loadConfig(env);
  assertHostedConfig(cfg, env);
  const chain = makeChain(cfg);
  const attestor = makeAttestor(cfg.attestorKey, cfg.chainId, cfg.vault);

  // Refuse to run against the wrong network or with an unregistered attestor.
  const chainId = await chain.publicClient.getChainId();
  if (chainId !== cfg.chainId) throw new Error(`RPC chain id ${chainId} does not match MONAD_CHAIN_ID ${cfg.chainId}`);
  const code = await chain.publicClient.getCode({ address: cfg.vault });
  if (!code || code === '0x') throw new Error(`No contract at VAULT_ADDRESS ${cfg.vault} on chain ${chainId}`);
  const token = await chain.publicClient.readContract({ address: cfg.vault, abi: metronomeVaultAbi, functionName: 'token' });
  const asset = Object.entries(supportedTokens).find(([, address]) => address.toLowerCase() === token.toLowerCase())?.[0];
  if (!asset) throw new Error('Vault does not use issuer-published Monad testnet AUSD or USDC');
  if (env.SETTLEMENT_ASSET && env.SETTLEMENT_ASSET !== asset) throw new Error('Vault settlement asset does not match its configured bridge');
  const decimals = await chain.publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' });
  if (decimals !== 6) throw new Error('Settlement token precision mismatch');
  const employer = await chain.publicClient.readContract({
    address: cfg.vault,
    abi: metronomeVaultAbi,
    functionName: 'employers',
    args: [cfg.employerId],
  });
  if (employer[1] !== attestor.address) {
    throw new Error(`Attestor ${attestor.address} is not registered for employer ${cfg.employerId} (vault has ${employer[1]})`);
  }
  if (env.EXPECTED_EMPLOYER_ADMIN && employer[0].toLowerCase() !== env.EXPECTED_EMPLOYER_ADMIN.toLowerCase())
    throw new Error('Vault employer admin differs from the confirmed company wallet');

  const prisma = new PrismaClient({ datasourceUrl: cfg.databaseUrl });
  const ctx: Ctx = { cfg, prisma, chain, attestor, now: wallClock, kick: () => {}, log };
  const submitter = new Submitter(ctx);
  ctx.kick = submitter.kick;
  const app = buildApp(ctx);
  return { cfg, ctx, chainId, prisma, submitter, app, asset };
}
