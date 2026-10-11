import { verifyTypedData, type Hex } from 'viem';
import { metronomeVaultAbi } from '../abi/metronomeVault.js';
import { types } from '../attestor.js';
import { shardOf } from '../chain.js';
import { HttpError, type Ctx } from '../context.js';
import { requireServed } from '../employers.js';

/** Typed data the worker's wallet signs to authorise a relayed withdrawal. */
export async function withdrawTypedData(ctx: Ctx, workerId: bigint, amount: bigint) {
  const worker = await ctx.chain.readWorker(workerId);
  if (worker.flags === 0) throw new HttpError(404, 'unknown worker', 'unknown_worker');
  await requireServed(ctx, worker.employerId);
  return {
    domain: ctx.attestor.domain,
    types: { Withdraw: types.Withdraw },
    primaryType: 'Withdraw' as const,
    message: { workerId, amount, nonce: worker.nonce, deadline: ctx.now() + ctx.cfg.attestationTtl },
  };
}

export type WithdrawalInput = { workerId: bigint; amount: bigint; deadline: bigint; signature: Hex };

/**
 * Check a worker-signed withdrawal against the payout wallet, current nonce and claimable balance,
 * then queue it for a relayer. The relayer pays gas; the vault pays only the worker's payout address.
 */
export async function relayWithdrawal(ctx: Ctx, input: WithdrawalInput) {
  const { chain, prisma } = ctx;
  const worker = await chain.readWorker(input.workerId);
  if (worker.flags === 0) throw new HttpError(404, 'unknown worker', 'unknown_worker');
  await requireServed(ctx, worker.employerId);
  if (worker.flags !== 1) throw new HttpError(409, 'worker is suspended', 'suspended');
  if (input.amount <= 0n) throw new HttpError(422, 'amount must be positive', 'bad_amount');
  if (input.deadline <= ctx.now()) throw new HttpError(422, 'signature deadline has passed', 'expired');

  const valid = await verifyTypedData({
    address: worker.payoutAddr,
    domain: ctx.attestor.domain,
    types: { Withdraw: types.Withdraw },
    primaryType: 'Withdraw',
    message: { workerId: input.workerId, amount: input.amount, nonce: worker.nonce, deadline: input.deadline },
    signature: input.signature,
  });
  if (!valid) {
    throw new HttpError(401, "signature does not match the worker's payout wallet and current nonce", 'bad_signature');
  }

  const pending = await prisma.chainTx.findFirst({
    where: { kind: 'WITHDRAW', workerId: input.workerId.toString(), status: { in: ['QUEUED', 'SUBMITTED'] } },
  });
  if (pending) throw new HttpError(409, 'a withdrawal is already pending for this worker', 'withdrawal_pending');

  const claimable = await chain.publicClient.readContract({
    address: chain.vault,
    abi: metronomeVaultAbi,
    functionName: 'claimable',
    args: [input.workerId],
  });
  if (input.amount > claimable) {
    throw new HttpError(422, `amount exceeds claimable (${claimable})`, 'exceeds_claimable');
  }

  const tx = await prisma.chainTx.create({
    data: {
      kind: 'WITHDRAW',
      workerId: input.workerId.toString(),
      shard: shardOf(input.workerId),
      params: {
        workerId: input.workerId.toString(),
        amount: input.amount.toString(),
        deadline: input.deadline.toString(),
        nonce: worker.nonce.toString(),
        signature: input.signature,
      },
    },
  });
  ctx.kick();
  return { txId: tx.id };
}
