import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyMessage,verifyTypedData} from 'viem';
import {derivePayrollSession,readMeraMetadata,meraStorageKey} from './mera.mjs';

// Fixed entropy is only a unit-test input. UI accounts require real WebAuthn PRF.
test('same passkey material restores the same real signer and clears temporary entropy',async()=>{
  const first=new Uint8Array(32).fill(17),second=new Uint8Array(first);
  const a=derivePayrollSession(first),b=derivePayrollSession(second);
  try{
    assert.equal(a.account.address,b.account.address);
    assert.ok(first.every(v=>v===0));assert.ok(second.every(v=>v===0));
    const signature=await a.account.signMessage({message:'ShiftPay account access'});
    assert.equal(await verifyMessage({address:a.account.address,message:'ShiftPay account access',signature}),true);
  }finally{a.session.end();b.session.end();}
});
test('separate passkey material creates a separate payroll account',()=>{
  const a=derivePayrollSession(new Uint8Array(32).fill(17)),b=derivePayrollSession(new Uint8Array(32).fill(18));
  try{assert.notEqual(a.account.address,b.account.address);}finally{a.session.end();b.session.end();}
});
test('payroll typed-data signatures verify for the derived account',async()=>{
  const {session,account}=derivePayrollSession(new Uint8Array(32).fill(19));
  try{
    const data={domain:{name:'MetronomeAccess',version:'1',chainId:10143,verifyingContract:'0x1111111111111111111111111111111111111111'},types:{Access:[{name:'workerId',type:'uint256'},{name:'deadline',type:'uint64'},{name:'payloadHash',type:'bytes32'}]},primaryType:'Access',message:{workerId:0n,deadline:1800000000n,payloadHash:'0x'+'ab'.repeat(32)}};
    const signature=await account.signTypedData(data);
    assert.equal(await verifyTypedData({...data,address:account.address,signature}),true);
  }finally{session.end();}
});
test('ending the signing session prevents further signing',async()=>{
  const {session,account}=derivePayrollSession(new Uint8Array(32).fill(20));session.end();
  await assert.rejects(account.signMessage({message:'Must not sign'}),e=>e.code==='SESSION_ENDED');
});
test('invalid passkey output is rejected',()=>{
  assert.throws(()=>derivePayrollSession(new Uint8Array(31)),/usable/);
});
test('public metadata is host-bound and strips unknown secret fields',()=>{
  const address='0x1111111111111111111111111111111111111111';
  const storage={getItem:key=>key===meraStorageKey('business.example')?JSON.stringify({version:1,rpId:'business.example',address,credentialId:'credential',transports:['internal'],privateKey:'forbidden'}):null};
  assert.deepEqual(readMeraMetadata(storage,'business.example'),{version:1,rpId:'business.example',address,credentialId:'credential',transports:['internal']});
  assert.equal(readMeraMetadata(storage,'employee.example'),null);
  assert.throws(()=>readMeraMetadata({getItem:()=>JSON.stringify({version:1,rpId:'wrong.example',address,credentialId:'credential'})},'business.example'),/invalid/);
});
