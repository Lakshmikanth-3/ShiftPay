/**
 * End-to-end bridge test against a local anvil chain and Postgres (docker compose up -d postgres).
 * Uses anvil's built-in development accounts (the public "test … junk" mnemonic) on the local chain only.
 */
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  createTestClient,
  createWalletClient,
  defineChain,
  http,
  parseAbiItem,
  toHex,
  verifyTypedData,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { metronomeVaultAbi } from '../src/abi/metronomeVault.js';
import { buildApp, signWebhook } from '../src/app.js';
import { makeAttestor, types } from '../src/attestor.js';
import { makeChain, type Chain } from '../src/chain.js';
import { loadConfig, type Config } from '../src/config.js';
import type { Ctx } from '../src/context.js';
import { reconcile } from '../src/reconcile.js';
import { Submitter } from '../src/submitter.js';
import {accessTypes,payloadHash} from '../src/dashboard.js';

const RPC_PORT = 18545 + Math.floor(Math.random() * 1000);
const RPC = `http://127.0.0.1:${RPC_PORT}`;
// Each run gets a fresh schema created by this run, so nothing existing is reset or overwritten.
const TEST_SCHEMA = `bridge_test_${Date.now()}_${process.pid}`;
const DB_BASE = process.env.TEST_DATABASE_URL ?? 'postgresql://metronome:metronome@localhost:5433/metronome';
const DB = `${DB_BASE}?schema=${TEST_SCHEMA}`;
const MNEMONIC = 'test test test test test test test test test test test junk';
const account = (i: number) => mnemonicToAccount(MNEMONIC, { addressIndex: i });
const key = (i: number) => toHex(account(i).getHdKey().privateKey!) as Hex;
const WEBHOOK_SECRET = 'webhook-secret-for-local-tests-only!!';
const ADMIN_TOKEN = 'admin-token-for-local-tests-only-0000';
const USD = 1_000_000n;
const HOUR = 3600n;

const artifact = (file: string, name: string) => {
  const a = JSON.parse(readFileSync(new URL(`../../contracts/out/${file}/${name}.json`, import.meta.url), 'utf8'));
  return { abi: a.abi as Abi, bytecode: a.bytecode.object as Hex };
};
const tokenArtifact = artifact('MockERC20.sol', 'MockERC20');
const vaultArtifact = artifact('MetronomeVault.sol', 'MetronomeVault');

