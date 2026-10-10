import test from 'node:test';
import assert from 'node:assert/strict';
import {fundingPlan,confirmFundingBatch} from '../lib/funding.mjs';
const cfg={token:'0x0000000000000000000000000000000000000001',vault:'0x0000000000000000000000000000000000000002',employerId:'1',chainId:10143,symbol:'USDC'};
function fixture({balance=100n,allowance=0n,status='ready',error}={}){let queried=false;return {client:{readContract:async c=>c.functionName==='balanceOf'?balance:allowance},wallet:{account:{address:'0x0000000000000000000000000000000000000003'},getCapabilities:async()=>{queried=true;if(error)throw error;return {atomic:{status}}}},queried:()=>queried};}
const args=value=>({...value,cfg,workerId:'7',amount:20n});
test('existing allowance removes the approval entirely',async()=>{const f=fixture({allowance:20n});const p=await fundingPlan(args(f));assert.equal(p.mode,'fund');assert.equal(p.calls.length,1);assert.equal(f.queried(),false);});
test('ready atomic account combines exact approval and allocation',async()=>{const p=await fundingPlan(args(fixture()));assert.equal(p.mode,'atomic');assert.deepEqual(p.calls.map(c=>c.functionName),['approve','fundWorkers']);assert.equal(p.calls[0].args[1],20n);assert.deepEqual(p.calls[1].args,[1n,[7n],[20n]]);});
test('supported but not ready accounts are never upgraded automatically',async()=>{assert.equal((await fundingPlan(args(fixture({status:'supported'})))).mode,'approve-then-fund');});
test('insufficient balances stop before capability or transaction requests',async()=>{const f=fixture({balance:19n});await assert.rejects(fundingPlan(args(f)),/needs more USDC/);assert.equal(f.queried(),false);});
test('explicit method non-support selects the ordinary transaction workflow',async()=>{assert.equal((await fundingPlan(args(fixture({error:{code:4200}})))).mode,'approve-then-fund');});
test('rejected authorization never silently switches transaction paths',async()=>{await assert.rejects(fundingPlan(args(fixture({error:new Error('Account access denied')}))),/Account access denied/);});
test('batch submission is not presented as confirmed payment',async()=>{assert.equal(await confirmFundingBatch({cfg,pending:{bundleId:'batch'},client:{},wallet:{getCallsStatus:async()=>({chainId:10143,status:'pending'})}}),'SUBMITTED');});
test('wrong-chain settlement is rejected',async()=>{await assert.rejects(confirmFundingBatch({cfg,pending:{bundleId:'batch'},client:{},wallet:{getCallsStatus:async()=>({chainId:1,status:'success',atomic:true,receipts:[]})}}),/different network/);});
test('successful wallet status without receipts is not funding evidence',async()=>{await assert.rejects(confirmFundingBatch({cfg,pending:{bundleId:'batch'},client:{},wallet:{getCallsStatus:async()=>({chainId:10143,status:'success',atomic:true,receipts:[]})}}),/verifiable/);});

test('passkey (local) signers skip the wallet capability request',async()=>{const f=fixture();const a=args(f);a.wallet={...a.wallet,account:{...a.wallet.account,type:'local'}};const p=await fundingPlan(a);assert.equal(p.mode,'approve-then-fund');assert.equal(f.queried(),false);});
test('an RPC without wallet methods falls back to ordinary transactions',async()=>{assert.equal((await fundingPlan(args(fixture({error:Object.assign(new Error('RPC Request failed.'),{code:-32603})})))).mode,'approve-then-fund');});
