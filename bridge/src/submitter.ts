import { BaseError, ContractFunctionRevertedError, type Address, type Hash, type Hex } from 'viem';
import type { Attestation, ChainTx } from '@prisma/client';
import { metronomeVaultAbi } from './abi/metronomeVault.js';
import { toJsonMessage } from './attestor.js';
import type { Relayer } from './chain.js';
import type { Ctx } from './context.js';

type TxWithAttestation = ChainTx & { attestation: Attestation | null };
type Call = { functionName: string; args: readonly unknown[] };

/** Re-sign attestations this close to expiry before submitting them. */
const DEADLINE_MARGIN = 30n;

/**
 * Submits queued transactions. Each shard maps to one relayer key; each relayer sends in nonce
 * order without waiting for receipts, and relayers run in parallel. A worker has at most one
 * transaction in flight so its open, close, correction and withdrawal land in order.
 *
 * Assumes a single bridge process per database.
 */
export class Submitter {
  private inflight = new Set<string>();
  private busyWorkers = new Set<string>();
  private nonces = new Map<Address, number>();
  private sendLocks = new Map<Address, Promise<void>>();
  private draining = false;
  private again = false;
  private timer?: NodeJS.Timeout;
  private watchers = new Set<Promise<void>>();

  constructor(private ctx: Ctx) {}

  async start(intervalMs = 500) {
    await this.recover();
    this.timer = setInterval(() => this.kick(), intervalMs);
    this.kick();
  }

  async stop() {
    clearInterval(this.timer);
    await Promise.allSettled([...this.watchers]);
  }

  /**
   * Serverless hosting has no resident loop: after each request, submit due work and wait for
   * receipts until the queue is quiet or the time budget ends. Unfinished work resumes on the next request.
   */
  async settle(budgetMs: number) {
    const end = Date.now() + budgetMs;
    if (!this.recovered) {
      await this.recover();
      this.recovered = true;
    }
    while (Date.now() < end) {
      await this.drain();
      if (this.watchers.size === 0) {
        const due = await this.ctx.prisma.chainTx.count({ where: { status: 'QUEUED', nextAttemptAt: { lte: new Date() } } });
        if (due === 0) return;
        continue;
      }
      await Promise.race([Promise.allSettled([...this.watchers]), new Promise((r) => setTimeout(r, Math.max(0, end - Date.now())))]);
    }
  }
  private recovered = false;

  kick = () => {
    void this.drain().catch((err) => this.ctx.log.error({ err: String(err) }, 'submitter drain failed'));
  };

  /** Resume receipt tracking for transactions sent before a restart. */
  async recover() {
    const submitted = await this.ctx.prisma.chainTx.findMany({ where: { status: 'SUBMITTED' } });
    for (const tx of submitted) {
      if (!tx.hash) {
        await this.requeue(tx, 'submitted without hash');
        continue;
      }
      this.inflight.add(tx.id);
      this.busyWorkers.add(tx.workerId);
      this.watch(tx, tx.hash as Hash);
    }
  }

  async drain() {
    if (this.draining) {
      this.again = true;
      return;
    }
    this.draining = true;
    try {
      do {
        this.again = false;
        const due = await this.ctx.prisma.chainTx.findMany({
          where: { status: 'QUEUED', nextAttemptAt: { lte: new Date() } },
          include: { attestation: true },
          orderBy: { createdAt: 'asc' },
          take: 500,
        });
        const lanes = new Map<Relayer, TxWithAttestation[]>();
        for (const tx of due) {
          if (this.inflight.has(tx.id) || this.busyWorkers.has(tx.workerId)) continue;
          this.inflight.add(tx.id);
          this.busyWorkers.add(tx.workerId);
          const relayer = this.ctx.chain.relayerForShard(tx.shard);
          lanes.set(relayer, [...(lanes.get(relayer) ?? []), tx]);
        }
        await Promise.all(
          [...lanes].map(async ([relayer, txs]) => {
            for (const tx of txs) await this.process(relayer, tx);
          }),
        );
      } while (this.again);
    } finally {
      this.draining = false;
    }
  }

  private release(tx: ChainTx) {
    this.inflight.delete(tx.id);
    this.busyWorkers.delete(tx.workerId);
  }

