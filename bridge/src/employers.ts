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

/** Worker ids created for a company, from the indexed vault events. */
export async function employerWorkerIds(ctx: Ctx, employerId: bigint): Promise<string[]> {
  const rows = await ctx.prisma.vaultEvent.findMany({ where: { eventName: 'WorkerCreated', employerId: employerId.toString() }, select: { workerId: true } });
  return rows.map((r) => r.workerId!).filter(Boolean);
}

/**
 * Sponsored work is unlimited for the service's home company. Self-serve companies share the relayer, so each is
 * capped per day to stop a free company from draining the relayer's gas with many workers or shifts.
 */
export const SELF_SERVE_TX_PER_DAY = Number(process.env.SELF_SERVE_TX_PER_DAY || '60');
export async function assertSponsoredBudget(ctx: Ctx, employerId: bigint): Promise<void> {
  if (employerId === ctx.cfg.employerId) return;
  const ids = await employerWorkerIds(ctx, employerId);
  const used = await ctx.prisma.chainTx.count({ where: { workerId: { in: ids }, createdAt: { gt: new Date(Date.now() - 24 * 3600_000) } } });
  if (used >= SELF_SERVE_TX_PER_DAY) throw new HttpError(429, 'This company has used its sponsored transactions for today.', 'sponsor_budget');
}
