import type { PrismaClient } from '@prisma/client';
import type { Attestor } from './attestor.js';
import type { Chain } from './chain.js';
import type { Config } from './config.js';

export type Ctx = {
  cfg: Config;
  prisma: PrismaClient;
  chain: Chain;
  attestor: Attestor;
  /** Current unix time in seconds. Injectable so tests can follow chain time. */
  now: () => bigint;
  /** Wakes the submitter after new work is queued. */
  kick: () => void;
  /** Sends native MON from the shard's relayer (gas sponsorship). Set once the submitter exists. */
  transfer?: (shard: number, to: `0x${string}`, value: bigint) => Promise<`0x${string}`>;
  log: { info: (o: object, msg?: string) => void; warn: (o: object, msg?: string) => void; error: (o: object, msg?: string) => void };
};

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const wallClock = () => BigInt(Math.floor(Date.now() / 1000));
