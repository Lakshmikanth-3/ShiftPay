import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveVault,sealPayslips,openPayslips,payslipSalt,PAYSLIP_NAMESPACE} from '../lib/private-payslips.mjs';

const prf=fill=>new Uint8Array(32).fill(fill);

test('the same passkey output re-derives the same vault id and key on any device',async()=>{
  const a=await deriveVault(prf(7)),b=await deriveVault(prf(7));
  assert.equal(a.id,b.id);assert.match(a.id,/^[0-9a-f]{64}$/);
  const sealed=await sealPayslips(a.key,[{period:'Oct 2026',net:'2.7'}]);
  assert.deepEqual(await openPayslips(b.key,sealed),[{period:'Oct 2026',net:'2.7'}]);
});

test('a different passkey output cannot locate or read the vault',async()=>{
  const a=await deriveVault(prf(7)),other=await deriveVault(prf(8));
  assert.notEqual(a.id,other.id);
  const sealed=await sealPayslips(a.key,[{net:'1'}]);
  await assert.rejects(openPayslips(other.key,sealed));
});

test('tampered ciphertext is rejected',async()=>{
  const a=await deriveVault(prf(3)),sealed=await sealPayslips(a.key,[{net:'1'}]);
  const flipped=sealed.ciphertext[0]==='A'?'B':'A';
  await assert.rejects(openPayslips(a.key,{...sealed,ciphertext:flipped+sealed.ciphertext.slice(1)}));
});

test('the payslip salt is its own namespace, not Mera\'s wallet salt',async()=>{
  const salt=await payslipSalt();assert.equal(salt.length,32);
  const wallet=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('mera.prf.salt.v1')));
  assert.notDeepEqual(salt,wallet);assert.equal(PAYSLIP_NAMESPACE,'shiftpay.payslips.v1');
});

test('sealed records match the storage format the server accepts',async()=>{
  const a=await deriveVault(prf(1)),sealed=await sealPayslips(a.key,[]);
  assert.match(sealed.nonce,/^[A-Za-z0-9_-]{16}$/);assert.match(sealed.ciphertext,/^[A-Za-z0-9_-]{24,40000}$/);
});
