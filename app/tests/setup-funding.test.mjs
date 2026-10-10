import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertSetupFunding} from '../lib/setup-funding.mjs';
import {loadSetupRecord} from '../lib/deployment-store.mjs';

test('registration state survives a locked signing session',()=>{
  const company='0x1111111111111111111111111111111111111111',token='0x2222222222222222222222222222222222222222';
  const record={chainId:10143,company,token,employerId:'1'};
  const storage={getItem:key=>key===`shiftpay:deployment:10143:${company}:USDC`?JSON.stringify(record):null};
  assert.deepEqual(loadSetupRecord(storage,company,'USDC',token),record);
  assert.equal(loadSetupRecord(storage,'','USDC',token),null);
  assert.equal(loadSetupRecord(storage,company,'AUSD',token),null);
  assert.throws(()=>loadSetupRecord(storage,company,'USDC',company),/does not match/);
});

test('zero-MON setup stops with a readable funding explanation',()=>{
  assert.throws(()=>assertSetupFunding({balance:0n,gas:8565478n,maxFeePerGas:182400000000n}),/Add test MON.*Balance: 0 MON/);
});
test('setup requires the full estimated fee cap and explicit service transfer',()=>{
  const args={gas:100000n,maxFeePerGas:200000000000n,value:50000000000000000n};
  assert.throws(()=>assertSetupFunding({...args,balance:69999999999999999n}),/including network fees/);
  assert.equal(assertSetupFunding({...args,balance:70000000000000000n}),70000000000000000n);
});
test('legacy fee estimates are checked without inventing a fee',()=>{
  assert.equal(assertSetupFunding({balance:300n,gas:100n,gasPrice:3n}),300n);
  assert.throws(()=>assertSetupFunding({balance:300n,gas:100n}),/estimate is unavailable/);
});
test('invalid amount and gas parameters fail before signing',()=>{
  for(const args of [{balance:-1n,gas:1n},{balance:1n,gas:0n},{balance:1n,gas:1n,value:-1n}])
    assert.throws(()=>assertSetupFunding({...args,maxFeePerGas:1n}),/could not be verified/);
});
