import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { isHex, verifyTypedData, type Hex, erc20Abi } from 'viem';
import { metronomeVaultAbi } from './abi/metronomeVault.js';
import { HttpError, type Ctx } from './context.js';
import { handleClockEvent } from './services/clock.js';
import { correctShift } from './services/corrections.js';
import { relayWithdrawal, withdrawTypedData } from './services/withdrawals.js';
import {dashboardRoutes} from './dashboard.js';

const uint = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));

const clockBody = z.object({
  idempotencyKey: z.string().min(1).max(200),
  workerId: uint,
  type: z.enum(['clock_in', 'clock_out']),
  at: uint.optional(),
});

const withdrawalBody = z.object({
  workerId: uint,
  amount: uint,
  deadline: uint,
  signature: z.string().refine((v) => isHex(v), 'hex signature').transform((v) => v as Hex),
});

const correctionBody = z.object({ correctGross: uint });

export function signWebhook(secret: string, rawBody: string) {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
}

function verifyWebhook(secret: string, rawBody: string, header: string | undefined) {
  if (!header) return false;
  const expected = Buffer.from(signWebhook(secret, rawBody));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 'bad_request');
  return r.data;
}

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

export function buildApp(ctx: Ctx): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  app.setReplySerializer(json);

  // Keep the raw body so webhook HMACs are checked over the exact bytes received.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
    try {
      done(null, (body as string).length ? JSON.parse(body as string) : {});
    } catch {
      done(new HttpError(400, 'invalid JSON', 'bad_json'), undefined);
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.code ?? 'error', message: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: 'bad_request', message: (err as Error).message });
    ctx.log.error({ err: String(err), stack: (err as Error).stack }, 'unhandled error');
    return reply.status(500).send({ error: 'internal', message: 'internal error' });
  });

  const requireAdmin = (req: FastifyRequest) => {
    const header = req.headers.authorization ?? '';
    const expected = Buffer.from(`Bearer ${ctx.cfg.adminToken}`);
    const given = Buffer.from(header);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new HttpError(401, 'admin token required', 'unauthorized');
    }
  };

  app.get('/config', async () => {
    const token = await ctx.chain.publicClient.readContract({ address: ctx.chain.vault, abi: metronomeVaultAbi, functionName: 'token' });
    const [decimals, symbol, employer] = await Promise.all([
      ctx.chain.publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
      ctx.chain.publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
      ctx.chain.publicClient.readContract({ address: ctx.chain.vault, abi: metronomeVaultAbi, functionName: 'employers', args: [ctx.cfg.employerId] }),
    ]);
    return { chainId: ctx.cfg.chainId, vault: ctx.chain.vault, employerId: ctx.cfg.employerId, token, decimals, symbol, admin: employer[0], taxAddress: employer[2] };
  });

  // Browser clock events require the registered employer wallet, never a browser-held API secret.
  app.post('/clock-intents', async (req, reply) => {
    const body = parse(z.object({ workerId: uint, type: z.enum(['clock_in', 'clock_out']), nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/), deadline: uint, signature: z.string().refine(isHex) }), req.body);
    if (body.deadline <= ctx.now() || body.deadline > ctx.now() + 600n) throw new HttpError(422, 'Clock authorization expired or exceeds ten minutes', 'expired');
    const worker = await ctx.chain.readWorker(body.workerId);
    if (worker.flags === 0 || worker.employerId !== ctx.cfg.employerId) throw new HttpError(403, 'Worker is not registered to this employer', 'wrong_employer');
    const employer = await ctx.chain.publicClient.readContract({ address: ctx.chain.vault, abi: metronomeVaultAbi, functionName: 'employers', args: [ctx.cfg.employerId] });
    const valid = await verifyTypedData({ address: employer[0], domain: { name: 'ShiftPayClock', version: '1', chainId: ctx.cfg.chainId, verifyingContract: ctx.chain.vault }, types: { Clock: [{ name: 'workerId', type: 'uint256' }, { name: 'action', type: 'uint8' }, { name: 'nonce', type: 'bytes32' }, { name: 'deadline', type: 'uint64' }] }, primaryType: 'Clock', message: { workerId: body.workerId, action: body.type === 'clock_in' ? 0 : 1, nonce: body.nonce as Hex, deadline: body.deadline }, signature: body.signature as Hex });
    if (!valid) throw new HttpError(401, 'Employer wallet signature required', 'bad_signature');
    const result = await handleClockEvent(ctx, { workerId: body.workerId, type: body.type === 'clock_in' ? 'CLOCK_IN' : 'CLOCK_OUT', idempotencyKey: `wallet:${body.nonce}` });
    return reply.status(result.duplicate ? 200 : 202).send(result);
  });

  app.get('/health', async () => {
    const { chain, cfg, attestor } = ctx;
    const [chainId, block, employer] = await Promise.all([
      chain.publicClient.getChainId(),
      chain.publicClient.getBlockNumber(),
      chain.publicClient.readContract({
        address: chain.vault,
        abi: metronomeVaultAbi,
        functionName: 'employers',
        args: [cfg.employerId],
      }),
    ]);
    await ctx.prisma.$queryRaw`SELECT 1`;
    return {
      ok: chainId === cfg.chainId && employer[1] === attestor.address,
      chainId,
      block,
      vault: chain.vault,
      employerId: cfg.employerId,
      attestor: attestor.address,
      attestorRegistered: employer[1] === attestor.address,
      relayers: chain.relayers.map((r) => r.account.address),
    };
  });

  // ───────────── timekeeping webhook ─────────────

  app.post('/webhooks/clock', async (req, reply) => {
    const raw = (req as FastifyRequest & { rawBody?: string }).rawBody ?? '';
    if (!verifyWebhook(ctx.cfg.webhookSecret, raw, req.headers['x-metronome-signature'] as string | undefined)) {
      throw new HttpError(401, 'invalid webhook signature', 'bad_webhook_signature');
    }
    const body = parse(clockBody, req.body);
    const result = await handleClockEvent(ctx, {
      idempotencyKey: body.idempotencyKey,
      workerId: body.workerId,
      type: body.type === 'clock_in' ? 'CLOCK_IN' : 'CLOCK_OUT',
      at: body.at,
    });
    return reply.status(result.duplicate ? 200 : 202).send(result);
  });

  // ───────────── worker views ─────────────

  // Many viewers poll the same worker; a short cache keeps chain reads under the public RPC rate limit.
  const workerCache = new Map<string, { at: number; value: Promise<unknown> }>();
  app.get<{ Params: { workerId: string } }>('/workers/:workerId', async (req) => {
    const workerId = parse(uint, req.params.workerId);
    const cached = workerCache.get(workerId.toString());
    if (cached && Date.now() - cached.at < 1500) return cached.value;
    const value = readWorkerView(workerId);
    workerCache.set(workerId.toString(), { at: Date.now(), value });
    value.catch(() => workerCache.delete(workerId.toString()));
    return value;
  });
  async function readWorkerView(workerId: bigint) {
    const { chain } = ctx;
    const read = (functionName: 'claimable' | 'owedBack' | 'arrears' | 'allocationRunway' | 'reclaimable') =>
      chain.publicClient.readContract({ address: chain.vault, abi: metronomeVaultAbi, functionName, args: [workerId] });
    const [worker, earned, claimable, owedBack, arrears, runway, openShift] = await Promise.all([
      chain.readWorker(workerId),
      chain.publicClient.readContract({ address: chain.vault, abi: metronomeVaultAbi, functionName: 'earned', args: [workerId] }),
      read('claimable'),
      read('owedBack'),
      read('arrears'),
      read('allocationRunway'),
      ctx.prisma.shift.findFirst({ where: { workerId: workerId.toString(), status: 'OPEN' } }),
    ]);
    if (worker.flags === 0) throw new HttpError(404, 'unknown worker', 'unknown_worker');
    if (worker.employerId !== ctx.cfg.employerId) throw new HttpError(403, 'Worker belongs to a different employer', 'wrong_employer');
    return {
      workerId,
      worker,
      earned: { net: earned[0], tax: earned[1], openGross: earned[2] },
      claimable,
      owedBack,
      arrears,
      runwaySeconds: runway,
      openShift,
      readAt: ctx.now(),
    };
  }

  /** Shift history with every signed attestation and its transaction, so a worker can verify each line. */
  app.get<{ Params: { workerId: string } }>('/workers/:workerId/shifts', async (req) => {
    const workerId = parse(uint, req.params.workerId);
    const worker = await ctx.chain.readWorker(workerId);
    if (worker.flags === 0 || worker.employerId !== ctx.cfg.employerId) throw new HttpError(403, 'Worker is not registered to this employer', 'wrong_employer');
    const shifts = await ctx.prisma.shift.findMany({
      where: { workerId: workerId.toString() },
      orderBy: { startAt: 'desc' },
      take: 100,
      include: {
        attestations: {
          orderBy: { createdAt: 'asc' },
          include: { txs: { select: { id: true, status: true, hash: true, blockNumber: true, lastError: true } } },
        },
      },
    });
    return { domain: ctx.attestor.domain, attestor: ctx.attestor.address, shifts };
  });

  app.get<{ Params: { workerId: string }; Querystring: { amount?: string } }>(
    '/workers/:workerId/withdraw-typed-data',
    async (req) => {
      const workerId = parse(uint, req.params.workerId);
      const amount = parse(uint, req.query.amount ?? '');
      return withdrawTypedData(ctx, workerId, amount);
    },
  );

  app.post('/withdrawals', async (req, reply) => {
    const body = parse(withdrawalBody, req.body);
    return reply.status(202).send(await relayWithdrawal(ctx, body));
  });

  app.get<{ Params: { id: string } }>('/txs/:id', async (req) => {
    const tx = await ctx.prisma.chainTx.findUnique({ where: { id: req.params.id } });
    if (!tx) throw new HttpError(404, 'unknown transaction', 'unknown_tx');
    return tx;
  });

  // ───────────── employer admin ─────────────

  app.post<{ Params: { shiftId: string } }>('/admin/shifts/:shiftId/corrections', async (req, reply) => {
    requireAdmin(req);
    const shiftId = parse(uint, req.params.shiftId).toString();
    const { correctGross } = parse(correctionBody, req.body);
    return reply.status(202).send(await correctShift(ctx, shiftId, correctGross));
  });

  app.get<{ Querystring: { status?: string } }>('/admin/txs', async (req) => {
    requireAdmin(req);
    const status = req.query.status ? parse(z.enum(['QUEUED', 'SUBMITTED', 'CONFIRMED', 'FAILED']), req.query.status) : undefined;
    return ctx.prisma.chainTx.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 200 });
  });

  dashboardRoutes(app,ctx);
  return app;
}
