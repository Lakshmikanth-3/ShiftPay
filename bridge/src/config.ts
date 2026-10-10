import { z } from 'zod';
import { isAddress, isHex, type Address, type Hex } from 'viem';

const privateKey = z
  .string()
  .trim()
  .refine((v) => isHex(v) && v.length === 66, 'must be a 0x-prefixed 32-byte hex private key')
  .transform((v) => v as Hex);

const schema = z.object({
  DATABASE_URL: z.string().url(),
  MONAD_RPC_URL: z.string().url(),
  MONAD_CHAIN_ID: z.coerce.number().int().positive(),
  VAULT_ADDRESS: z.string().refine(isAddress, 'invalid address').transform((v) => v as Address),
  EMPLOYER_ID: z.coerce.bigint().positive(),
  VAULT_DEPLOY_BLOCK: z.coerce.bigint().nonnegative().optional(),
  PAYROLL_EVENT_SOURCE: z.enum(['rpc','envio']).default('rpc'),
  ENVIO_API_TOKEN: z.string().trim().min(1).optional(),
  ATTESTOR_PRIVATE_KEY: privateKey,
  RELAYER_PRIVATE_KEYS: z
    .string()
    .transform((v) => v.split(',').map((k) => k.trim()).filter(Boolean))
    .pipe(z.array(privateKey).min(1, 'at least one relayer key is required')),
  WEBHOOK_SECRET: z.string().min(32),
  ADMIN_API_TOKEN: z.string().min(32),
  PORT: z.coerce.number().int().default(8787),
  ATTESTATION_TTL_SECONDS: z.coerce.number().int().min(30).default(600),
  CONFIRMATIONS: z.coerce.number().int().min(1).default(1),
  MAX_TX_ATTEMPTS: z.coerce.number().int().min(1).default(8),
});

export type Config = {
  databaseUrl: string;
  rpcUrl: string;
  chainId: number;
  vault: Address;
  employerId: bigint;
  vaultDeployBlock?: bigint;
  eventSource?: 'rpc'|'envio';
  envioToken?: string;
  attestorKey: Hex;
  relayerKeys: Hex[];
  webhookSecret: string;
  adminToken: string;
  port: number;
  attestationTtl: bigint;
  confirmations: number;
  maxTxAttempts: number;
};

/** Validates the environment. Fails loudly instead of falling back to guessed values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid bridge configuration (see .env.example):\n${issues}`);
  }
  const e = parsed.data;
  if(e.PAYROLL_EVENT_SOURCE==='envio'&&(!e.ENVIO_API_TOKEN||e.MONAD_CHAIN_ID!==10143))
    throw new Error('Envio indexing requires ENVIO_API_TOKEN and Monad Testnet chain 10143.');
  return {
    databaseUrl: e.DATABASE_URL,
    rpcUrl: e.MONAD_RPC_URL,
    chainId: e.MONAD_CHAIN_ID,
    vault: e.VAULT_ADDRESS,
    employerId: e.EMPLOYER_ID,
    vaultDeployBlock: e.VAULT_DEPLOY_BLOCK,
    eventSource: e.PAYROLL_EVENT_SOURCE,
    envioToken: e.ENVIO_API_TOKEN,
    attestorKey: e.ATTESTOR_PRIVATE_KEY,
    relayerKeys: e.RELAYER_PRIVATE_KEYS,
    webhookSecret: e.WEBHOOK_SECRET,
    adminToken: e.ADMIN_API_TOKEN,
    port: e.PORT,
    attestationTtl: BigInt(e.ATTESTATION_TTL_SECONDS),
    confirmations: e.CONFIRMATIONS,
    maxTxAttempts: e.MAX_TX_ATTEMPTS,
  };
}
