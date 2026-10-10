import { parseAbiItem } from 'viem';
import type { Ctx } from './context.js';

export type ReconcileReport = {
  checkedShifts: number;
  mismatches: { shiftId: string; problem: string }[];
  unknownOnChain: { shiftId: string; workerId: string; txHash: string }[];
  txs: Record<string, number>;
  failed: { id: string; kind: string; lastError: string | null }[];
};

const shiftClosed = parseAbiItem(
  'event ShiftClosed(uint256 indexed workerId, uint256 indexed shiftId, uint64 startAt, uint64 endAt, uint256 gross, uint256 tax)',
);

/**
 * Compares the bridge's records with vault state in both directions:
 * every shift the bridge settled must match the chain, and every shift the chain settled for this
 * employer's workers must be known to the bridge — an unknown one means the attestor key signed
 * something outside this bridge.
 */
export async function reconcile(ctx: Ctx, fromBlock = 0n): Promise<ReconcileReport> {
  const { prisma, chain, cfg } = ctx;
  const mismatches: ReconcileReport['mismatches'] = [];

  const settled = await prisma.shift.findMany({
    where: { attestations: { some: { txs: { some: { status: 'CONFIRMED', kind: { in: ['CLOSE_SHIFT', 'OPEN_SHIFT'] } } } } } },
    include: { attestations: { include: { txs: true } } },
  });

  for (const shift of settled) {
    const closeConfirmed = shift.attestations.some((a) =>
      a.txs.some((t) => t.kind === 'CLOSE_SHIFT' && t.status === 'CONFIRMED'),
    );
    const onChain = await chain.readShift(BigInt(shift.id));
    if (closeConfirmed) {
      if (onChain.workerId !== BigInt(shift.workerId)) {
        mismatches.push({ shiftId: shift.id, problem: 'confirmed close but shift not settled on-chain' });
        continue;
      }
      // Expected gross comes from the latest confirmed record: the close, or the highest confirmed correction.
      const confirmed = shift.attestations.filter((a) => a.txs.some((t) => t.status === 'CONFIRMED'));
      const corrections = confirmed.filter((a) => a.kind === 'CORRECTION').sort((a, b) => b.version - a.version);
      const close = confirmed.find((a) => a.kind === 'CLOSE')!;
      const cm = close.message as Record<string, string>;
      const gross = corrections.length
        ? BigInt((corrections[0].message as Record<string, string>).correctGross)
        : (BigInt(cm.ratePerHour) * (BigInt(cm.endAt) - BigInt(cm.startAt))) / 3600n;
      const expectedNet = gross - (gross * BigInt(onChain.bps)) / 10_000n;
      if (onChain.net !== expectedNet) {
        mismatches.push({ shiftId: shift.id, problem: `net on-chain ${onChain.net} != expected ${expectedNet}` });
      }
      const confirmedVersion = corrections.length ? corrections[0].version : 0;
      if (onChain.version !== confirmedVersion) {
        mismatches.push({ shiftId: shift.id, problem: `version on-chain ${onChain.version} != bridge ${confirmedVersion}` });
      }
    } else if (shift.status === 'OPEN') {
      const w = await chain.readWorker(BigInt(shift.workerId));
      if (w.openShiftId !== BigInt(shift.id) && onChain.workerId === 0n) {
        mismatches.push({ shiftId: shift.id, problem: 'confirmed open but worker has no matching open shift' });
      }
    }
  }

  const logs = await chain.publicClient.getLogs({ address: chain.vault, event: shiftClosed, fromBlock, toBlock: 'latest' });
  const known = new Set((await prisma.shift.findMany({ select: { id: true } })).map((s) => s.id));
  const employerOf = new Map<bigint, bigint>();
  const unknownOnChain: ReconcileReport['unknownOnChain'] = [];
  for (const log of logs) {
    const workerId = log.args.workerId!;
    if (!employerOf.has(workerId)) employerOf.set(workerId, (await chain.readWorker(workerId)).employerId);
    if (employerOf.get(workerId) !== cfg.employerId) continue;
    const shiftId = log.args.shiftId!.toString();
    if (!known.has(shiftId)) unknownOnChain.push({ shiftId, workerId: workerId.toString(), txHash: log.transactionHash });
  }

  const grouped = await prisma.chainTx.groupBy({ by: ['status'], _count: true });
  const failed = await prisma.chainTx.findMany({
    where: { status: 'FAILED' },
    select: { id: true, kind: true, lastError: true },
    take: 50,
  });

  return {
    checkedShifts: settled.length,
    mismatches,
    unknownOnChain,
    txs: Object.fromEntries(grouped.map((g) => [g.status, g._count])),
    failed,
  };
}
