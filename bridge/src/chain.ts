import {
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  http,
  type Address,
  type PublicClient,
  type WalletClient,
  type Account,
  type Chain as ViemChain,
  type Transport,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { metronomeVaultAbi } from './abi/metronomeVault.js';
import type { Config } from './config.js';

export const SHARDS = 64n;

export type Relayer = WalletClient<Transport, ViemChain, Account>;

export type WorkerState = {
  ratePerHour: bigint;
  funded: bigint;
  withdrawn: bigint;
  netSettled: bigint;
  taxSettled: bigint;
  taxEscrowed: bigint;
  clockInAt: bigint;
  nonce: bigint;
  employerId: bigint;
  maxShiftSeconds: number;
  withholdingBps: number;
  flags: number;
  payoutAddr: Address;
  openShiftId: bigint;
};

export type Chain = {
  chain: ViemChain;
  publicClient: PublicClient<Transport, ViemChain>;
  relayers: Relayer[];
  vault: Address;
  relayerForShard(shard: number): Relayer;
  readWorker(workerId: bigint): Promise<WorkerState>;
  readShift(shiftId: bigint): Promise<{ workerId: bigint; net: bigint; tax: bigint; version: number; bps: number }>;
};

export function makeChain(cfg: Pick<Config, 'rpcUrl' | 'chainId' | 'vault' | 'relayerKeys'>): Chain {
  const chain = defineChain({
    id: cfg.chainId,
    name: `monad-${cfg.chainId}`,
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
  // The public Monad RPC allows 25 requests/second; fall back to other public providers before failing a request.
  const extra = cfg.chainId === 10143 ? ['https://rpc-testnet.monadinfra.com', 'https://rpc.ankr.com/monad_testnet', 'https://monad-testnet.drpc.org'] : [];
  const urls = [cfg.rpcUrl, ...(process.env.MONAD_RPC_FALLBACKS?.split(',').map((u) => u.trim()).filter(Boolean) ?? extra)];
  const transport = urls.length > 1 ? fallback(urls.map((u) => http(u, { retryCount: 1, timeout: 10_000 })), { retryCount: 2 }) : http(cfg.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const relayers = cfg.relayerKeys.map((key) =>
    createWalletClient({ account: privateKeyToAccount(key), chain, transport }),
  );

  return {
    chain,
    publicClient,
    relayers,
    vault: cfg.vault,
    relayerForShard: (shard) => relayers[shard % relayers.length],
    async readWorker(workerId) {
      const w = await publicClient.readContract({
        address: cfg.vault,
        abi: metronomeVaultAbi,
        functionName: 'workers',
        args: [workerId],
      });
      return {
        ratePerHour: w[0],
        funded: w[1],
        withdrawn: w[2],
        netSettled: w[3],
        taxSettled: w[4],
        taxEscrowed: w[5],
        clockInAt: w[6],
        nonce: w[7],
        employerId: w[8],
        maxShiftSeconds: w[9],
        withholdingBps: w[10],
        flags: w[11],
        payoutAddr: w[12],
        openShiftId: w[13],
      };
    },
    async readShift(shiftId) {
      const s = await publicClient.readContract({
        address: cfg.vault,
        abi: metronomeVaultAbi,
        functionName: 'shifts',
        args: [shiftId],
      });
      return { workerId: s[0], net: s[1], tax: s[2], version: s[3], bps: s[4] };
    },
  };
}

export const shardOf = (workerId: bigint) => Number(workerId % SHARDS);
