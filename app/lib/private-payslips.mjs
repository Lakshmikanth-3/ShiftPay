// Private payslips: non-wallet use of Mera PRF key material.
// A separate PRF salt namespace yields an unrelated 32-byte secret from the same passkey. From it, HKDF derives
// an AES-256-GCM key and an opaque storage id. Nothing secret is persisted: any device holding the passkey
// re-derives both, and the server only ever stores ciphertext it cannot read or link to a wallet address.
const enc=new TextEncoder(),dec=new TextDecoder();
const subtle=()=>globalThis.crypto.subtle;
const b64u=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64u=text=>Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-text.length%4)%4)),c=>c.charCodeAt(0));
const hex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');

export const PAYSLIP_NAMESPACE='shiftpay.payslips.v1';
export async function payslipSalt(){return new Uint8Array(await subtle().digest('SHA-256',enc.encode(PAYSLIP_NAMESPACE)));}

/** Derives the vault's encryption key and storage id from a 32-byte PRF output (wiped by the caller). */
export async function deriveVault(prfOutput){
  if(!(prfOutput instanceof Uint8Array)||prfOutput.length!==32)throw new Error('Passkey did not return usable key material.');
  const base=await subtle().importKey('raw',prfOutput,'HKDF',false,['deriveKey','deriveBits']);
  const salt=enc.encode(PAYSLIP_NAMESPACE);
  const key=await subtle().deriveKey({name:'HKDF',hash:'SHA-256',salt,info:enc.encode('shiftpay.payslips.encrypt.v1')},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const id=hex(new Uint8Array(await subtle().deriveBits({name:'HKDF',hash:'SHA-256',salt,info:enc.encode('shiftpay.payslips.id.v1')},base,256)));
  return {key,id};
}

export async function sealPayslips(key,payslips){
  const nonce=globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=new Uint8Array(await subtle().encrypt({name:'AES-GCM',iv:nonce},key,enc.encode(JSON.stringify({v:1,payslips}))));
  return {nonce:b64u(nonce),ciphertext:b64u(ciphertext)};
}

export async function openPayslips(key,record){
  if(!record?.ciphertext)return [];
  const plain=await subtle().decrypt({name:'AES-GCM',iv:unb64u(record.nonce)},key,unb64u(record.ciphertext));
  const data=JSON.parse(dec.decode(plain));
  if(data.v!==1||!Array.isArray(data.payslips))throw new Error('Unsupported payslip vault.');
  return data.payslips;
}

/** One passkey prompt: evaluates the payslip salt (never the wallet salt) and returns the derived vault handle. */
export async function unlockPayslipVault(){
  const {getPasskeyPrfOutput}=await import('@category-labs/mera');
  const {readMeraMetadata}=await import('./mera.mjs');
  const stored=readMeraMetadata(localStorage,location.hostname);
  const {prfOutput}=await getPasskeyPrfOutput({rpId:location.hostname,prfSalt:await payslipSalt(),credential:stored?{credentialId:stored.credentialId,transports:stored.transports}:undefined});
  try{return await deriveVault(prfOutput);}finally{prfOutput.fill(0);}
}
