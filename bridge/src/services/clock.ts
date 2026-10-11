import { Prisma, type ClockType } from '@prisma/client';
import { deriveShiftId, toJsonMessage } from '../attestor.js';
import { shardOf } from '../chain.js';
import { HttpError, type Ctx } from '../context.js';
import { requireServed } from '../employers.js';

export type ClockEventInput = {
  idempotencyKey: string;
  workerId: bigint;
  type: ClockType;
  /** Unix seconds; defaults to now and is clamped to now so the bridge never attests the future. */
  at?: bigint;
};

export type ClockResult = { duplicate: boolean; shiftId: string | null; txId?: string };

const SUSPENDED = 2;

export async function handleClockEvent(ctx: Ctx, ev: ClockEventInput): Promise<ClockResult> {
  const { prisma, cfg, chain, attestor } = ctx;
  const seen = await prisma.clockEvent.findUnique({ where: { idempotencyKey: ev.idempotencyKey } });
  if (seen) return { duplicate: true, shiftId: seen.shiftId };

  const worker = await chain.readWorker(ev.workerId);
  if (worker.flags === 0) throw new HttpError(404, 'worker is not registered on the vault', 'unknown_worker');
  await requireServed(ctx, worker.employerId);
  if (worker.flags & SUSPENDED) throw new HttpError(409, 'worker is suspended', 'suspended');

  const now = ctx.now();
  const at = ev.at === undefined || ev.at > now ? now : ev.at;
  const workerId = ev.workerId.toString();

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Serialise events per worker so two clock-ins can't both open a shift.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'worker:' + workerId}))`;
      const dup = await tx.clockEvent.findUnique({ where: { idempotencyKey: ev.idempotencyKey } });
      if (dup) return { duplicate: true, shiftId: dup.shiftId };

      const open = await tx.shift.findFirst({ where: { workerId, status: 'OPEN' } });
      const deadline = now + cfg.attestationTtl;

      if (ev.type === 'CLOCK_IN') {
        if (open) throw new HttpError(409, `worker already on shift ${open.id}`, 'already_on_shift');
        const shiftId = deriveShiftId(cfg.vault, worker.employerId, ev.workerId, ev.idempotencyKey);
        const message = { workerId: ev.workerId, shiftId, startAt: at, deadline };
        const signature = await attestor.signOpen(message);
        await tx.shift.create({ data: { id: shiftId.toString(), workerId, status: 'OPEN', startAt: at } });
        const att = await tx.attestation.create({
          data: {
            kind: 'OPEN',
            shiftId: shiftId.toString(),
            message: toJsonMessage(message),
            signature,
            signer: attestor.address,
            deadline,
          },
        });
        const chainTx = await tx.chainTx.create({
          data: { kind: 'OPEN_SHIFT', workerId, shard: shardOf(ev.workerId), attestationId: att.id },
        });
        await tx.clockEvent.create({
          data: { idempotencyKey: ev.idempotencyKey, workerId, type: ev.type, at, shiftId: shiftId.toString() },
        });
        return { duplicate: false, shiftId: shiftId.toString(), txId: chainTx.id };
      }

      if (!open) throw new HttpError(409, 'worker is not on shift', 'not_on_shift');
      if (at <= open.startAt) throw new HttpError(422, 'clock-out must be after clock-in', 'bad_window');
      const shiftId = BigInt(open.id);
      // The attestor fixes the final rate: the worker's current on-chain rate at clock-out.
      const message = {
        workerId: ev.workerId,
        startAt: open.startAt,
        endAt: at,
        ratePerHour: worker.ratePerHour,
        shiftId,
        deadline,
      };
      const signature = await attestor.signShift(message);
      const gross = (worker.ratePerHour * (at - open.startAt)) / 3600n;
      await tx.shift.update({
        where: { id: open.id },
        data: { status: 'CLOSED', endAt: at, ratePerHour: worker.ratePerHour.toString(), gross: gross.toString() },
      });
      const att = await tx.attestation.create({
        data: {
          kind: 'CLOSE',
          shiftId: open.id,
          message: toJsonMessage(message),
          signature,
          signer: attestor.address,
          deadline,
        },
      });
      const chainTx = await tx.chainTx.create({
        data: { kind: 'CLOSE_SHIFT', workerId, shard: shardOf(ev.workerId), attestationId: att.id },
      });
      await tx.clockEvent.create({
        data: { idempotencyKey: ev.idempotencyKey, workerId, type: ev.type, at, shiftId: open.id },
      });
      return { duplicate: false, shiftId: open.id, txId: chainTx.id };
    });
    if (!result.duplicate) ctx.kick();
    return result;
  } catch (err) {
    // A concurrent delivery of the same webhook won the unique key race.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const dup = await prisma.clockEvent.findUnique({ where: { idempotencyKey: ev.idempotencyKey } });
      if (dup) return { duplicate: true, shiftId: dup.shiftId };
    }
    throw err;
  }
}
