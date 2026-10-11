import {after} from 'next/server';
import {timingSafeEqual} from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const allowed = /^(config|health|dashboard|gas-grants|vault|vault\/[0-9a-f]{64}|workers\/by-address\/0x[0-9a-fA-F]{40}|employers\/by-admin\/0x[0-9a-fA-F]{40}|workers\/\d+(\/shifts|\/withdraw-typed-data)?|txs\/[a-zA-Z0-9_-]+|withdrawals|clock-intents)$/;
const writes = ['withdrawals','clock-intents','dashboard','gas-grants','vault'];
const serviceKeys = ['VAULT_ADDRESS','VAULT_DEPLOY_BLOCK','EMPLOYER_ID','ATTESTOR_PRIVATE_KEY','RELAYER_PRIVATE_KEYS','WEBHOOK_SECRET','ADMIN_API_TOKEN'];
const runtimes = new Map();

function relayed(request) {
  const secret = process.env.BRIDGE_RELAY_SECRET, given = request.headers.get('x-shiftpay-relay');
  if (!secret || secret.length < 32 || !given) return false;
  const a = Buffer.from(secret), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** One validated bridge per token, kept for the life of the function instance. */
function bridgeFor(asset) {
  if (!runtimes.has(asset)) {
    const env = {...process.env, SETTLEMENT_ASSET: asset, MONAD_CHAIN_ID: '10143', MONAD_RPC_URL: process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz/'};
    for (const key of serviceKeys) env[key] = process.env[`${asset}_${key}`];
    if (!env.DATABASE_URL) throw Object.assign(new Error('DATABASE_URL is not configured'), {status: 503});
    const db = new URL(env.DATABASE_URL); db.searchParams.set('schema', asset.toLowerCase()); env.DATABASE_URL = db.toString();
    const pending = import('../../../../bridge-runtime/runtime.mjs').then(({createRuntime}) => createRuntime(env)).then(async (r) => { await r.app.ready(); return r; });
    pending.catch(() => runtimes.delete(asset));
    runtimes.set(asset, pending);
  }
  return runtimes.get(asset);
}

async function local(request, asset, target, search, raw) {
  if (!process.env[`${asset}_VAULT_ADDRESS`]) return Response.json({message:`${asset} payroll deployment is pending. Configure its deployed vault.`}, {status:503});
  const bridge = await bridgeFor(asset);
  const res = await bridge.app.inject({method: request.method, url: '/' + target + search, headers: {'content-type': 'application/json'}, payload: raw});
  // Vercel keeps no resident worker, so queued payroll transactions are submitted and confirmed after responding.
  after(() => bridge.submitter.settle(45_000).catch((err) => console.error(JSON.stringify({level:'error', msg:'settle failed', err:String(err)}))));
  return new Response(res.body, {status: res.statusCode, headers: {'content-type': 'application/json', 'cache-control': 'no-store'}});
}

async function relay(request, asset, target, search, raw) {
  const origin = process.env.BRIDGE_ORIGIN;
  if (!origin || !process.env.BRIDGE_RELAY_SECRET) return Response.json({message:'Payroll service origin is not configured.'}, {status:503});
  const url = new URL('/api/bridge/' + target + search, origin); url.searchParams.set('asset', asset);
  if (url.protocol !== 'https:') return Response.json({message:'Hosted payroll requires a public HTTPS service.'}, {status:503});
  const upstream = await fetch(url, {method: request.method, headers: {'content-type':'application/json', 'x-shiftpay-relay': process.env.BRIDGE_RELAY_SECRET}, body: raw, cache: 'no-store', signal: AbortSignal.timeout(30000)});
  return new Response(await upstream.text(), {status: upstream.status, headers: {'content-type':'application/json','cache-control':'no-store'}});
}

async function handle(request, context) {
  const {path} = await context.params;
  const target = path.join('/');
  if (!allowed.test(target) || (request.method === 'POST' && !writes.includes(target))) return Response.json({message:'Not found'}, {status:404});
  if (request.method === 'GET' && writes.includes(target)) return Response.json({message:'Method not allowed'}, {status:405});
  if (request.method === 'POST' && request.headers.get('origin') !== new URL(request.url).origin && !relayed(request)) return Response.json({message:'Origin mismatch'}, {status:403});
  try {
    const url = new URL(request.url), asset = url.searchParams.get('asset') || 'AUSD';
    if (!['AUSD','USDC'].includes(asset)) return Response.json({message:'Unsupported settlement token'}, {status:400});
    const raw = request.method === 'POST' ? await request.text() : undefined;
    if (raw && Buffer.byteLength(raw) > 65536) return Response.json({message:'Request too large'}, {status:413});
    url.searchParams.delete('asset');
    return process.env.PAYROLL_BACKEND === 'local' ? await local(request, asset, target, url.search, raw) : await relay(request, asset, target, url.search, raw);
  } catch (err) {
    console.error(JSON.stringify({level:'error', msg:'payroll request failed', err:String(err)}));
    return Response.json({message:'Payroll service is unavailable. Check the payroll configuration and database.'}, {status: err?.status || 503});
  }
}
export {handle as GET, handle as POST};
