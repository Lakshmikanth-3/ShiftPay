import { toJsonMessage } from '../attestor.js';
import { shardOf } from '../chain.js';
import { HttpError, type Ctx } from '../context.js';

/**
 * Sign and queue a correction for a shift already settled on-chain. The version is read from the
 * chain, and only one correction per shift may be in flight, so versions never race.
 */
export async function correctShift(ctx: Ctx, shiftId: string, correctGross: bigint) {
  const { prisma, cfg, chain, attestor } = ctx;
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) throw new HttpError(404, 'unknown shift', 'unknown_shift');
  if (shift.status !== 'CLOSED') throw new HttpError(409, 'shift is still open', 'shift_open');

  const closeConfirmed = await prisma.chainTx.findFirst({
    where: { kind: 'CLOSE_SHIFT', status: 'CONFIRMED', attestation: { shiftId } },
  });
  if (!closeConfirmed) throw new HttpError(409, 'shift is not settled on-chain yet', 'not_settled');

  const pending = await prisma.chainTx.findFirst({
    where: { kind: 'CORRECT_SHIFT', status: { in: ['QUEUED', 'SUBMITTED'] }, attestation: { shiftId } },
  });
  if (pending) throw new HttpError(409, 'a correction for this shift is already pending', 'correction_pending');

  const onChain = await chain.readShift(BigInt(shiftId));
  const version = onChain.version + 1;
  const deadline = ctx.now() + cfg.attestationTtl;
  const message = { shiftId: BigInt(shiftId), correctGross, version, deadline };
  const signature = await attestor.signCorrection(message);

  const result = await prisma.$transaction(async (tx) => {
    await tx.shift.update({ where: { id: shiftId }, data: { version, gross: correctGross.toString() } });
    const att = await tx.attestation.create({
      data: {
        kind: 'CORRECTION',
        shiftId,
        version,
        message: toJsonMessage(message),
        signature,
        signer: attestor.address,
        deadline,
      },
    });
    return tx.chainTx.create({
      data: {
        kind: 'CORRECT_SHIFT',
        workerId: shift.workerId,
        shard: shardOf(BigInt(shift.workerId)),
        attestationId: att.id,
      },
    });
  });
  ctx.kick();
  return { shiftId, version, txId: result.id };
}
