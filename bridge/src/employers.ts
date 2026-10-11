import type { Address } from 'viem';
import { metronomeVaultAbi } from './abi/metronomeVault.js';
import { HttpError, type Ctx } from './context.js';

export type ServedEmployer = { id: bigint; admin: Address; attestor: Address; taxAddress: Address };
const cache = new Map<string, { at: number; value: ServedEmployer | null }>();

/**
 * Any company in the shared vault that registered this service's attestor is served by it. Companies are
 * created permissionlessly (`createEmployer`), so judges and new businesses can onboard with their own passkey.
 */
export async function servedEmployer(ctx: Ctx, id: bigint): Promise<ServedEmployer | null> {
  const key = id.toString(), hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15_000) return hit.value;
  const e = await ctx.chain.publicClient.readContract({ address: ctx.chain.vault, abi: metronomeVaultAbi, functionName: 'employers', args: [id] });
  const value = e[1].toLowerCase() === ctx.attestor.address.toLowerCase() ? { id, admin: e[0], attestor: e[1], taxAddress: e[2] } : null;
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function requireServed(ctx: Ctx, id: bigint): Promise<ServedEmployer> {
  const employer = await servedEmployer(ctx, id);
  if (!employer) throw new HttpError(403, 'This company does not use this payroll service', 'wrong_employer');
  return employer;
}
