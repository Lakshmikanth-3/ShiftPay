import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyMessage,verifyTypedData,encodeDeployData,parseTransaction,recoverTransactionAddress} from 'viem';
import {readFileSync} from 'node:fs';
import {derivePayrollSession,readMeraMetadata,meraStorageKey} from '../lib/mera.mjs';

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
test('Mera signs a valid Monad deployment transaction for its actual session account',async()=>{
  const {session,account}=derivePayrollSession(new Uint8Array(32).fill(21));
  const abi=JSON.parse(readFileSync(new URL('../lib/vault-abi.json',import.meta.url),'utf8'));
  const {bytecode}=JSON.parse(readFileSync(new URL('../lib/deployment-artifact.json',import.meta.url),'utf8'));
  const data=encodeDeployData({abi,bytecode,args:['0x534b2f3A21130d7a60830c2Df862319e593943A3']});
  try{
    const transaction={type:'eip1559',chainId:10143,nonce:0,gas:8565478n,maxFeePerGas:182400000000n,maxPriorityFeePerGas:2000000000n,value:0n,data};
    const serializedTransaction=await account.signTransaction(transaction);
    const decoded=parseTransaction(serializedTransaction);
    assert.equal(decoded.chainId,10143);assert.equal(decoded.data,data);assert.equal(decoded.gas,transaction.gas);
    assert.equal((await recoverTransactionAddress({serializedTransaction})).toLowerCase(),account.address.toLowerCase());
    session.end();await assert.rejects(account.signTransaction(transaction),error=>error.code==='SESSION_ENDED');
  }finally{session.end();}
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