const localChain = defineChain({
  id: 31337,
  name: 'anvil',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let anvil: ChildProcess;
let prisma: PrismaClient;
let cfg: Config;
let chain: Chain;
let ctx: Ctx;
let submitter: Submitter;
let app: ReturnType<typeof buildApp>;
let token: Address;
let chainNow = 0n;
let kickEnabled = true;

const testClient = createTestClient({ mode: 'anvil', chain: localChain, transport: http(RPC) });
const admin = createWalletClient({ account: account(0), chain: localChain, transport: http(RPC) });

async function adminWrite(address: Address, abi: Abi, functionName: string, args: unknown[]) {
  const hash = await admin.writeContract({ address, abi, functionName, args } as never);
  await chain.publicClient.waitForTransactionReceipt({ hash });
}

async function advanceTo(ts: bigint) {
  await testClient.setNextBlockTimestamp({ timestamp: ts });
  await testClient.mine({ blocks: 1 });
  chainNow = ts;
}

async function waitTx(id: string, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    submitter.kick();
    const tx = await prisma.chainTx.findUniqueOrThrow({ where: { id } });
    if (tx.status === 'CONFIRMED') return tx;
    if (tx.status === 'FAILED') throw new Error(`tx ${id} failed: ${tx.lastError}`);
    await sleep(100);
  }
  throw new Error(`tx ${id} not confirmed in time`);
}

function postClock(body: object, secret = WEBHOOK_SECRET) {
  const raw = JSON.stringify(body);
  return app.inject({
    method: 'POST',
    url: '/webhooks/clock',
    headers: { 'content-type': 'application/json', 'x-metronome-signature': signWebhook(secret, raw) },
    payload: raw,
  });
}

const balanceOf = (who: Address) =>
  chain.publicClient.readContract({ address: token, abi: tokenArtifact.abi, functionName: 'balanceOf', args: [who] }) as Promise<bigint>;
const claimable = (id: bigint) =>
  chain.publicClient.readContract({ address: chain.vault, abi: metronomeVaultAbi, functionName: 'claimable', args: [id] });

beforeAll(async () => {
  anvil = spawn('anvil', ['--port', String(RPC_PORT), '--chain-id', '31337', '--silent'], { stdio: 'ignore' });
  const probe = createTestClient({ mode: 'anvil', chain: localChain, transport: http(RPC, { retryCount: 0 }) });
  for (let i = 0; ; i++) {
    try {
      await probe.getAutomine();
      break;
    } catch {
      if (i > 100) throw new Error('anvil did not start');
      await sleep(200);
    }
  }

  execSync('npx prisma db push --skip-generate', {
    env: { ...process.env, DATABASE_URL: DB },
    stdio: 'pipe',
  });
  prisma = new PrismaClient({ datasourceUrl: DB });

  const deploy = async (a: { abi: Abi; bytecode: Hex }, args: unknown[]) => {
    const hash = await admin.deployContract({ abi: a.abi, bytecode: a.bytecode, args } as never);
    const r = await (await import('viem')).createPublicClient({ chain: localChain, transport: http(RPC) }).waitForTransactionReceipt({ hash });
    return r.contractAddress!;
  };
  token = await deploy(tokenArtifact, []);
  const vault = await deploy(vaultArtifact, [token]);

  cfg = loadConfig({
    DATABASE_URL: DB,
    MONAD_RPC_URL: RPC,
    MONAD_CHAIN_ID: '31337',
    VAULT_ADDRESS: vault,
    EMPLOYER_ID: '1',
    VAULT_DEPLOY_BLOCK: '0',
    ATTESTOR_PRIVATE_KEY: key(1),
    RELAYER_PRIVATE_KEYS: `${key(2)},${key(3)}`,
    WEBHOOK_SECRET,
    ADMIN_API_TOKEN: ADMIN_TOKEN,
    ATTESTATION_TTL_SECONDS: '120',
  });
  chain = makeChain(cfg);

  const vaultAbi = metronomeVaultAbi as unknown as Abi;
  await adminWrite(vault, vaultAbi, 'createEmployer', [account(1).address, account(5).address]);
  await adminWrite(vault, vaultAbi, 'createWorker', [1n, 7n, 24n * USD, 2000, 8 * 3600, account(4).address]);
  await adminWrite(vault, vaultAbi, 'createWorker', [1n, 70n, 30n * USD, 1000, 8 * 3600, account(6).address]);
  await adminWrite(token, tokenArtifact.abi, 'mint', [account(0).address, 10_000n * USD]);
  await adminWrite(token, tokenArtifact.abi, 'approve', [vault, 10_000n * USD]);
  await adminWrite(vault, vaultAbi, 'fundWorkers', [1n, [7n, 70n], [200n * USD, 200n * USD]]);

  chainNow = (await chain.publicClient.getBlock()).timestamp;
  const quiet = { info: () => {}, warn: () => {}, error: (o: object, m?: string) => console.error(m, o) };
  ctx = {
    cfg,
    prisma,
    chain,
    attestor: makeAttestor(cfg.attestorKey, cfg.chainId, cfg.vault),
    now: () => chainNow,
    kick: () => kickEnabled && submitter.kick(),
    log: quiet,
  };
  submitter = new Submitter(ctx);
  app = buildApp(ctx);
});

afterAll(async () => {
  await submitter?.stop();
  await app?.close();
  // Drop only the schema this run created.
  await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`).catch(() => {});
  await prisma?.$disconnect();
  anvil?.kill();
});

describe('attestation bridge', () => {
  let shiftId: string;
  let clockInAt: bigint;

  it('reports a healthy configuration', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, chainId: 31337, attestorRegistered: true });
  });

  it('indexes real worker events and restricts HR reads to the signed account',async()=>{
    const proof=async(signer:ReturnType<typeof account>,workerId='0',data:Record<string,unknown>={},chainId=cfg.chainId)=>{const deadline=chainNow+300n;return {address:signer.address,workerId,deadline:deadline.toString(),data,signature:await signer.signTypedData({domain:{name:'MetronomeAccess',version:'1',chainId,verifyingContract:cfg.vault},types:accessTypes,primaryType:'Access',message:{workerId:BigInt(workerId),deadline,payloadHash:payloadHash(data)}})};};
    const request=await proof(account(0),'0',{companyName:'Integration Company',employee:{workerId:'7',name:'Registered Employee',role:'Warehouse Associate',department:'Operations'}});
    const res=await app.inject({method:'POST',url:'/dashboard',payload:request});expect(res.statusCode).toBe(200);const result=res.json();expect(result.progress.complete).toBe(true);expect(result.workers.map((w:any)=>w.workerId).sort()).toEqual(['7','70']);expect(result.company.name).toBe('Integration Company');expect(result.payments.filter((p:any)=>p.type==='Funded')).toHaveLength(2);expect(result.workers.find((w:any)=>w.workerId==='7').profile.name).toBe('Registered Employee');
    const employee=await app.inject({method:'POST',url:'/dashboard',payload:await proof(account(4),'7')});expect(employee.statusCode).toBe(200);expect(employee.json().workers).toHaveLength(1);expect(employee.json().workers[0].workerId).toBe('7');
    for(const bad of [await proof(account(6),'7'),await proof(account(4),'0'),await proof(account(0),'0',{},1),{...request,data:{companyName:'Tampered'}},await proof(account(4),'7',{companyName:'Employee edit'})]){const rejected=await app.inject({method:'POST',url:'/dashboard',payload:bad});expect(rejected.statusCode).toBeGreaterThanOrEqual(400);}
    const newer=await proof(account(0),'0',{companyName:'Updated Company'});expect((await app.inject({method:'POST',url:'/dashboard',payload:newer})).statusCode).toBe(200);expect((await app.inject({method:'POST',url:'/dashboard',payload:request})).json().company.name).toBe('Updated Company');
    const expired=await proof(account(0));expired.deadline=(chainNow-1n).toString();expect((await app.inject({method:'POST',url:'/dashboard',payload:expired})).statusCode).toBe(401);
  });

  it('rejects webhooks without a valid signature', async () => {
    const res = await postClock({ idempotencyKey: 'x', workerId: '7', type: 'clock_in' }, 'wrong-secret-wrong-secret-wrong-secret');
    expect(res.statusCode).toBe(401);
    expect(await prisma.clockEvent.count()).toBe(0);
  });

  it('opens a shift from a clock-in and settles it on-chain', async () => {
    clockInAt = chainNow;
    const res = await postClock({ idempotencyKey: 'in-1', workerId: '7', type: 'clock_in' });
    expect(res.statusCode).toBe(202);
    shiftId = res.json().shiftId;
    await waitTx(res.json().txId);
    const w = await chain.readWorker(7n);
    expect(w.openShiftId).toBe(BigInt(shiftId));
    expect(w.clockInAt).toBe(clockInAt);
  });

  it('treats a redelivered webhook as a duplicate and refuses a second open shift', async () => {
    const again = await postClock({ idempotencyKey: 'in-1', workerId: '7', type: 'clock_in' });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ duplicate: true, shiftId });
    expect(await prisma.chainTx.count({ where: { kind: 'OPEN_SHIFT', workerId: '7' } })).toBe(1);

    const second = await postClock({ idempotencyKey: 'in-2', workerId: '7', type: 'clock_in' });
    expect(second.statusCode).toBe(409);
  });

  it('shows the ticking estimate, then settles the clock-out exactly', async () => {
    await advanceTo(clockInAt + 4n * HOUR);
    const view = await app.inject({ method: 'GET', url: '/workers/7' });
    expect(BigInt(view.json().claimable)).toBeGreaterThanOrEqual(768n * USD / 10n);

    const res = await postClock({ idempotencyKey: 'out-1', workerId: '7', type: 'clock_out' });
    expect(res.statusCode).toBe(202);
    await waitTx(res.json().txId);
    const s = await chain.readShift(BigInt(shiftId));
    expect(s.net).toBe(768n * USD / 10n); // $96 gross − 20%
    expect(s.tax).toBe(192n * USD / 10n);
    expect((await chain.readWorker(7n)).clockInAt).toBe(0n);
    expect(await claimable(7n)).toBe(768n * USD / 10n);
  });

  it('re-signs an expired attestation when retrying', async () => {
    kickEnabled = false; // queue without submitting, as if the bridge were down
    const res = await postClock({ idempotencyKey: 'in-70', workerId: '70', type: 'clock_in' });
    expect(res.statusCode).toBe(202);
    await advanceTo(chainNow + 600n); // past the 120 s TTL
    kickEnabled = true;
    await waitTx(res.json().txId);
    const atts = await prisma.attestation.findMany({ where: { shiftId: res.json().shiftId }, orderBy: { createdAt: 'asc' } });
    expect(atts).toHaveLength(2);
    expect(atts[1].deadline).toBeGreaterThan(atts[0].deadline);
    expect((await chain.readWorker(70n)).openShiftId).toBe(BigInt(res.json().shiftId));
  });

  it('never settles a shift twice when a confirmed close is retried', async () => {
    const close = await prisma.chainTx.findFirstOrThrow({ where: { kind: 'CLOSE_SHIFT', workerId: '7' } });
    // Simulate a crash between broadcast and recording the result.
    await prisma.chainTx.update({ where: { id: close.id }, data: { status: 'QUEUED', hash: null } });
    const tx = await waitTx(close.id);
    expect(tx.lastError).toMatch(/already applied/);
    const logs = await chain.publicClient.getLogs({
      address: chain.vault,
      event: parseAbiItem('event ShiftClosed(uint256 indexed workerId, uint256 indexed shiftId, uint64 startAt, uint64 endAt, uint256 gross, uint256 tax)'),
      args: { shiftId: BigInt(shiftId) },
      fromBlock: 0n,
    });
    expect(logs).toHaveLength(1);
    expect((await chain.readShift(BigInt(shiftId))).net).toBe(768n * USD / 10n);
  });

  it('applies an employer correction through the admin API', async () => {
    const url = `/admin/shifts/${shiftId}/corrections`;
    const payload = { correctGross: (48n * USD).toString() };
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
    const res = await app.inject({ method: 'POST', url, payload, headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
    expect(res.statusCode).toBe(202);
    expect(res.json().version).toBe(1);
    await waitTx(res.json().txId);
    const s = await chain.readShift(BigInt(shiftId));
    expect(s.version).toBe(1);
    expect(s.net).toBe(384n * USD / 10n);
    expect(await claimable(7n)).toBe(384n * USD / 10n);
  });

  it('relays a worker-signed withdrawal and refuses replays and forgeries', async () => {
    const amount = 10n * USD;
    const td = (await app.inject({ method: 'GET', url: `/workers/7/withdraw-typed-data?amount=${amount}` })).json();
    const message = {
      workerId: BigInt(td.message.workerId),
      amount: BigInt(td.message.amount),
      nonce: BigInt(td.message.nonce),
      deadline: BigInt(td.message.deadline),
    };
    const sign = (i: number, m = message) =>
      account(i).signTypedData({ domain: td.domain, types: { Withdraw: types.Withdraw }, primaryType: 'Withdraw', message: m });
    const body = (signature: Hex, m = message) => ({
      workerId: m.workerId.toString(),
      amount: m.amount.toString(),
      deadline: m.deadline.toString(),
      signature,
    });

    const forged = await app.inject({ method: 'POST', url: '/withdrawals', payload: body(await sign(5)) });
    expect(forged.statusCode).toBe(401);

    const tooMuch = { ...message, amount: 1_000n * USD };
    const over = await app.inject({ method: 'POST', url: '/withdrawals', payload: body(await sign(4, tooMuch), tooMuch) });
    expect(over.statusCode).toBe(422);

    const signature = await sign(4);
    const res = await app.inject({ method: 'POST', url: '/withdrawals', payload: body(signature) });
    expect(res.statusCode).toBe(202);
    await waitTx(res.json().txId);
    expect(await balanceOf(account(4).address)).toBe(amount);
    expect(await balanceOf(account(2).address)).toBe(0n); // relayers never receive wages
    expect(await balanceOf(account(3).address)).toBe(0n);

    const replay = await app.inject({ method: 'POST', url: '/withdrawals', payload: body(signature) });
    expect(replay.statusCode).toBe(401);
  });

  it('serves shift history whose every line verifies against the attestor', async () => {
    const res = (await app.inject({ method: 'GET', url: '/workers/7/shifts' })).json();
    const primary = { OPEN: 'OpenShift', CLOSE: 'Shift', CORRECTION: 'Correction' } as const;
    let checked = 0;
    for (const shift of res.shifts) {
      for (const att of shift.attestations) {
        const message = Object.fromEntries(
          Object.entries(att.message as Record<string, string | number>).map(([k, v]) => [k, BigInt(v)]),
        );
        const ok = await verifyTypedData({
          address: res.attestor,
          domain: res.domain,
          types,
          primaryType: primary[att.kind as keyof typeof primary],
          message: message as never,
          signature: att.signature,
        });
        expect(ok).toBe(true);
        checked++;
      }
    }
    expect(checked).toBe(4); // open, close, close re-signed during the replay test, correction
  });

  it('reconciles with the vault and flags shifts attested outside the bridge', async () => {
    const clean = await reconcile(ctx);
    expect(clean.mismatches).toEqual([]);
    expect(clean.unknownOnChain).toEqual([]);
    expect(clean.checkedShifts).toBe(2);

    // The attestor key signs a shift the bridge never recorded — e.g. a leaked key.
    const rogueId = 999n;
    const end = chainNow;
    const start = end - HOUR;
    const message = { workerId: 7n, startAt: start, endAt: end, ratePerHour: 24n * USD, shiftId: rogueId, deadline: end + 600n };
    const sig = await ctx.attestor.signShift(message);
    const hash = await chain.relayers[0].writeContract({
      address: chain.vault,
      abi: metronomeVaultAbi,
      functionName: 'closeShift',
      args: [7n, start, end, 24n * USD, rogueId, end + 600n, sig],
    });
    await chain.publicClient.waitForTransactionReceipt({ hash });
    const flagged = await reconcile(ctx);
    expect(flagged.unknownOnChain).toEqual([{ shiftId: '999', workerId: '7', txHash: hash }]);
  });
});
