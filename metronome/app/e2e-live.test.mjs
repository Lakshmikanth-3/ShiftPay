// Live, read-only acceptance checks against the deployed ShiftPay sites and Monad testnet.
// Run: npm run test:live   (optional: WORKER_ID=<id> to check one employee's payroll state)
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicClient,http,getAddress} from 'viem';
import {metronomeVaultAbi} from './vault-abi.mjs';

const business=process.env.BUSINESS_URL||'https://shiftpay-business.vercel.app';
const employee=process.env.EMPLOYEE_URL||'https://shiftpay-employee.vercel.app';
const expected={
  chainId:10143,
  vault:'0xA1C794EA48A1D86294848D28E85c76328070DB24',
  employerId:'1',
  admin:'0x430ff06AB045911e5dC6B7a742ddC11f27F47487',
  attestor:'0xEf4de9Baa7A0F32E686AC7984b3f7594EFA6f799',
  relayer:'0xC3cDFA6fB75c91c1B26A6067111b1679e2edE494',
  taxAddress:'0x4e3f8497F732326CFB8cC4d17Ad0688b74582776',
  token:'0x534b2f3A21130d7a60830c2Df862319e593943A3',
  decimals:6,
};
const client=createPublicClient({transport:http('https://testnet-rpc.monad.xyz/')});
const same=(a,b)=>assert.equal(getAddress(a),getAddress(b));
const json=async url=>{const r=await fetch(url);assert.equal(r.status,200,url+' -> '+r.status);return r.json();};
const status=async url=>(await fetch(url,{redirect:'manual'})).status;

for(const [name,host] of [['business',business],['employee',employee]]){
  test(name+' bridge health is ok with registered attestor',async()=>{
    const h=await json(host+'/api/bridge/health?asset=USDC');
    assert.equal(h.ok,true);assert.equal(h.attestorRegistered,true);assert.equal(h.chainId,expected.chainId);
    same(h.vault,expected.vault);assert.equal(h.employerId,expected.employerId);same(h.attestor,expected.attestor);
    assert.ok(h.relayers.some(r=>getAddress(r)===getAddress(expected.relayer)));
  });
  test(name+' bridge config matches the deployed USDC vault',async()=>{
    const c=await json(host+'/api/bridge/config?asset=USDC');
    assert.equal(c.chainId,expected.chainId);same(c.vault,expected.vault);assert.equal(c.employerId,expected.employerId);
    same(c.admin,expected.admin);same(c.token,expected.token);same(c.taxAddress,expected.taxAddress);
    assert.equal(c.decimals,expected.decimals);assert.equal(c.symbol,'USDC');
  });
  test(name+' rejects cross-origin withdrawal POST',async()=>{
    const r=await fetch(host+'/api/bridge/withdrawals?asset=USDC',{method:'POST',headers:{origin:'https://cross-origin.invalid','content-type':'application/json'},body:'{}'});
    assert.equal(r.status,403);
  });
}

test('vault on-chain state matches config',async()=>{
  assert.equal(await client.getChainId(),expected.chainId);
  const [admin,attestor,taxAddr]=await client.readContract({address:expected.vault,abi:metronomeVaultAbi,functionName:'employers',args:[1n]});
  same(admin,expected.admin);same(attestor,expected.attestor);same(taxAddr,expected.taxAddress);
  same(await client.readContract({address:expected.vault,abi:metronomeVaultAbi,functionName:'token'}),expected.token);
});

const employeeRoutes=['/employee','/employee/send','/employee/receive','/employee/cashout','/employee/history','/employee/profile'];
const businessRoutes=['/employer','/deploy'];
test('employee routes are served only on the employee host',async()=>{
  for(const path of employeeRoutes){
    assert.equal(await status(employee+path),200,'employee '+path);
    assert.equal(await status(business+path),404,'business '+path);
  }
});
test('company routes are served only on the business host',async()=>{
  for(const path of businessRoutes){
    assert.equal(await status(business+path),200,'business '+path);
    assert.equal(await status(employee+path),404,'employee '+path);
  }
});

test('worker payroll matches on-chain state',{skip:!process.env.WORKER_ID&&'set WORKER_ID to check a registered employee'},async()=>{
  const id=BigInt(process.env.WORKER_ID);
  const w=await json(business+'/api/bridge/workers/'+id+'?asset=USDC');
  const read=fn=>client.readContract({address:expected.vault,abi:metronomeVaultAbi,functionName:fn,args:[id]});
  const [chain,earned,claimable]=await Promise.all([read('workers'),read('earned'),read('claimable')]);
  const [,funded,withdrawn,,,,clockInAt,,employerId,,withholdingBps,flags,payoutAddr]=chain;
  assert.equal(String(w.worker.employerId),employerId.toString());
  assert.equal(String(w.worker.flags),String(flags));
  same(w.worker.payoutAddr,payoutAddr);
  assert.equal(BigInt(w.worker.funded),funded);
  assert.equal(BigInt(w.worker.withdrawn),withdrawn);
  assert.equal(String(w.worker.withholdingBps),String(withholdingBps));
  const api=BigInt(w.claimable);
  assert.ok(api>=0n&&api<=funded-withdrawn,'claimable within funded allocation');
  // Off shift, accrual is frozen, so the API and chain must agree exactly.
  if(clockInAt===0n){assert.equal(api,claimable);assert.equal(BigInt(w.earned.net),earned[0]);assert.equal(BigInt(w.earned.tax),earned[1]);}
  else assert.ok(claimable>=api,'on-shift claimable only grows');
});