  private async process(relayer: Relayer, tx: TxWithAttestation) {
    const { prisma, chain } = this.ctx;
    try {
      let current = tx;
      if (current.attestation && current.attestation.deadline <= this.ctx.now() + DEADLINE_MARGIN) {
        current = await this.resign(current);
      }
      const call = this.callFor(current);
      let request;
      try {
        ({ request } = await chain.publicClient.simulateContract({
          address: chain.vault,
          abi: metronomeVaultAbi,
          functionName: call.functionName as never,
          args: call.args as never,
          account: relayer.account,
        }));
      } catch (err) {
        const reason = revertName(err);
        if (!reason) throw err; // RPC or network error: retry with backoff
        await this.onRevert(current, reason);
        return;
      }

      const hash = await this.send(relayer, request);
      await prisma.chainTx.update({
        where: { id: current.id },
        data: { status: 'SUBMITTED', hash, sender: relayer.account.address, attempts: { increment: 1 } },
      });
      this.ctx.log.info({ txId: current.id, kind: current.kind, hash }, 'submitted');
      this.watch(current, hash);
    } catch (err) {
      await this.backoff(tx, err);
    }
  }

  private callFor(tx: TxWithAttestation): Call {
    const att = tx.attestation;
    const m = (att?.message ?? {}) as Record<string, string>;
    const sig = att?.signature as Hex;
    switch (tx.kind) {
      case 'OPEN_SHIFT':
        return {
          functionName: 'openShift',
          args: [BigInt(m.workerId), BigInt(m.shiftId), BigInt(m.startAt), BigInt(m.deadline), sig],
        };
      case 'CLOSE_SHIFT':
        return {
          functionName: 'closeShift',
          args: [
            BigInt(m.workerId),
            BigInt(m.startAt),
            BigInt(m.endAt),
            BigInt(m.ratePerHour),
            BigInt(m.shiftId),
            BigInt(m.deadline),
            sig,
          ],
        };
      case 'CORRECT_SHIFT':
        return {
          functionName: 'correctShift',
          args: [BigInt(m.shiftId), BigInt(m.correctGross), Number(m.version), BigInt(m.deadline), sig],
        };
      case 'WITHDRAW': {
        const p = tx.params as Record<string, string>;
        return {
          functionName: 'withdrawWithSig',
          args: [BigInt(p.workerId), BigInt(p.amount), BigInt(p.deadline), p.signature as Hex],
        };
      }
    }
  }

  /** Classify a simulated revert: already applied (idempotent success), re-signable, or a real failure. */
  private async onRevert(tx: TxWithAttestation, reason: string) {
    const { prisma, chain } = this.ctx;
    const m = (tx.attestation?.message ?? {}) as Record<string, string>;

    if (reason === 'Expired' && tx.attestation) {
      await this.resign(tx);
      await this.requeue(tx, 'attestation expired; re-signed', 0);
      return;
    }

    let applied = false;
    if (tx.hash) {
      // An earlier send may have landed after its receipt wait timed out.
      const receipt = await chain.publicClient.getTransactionReceipt({ hash: tx.hash as Hash }).catch(() => null);
      applied = receipt?.status === 'success';
    }
    if (applied) {
      // fall through to CONFIRMED
    } else if (tx.kind === 'OPEN_SHIFT' && (reason === 'AlreadySettled' || reason === 'OnShift')) {
      const [w, s] = await Promise.all([chain.readWorker(BigInt(m.workerId)), chain.readShift(BigInt(m.shiftId))]);
      applied = w.openShiftId === BigInt(m.shiftId) || s.workerId === BigInt(m.workerId);
    } else if (tx.kind === 'CLOSE_SHIFT' && reason === 'AlreadySettled') {
      applied = (await chain.readShift(BigInt(m.shiftId))).workerId === BigInt(m.workerId);
    } else if (tx.kind === 'CORRECT_SHIFT' && reason === 'BadVersion') {
      applied = (await chain.readShift(BigInt(m.shiftId))).version >= Number(m.version);
    }

    if (applied) {
      await prisma.chainTx.update({
        where: { id: tx.id },
        data: { status: 'CONFIRMED', lastError: `already applied on-chain (${reason})` },
      });
      this.ctx.log.info({ txId: tx.id, reason }, 'already applied on-chain');
    } else {
      await prisma.chainTx.update({ where: { id: tx.id }, data: { status: 'FAILED', lastError: reason } });
      this.ctx.log.warn({ txId: tx.id, kind: tx.kind, reason }, 'transaction failed');
    }
    this.release(tx);
    this.kick();
  }

