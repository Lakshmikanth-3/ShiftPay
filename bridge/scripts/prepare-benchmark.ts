import 'dotenv/config';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createPublicClient,createWalletClient,defineChain,http,erc20Abi,isAddress,parseAbi,parseEther,type Address,type Hex,type Abi} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
const root=fileURLToPath(new URL('../../',import.meta.url));
const count=Number(process.env.BENCH_WORKERS || 32),key=process.env.BENCH_ADMIN_KEY;
const workerKeys=(process.env.BENCH_WORKER_KEYS || '').split(',').filter(Boolean);
if(!key||!process.env.ATTESTOR_PRIVATE_KEY||workerKeys.length!==count||!Number.isInteger(count)||count<1||count>1000)throw new Error('Set BENCH_ADMIN_KEY, ATTESTOR_PRIVATE_KEY and exactly BENCH_WORKERS distinct worker keys locally; nothing is generated');
const accounts=workerKeys.map(k=>privateKeyToAccount(k.trim() as Hex));
if(new Set(accounts.map(a=>a.address.toLowerCase())).size!==count)throw new Error('Worker payout wallets must be distinct');
const chain=defineChain({id:10143,name:'Monad testnet benchmark',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:{default:{http:[process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz/']}}});
const transport=http(),client=createPublicClient({chain,transport}),admin=createWalletClient({account:privateKeyToAccount(key as Hex),chain,transport});
const signer=privateKeyToAccount(process.env.ATTESTOR_PRIVATE_KEY as Hex),tax=process.env.TAX_ADDRESS as Address,token=process.env.AUSD_ADDRESS as Address;
if(!isAddress(token)||!isAddress(tax)||await client.getChainId()!==10143)throw new Error('Set a valid AUSD_ADDRESS/TAX_ADDRESS and Monad testnet RPC');
if(await client.readContract({address:token,abi:erc20Abi,functionName:'decimals'})!==6)throw new Error('Benchmark requires 6-decimal token units');
const total=BigInt(count)*240_000_000n;
// Self-contained setup: test AUSD from Agora's public faucet, and gas for each benchmark relayer lane from the admin.
const agoraFaucet='0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C' as Address;
if(await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[admin.account.address]})<2n*total){
  const {request}=await client.simulateContract({address:agoraFaucet,abi:parseAbi(['function requestFunds(address)']),functionName:'requestFunds',args:[admin.account.address],account:admin.account});
  const r=await client.waitForTransactionReceipt({hash:await admin.writeContract(request)});if(r.status!=='success')throw new Error('Agora faucet request failed');
}
const relayGas=parseEther(process.env.BENCH_RELAY_MON || '0.3');
for(const key of (process.env.RELAYER_PRIVATE_KEYS||'').split(',').filter(Boolean)){
  const relay=privateKeyToAccount(key.trim() as Hex);
  if(await client.getBalance({address:relay.address})<relayGas/2n){const r=await client.waitForTransactionReceipt({hash:await admin.sendTransaction({to:relay.address,value:relayGas})});if(r.status!=='success')throw new Error('Relayer funding failed');}
}
if(await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[admin.account.address]})<2n*total)throw new Error('Benchmark admin needs enough test tokens to fund both designs');
const artifact=(file:string,name:string)=>JSON.parse(readFileSync(join(root,'contracts/out',file,name+'.json'),'utf8'));
const records:object[]=[];
const output=join(root,'benchmark/fixtures',new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(output,{recursive:true});
async function wait(hash:Hex){const r=await client.waitForTransactionReceipt({hash});if(r.status!=='success')throw new Error('Fixture transaction reverted: '+hash);return r;}
async function write(address:Address,abi:Abi,functionName:string,args:unknown[]){const {request}=await client.simulateContract({address,abi,functionName,args,account:admin.account} as never);return wait(await admin.writeContract(request));}
try{
  for(const design of ['NaiveVault','MetronomeVault']){
    const art=artifact(design+'.sol',design);const deployed=await wait(await admin.deployContract({abi:art.abi,bytecode:art.bytecode.object,args:[token]}));const vault=deployed.contractAddress!;
    records.push({design,vault,deploymentHash:deployed.transactionHash,chainId:10143,token,employerId:1,admin:admin.account.address,attestor:signer.address,taxAddress:tax,workerPayouts:accounts.map(a=>a.address)});
    await write(vault,art.abi,'createEmployer',[signer.address,tax]);
    for(let i=0;i<count;i++)await write(vault,art.abi,'createWorker',[1n,BigInt(i+1),24_000_000n,2000,28800,accounts[i].address]);
    await write(token,erc20Abi,'approve',[vault,total]);await write(vault,art.abi,'fundWorkers',[1n,accounts.map((_,i)=>BigInt(i+1)),accounts.map(()=>240_000_000n)]);
    console.log('Prepared benchmark-only vault',design,vault);
  }
  const vaults=Object.fromEntries((records as {design:string;vault:string}[]).map(r=>[r.design,r.vault]));
  console.log(`BENCH_NAIVE_VAULT=${vaults.NaiveVault}
BENCH_SHARDED_VAULT=${vaults.MetronomeVault}`);
}finally{writeFileSync(join(output,'deployments.json'),JSON.stringify(records,null,2));console.log('Fixture deployment record:',output);}
