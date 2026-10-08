import {createPasskeyWithPrfOutput,getPasskeyPrfOutput,createSecp256k1SigningSession} from '@category-labs/mera';
import {toViemAccount} from '@category-labs/mera/viem';
import {HDKey} from '@scure/bip32';
import {entropyToMnemonic,mnemonicToSeedSync} from '@scure/bip39';
import {wordlist} from '@scure/bip39/wordlists/english.js';
import {createWalletClient,http,isAddress} from 'viem';
import {monadTestnet} from 'viem/chains';

export const meraStorageKey=host=>'shiftpay:mera:v1:'+host;
export function derivePayrollSession(prfOutput){
  if(!(prfOutput instanceof Uint8Array)||prfOutput.length!==32)throw new Error('Passkey did not return usable account material.');
  let seed,master,node,key;
  try{
    seed=mnemonicToSeedSync(entropyToMnemonic(prfOutput,wordlist));
    master=HDKey.fromMasterSeed(seed);node=master.derive("m/44'/60'/0'/0/0");key=node.privateKey;
    if(!key)throw new Error('Payroll account derivation failed.');
    const session=createSecp256k1SigningSession({privateKey:key});
    try{return {session,account:toViemAccount(session)};}catch(error){session.end();throw error;}
  }finally{key?.fill(0);node?.wipePrivateData();master?.wipePrivateData();seed?.fill(0);prfOutput.fill(0);}
}
export function readMeraMetadata(storage,host){
  const raw=storage.getItem(meraStorageKey(host));if(!raw)return null;
  const data=JSON.parse(raw);
  if(data.version!==1||data.rpId!==host||!isAddress(data.address)||typeof data.credentialId!=='string'||!data.credentialId)
    throw new Error('Saved passkey account metadata is invalid. Use the original payroll site to recover access.');
  return {version:1,rpId:host,address:data.address,credentialId:data.credentialId,
    ...(Array.isArray(data.transports)&&data.transports.every(t=>typeof t==='string')?{transports:data.transports}:{})};
}
export async function openPayrollPasskey({create=false,name}){
  if(!window.isSecureContext||!navigator.credentials)throw new Error('Passkeys require HTTPS or localhost and a supported browser.');
  const host=location.hostname,stored=readMeraMetadata(localStorage,host);
  if(create&&stored)throw new Error('This site already has a payroll passkey. Unlock it to keep the same account.');
  if(create&&!name?.trim())throw new Error('Enter the company name before creating its payroll passkey.');
  const output=create?await createPasskeyWithPrfOutput({rp:{id:host,name:'ShiftPay'},user:{name:name.trim(),displayName:name.trim()}}):
    await getPasskeyPrfOutput({rpId:host,credential:stored?{credentialId:stored.credentialId,transports:stored.transports}:undefined});
  const {session,account}=derivePayrollSession(output.prfOutput);
  try{
    if(stored&&stored.address.toLowerCase()!==account.address.toLowerCase())throw new Error('This passkey does not match the saved payroll account.');
    const metadata={version:1,rpId:host,address:account.address,credentialId:output.credentialId,
      ...(output.transports?{transports:output.transports}:stored?.transports?{transports:stored.transports}:{})};
    localStorage.setItem(meraStorageKey(host),JSON.stringify(metadata));
    const base=createWalletClient({account,chain:monadTestnet,transport:http('https://testnet-rpc.monad.xyz/')});
    // Contract simulations contain JSON-RPC account addresses. Retain the local
    // Mera signer when passing those requests to viem; never send unsigned writes.
    const client={...base,
      writeContract:request=>base.writeContract({...request,account}),
      deployContract:request=>base.deployContract({...request,account}),
      sendTransaction:request=>base.sendTransaction({...request,account}),
    };
    return {address:account.address,walletClientType:'mera',session,client,
      end:()=>session.end()};
  }catch(error){session.end();throw error;}
}
