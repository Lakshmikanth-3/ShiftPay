import { HttpError, type Ctx } from '../context.js';

/**
 * Sponsored-withdrawal policy. The employer's relayer pays gas, so tiny or very frequent withdrawals would make
 * payroll costly. Workers are never locked out: withdrawing the whole balance is always allowed, and past the weekly
 * allowance they withdraw directly with `withdraw()` from their own wallet (gas covered by the daily worker grant).
 * Token precision is fixed at 6 decimals (checked at startup in runtime.ts).
 */
const UNIT = 1_000_000;
export const MIN_SPONSORED_WITHDRAWAL = BigInt(Math.round(Number(process.env.MIN_SPONSORED_WITHDRAWAL || '1') * UNIT));
export const FREE_WITHDRAWALS_PER_WEEK = Number(process.env.FREE_WITHDRAWALS_PER_WEEK || '5');
const WEEK_MS = 7 * 24 * 3600 * 1000;

export function withdrawalPolicy() {
  return { minSponsoredAmount: MIN_SPONSORED_WITHDRAWAL.toString(), freePerWeek: FREE_WITHDRAWALS_PER_WEEK };
}

export async function sponsoredWithdrawalsUsed(ctx: Ctx, workerId: bigint): Promise<number> {
  return ctx.prisma.chainTx.count({
    where: { kind: 'WITHDRAW', workerId: workerId.toString(), status: { not: 'FAILED' }, createdAt: { gte: new Date(Date.now() - WEEK_MS) } },
  });
}

export async function assertWithdrawalPolicy(ctx: Ctx, workerId: bigint, amount: bigint, claimable: bigint): Promise<void> {
  if (amount < MIN_SPONSORED_WITHDRAWAL && amount !== claimable) {
    throw new HttpError(422, `Minimum sponsored withdrawal is ${Number(MIN_SPONSORED_WITHDRAWAL) / UNIT}, or withdraw your whole balance`, 'below_minimum');
  }
  if ((await sponsoredWithdrawalsUsed(ctx, workerId)) >= FREE_WITHDRAWALS_PER_WEEK) {
    throw new HttpError(429, `All ${FREE_WITHDRAWALS_PER_WEEK} free withdrawals this week are used; withdraw directly from your wallet`, 'free_withdrawals_used');
  }
}