  /** Same message, fresh deadline. The old attestation stays in the history. */
  private async resign(tx: TxWithAttestation): Promise<TxWithAttestation> {
    const { prisma, attestor, cfg } = this.ctx;
    const old = tx.attestation!;
    const m = old.message as Record<string, string>;
    const deadline = this.ctx.now() + cfg.attestationTtl;
    let message: Record<string, bigint | number>;
    let signature: Hex;
    if (old.kind === 'OPEN') {
      const msg = { workerId: BigInt(m.workerId), shiftId: BigInt(m.shiftId), startAt: BigInt(m.startAt), deadline };
      signature = await attestor.signOpen(msg);
      message = msg;
    } else if (old.kind === 'CLOSE') {
      const msg = {
        workerId: BigInt(m.workerId),
        startAt: BigInt(m.startAt),
        endAt: BigInt(m.endAt),
        ratePerHour: BigInt(m.ratePerHour),
        shiftId: BigInt(m.shiftId),
        deadline,
      };
      signature = await attestor.signShift(msg);
      message = msg;
    } else {
      const msg = { shiftId: BigInt(m.shiftId), correctGross: BigInt(m.correctGross), version: Number(m.version), deadline };
      signature = await attestor.signCorrection(msg);
      message = msg;
    }
    const att = await prisma.attestation.create({
      data: {
        kind: old.kind,
        shiftId: old.shiftId,
        version: old.version,
        message: toJsonMessage(message),
        signature,
        signer: attestor.address,
        deadline,
      },
    });
    await prisma.chainTx.update({ where: { id: tx.id }, data: { attestationId: att.id } });
    return { ...tx, attestationId: att.id, attestation: att };
  }

  /** Serialised per relayer so locally tracked nonces stay contiguous. */
  private async send(relayer: Relayer, request: object): Promise<Hash> {
    const address = relayer.account.address;
    const previous = this.sendLocks.get(address) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    this.sendLocks.set(address, previous.then(() => mine));
    await previous;
    try {
      let nonce = this.nonces.get(address);
      if (nonce === undefined) {
        nonce = await this.ctx.chain.publicClient.getTransactionCount({ address, blockTag: 'pending' });
      }
      const hash = await relayer.writeContract({ ...(request as Record<string, unknown>), nonce } as never);
      this.nonces.set(address, nonce + 1);
      return hash;
    } catch (err) {
      this.nonces.delete(address); // resync from the node next time
      throw err;
    } finally {
      release();
    }
  }

  private watch(tx: ChainTx, hash: Hash) {
    const p = (async () => {
      const { prisma, chain, cfg } = this.ctx;
      try {
        const receipt = await chain.publicClient.waitForTransactionReceipt({
          hash,
          confirmations: cfg.confirmations,
          timeout: 120_000,
        });
        if (receipt.status === 'success') {
          await prisma.chainTx.update({
            where: { id: tx.id },
            data: { status: 'CONFIRMED', blockNumber: receipt.blockNumber, lastError: null },
          });
          this.ctx.log.info({ txId: tx.id, hash, block: receipt.blockNumber.toString() }, 'confirmed');
          this.release(tx);
        } else {
          // Re-simulating classifies it: already applied, re-signable, or failed.
          await this.requeue(tx, 'reverted on-chain', 0);
        }
      } catch (err) {
        this.ctx.log.warn({ txId: tx.id, hash, err: String(err) }, 'receipt not found yet; will re-check');
        await this.requeue(tx, `receipt wait failed: ${shortError(err)}`, 5);
      } finally {
        this.kick();
      }
    })();
    this.watchers.add(p);
    void p.finally(() => this.watchers.delete(p));
  }

  private async requeue(tx: ChainTx, reason: string, delaySeconds = 0) {
    await this.ctx.prisma.chainTx.update({
      where: { id: tx.id },
      data: { status: 'QUEUED', lastError: reason, nextAttemptAt: new Date(Date.now() + delaySeconds * 1000) },
    });
    this.release(tx);
  }

  private async backoff(tx: ChainTx, err: unknown) {
    const attempts = tx.attempts + 1;
    const message = shortError(err);
    if (attempts >= this.ctx.cfg.maxTxAttempts) {
      await this.ctx.prisma.chainTx.update({
        where: { id: tx.id },
        data: { status: 'FAILED', attempts, lastError: message },
      });
      this.ctx.log.error({ txId: tx.id, err: message }, 'giving up after retries');
    } else {
      await this.ctx.prisma.chainTx.update({
        where: { id: tx.id },
        data: { attempts, lastError: message, nextAttemptAt: new Date(Date.now() + 2 ** attempts * 1000) },
      });
      this.ctx.log.warn({ txId: tx.id, attempts, err: message }, 'retrying');
    }
    this.release(tx);
  }
}

function revertName(err: unknown): string | null {
  if (!(err instanceof BaseError)) return null;
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (revert instanceof ContractFunctionRevertedError) {
    return revert.data?.errorName ?? revert.reason ?? 'reverted';
  }
  return null;
}

function shortError(err: unknown) {
  return err instanceof BaseError ? err.shortMessage : String(err).slice(0, 500);
}
