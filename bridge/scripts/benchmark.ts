import 'dotenv/config';
import {spawn, execFileSync} from 'node:child_process';
import {readFileSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPublicClient, createWalletClient, createTestClient, defineChain, http, type Address, type Hex, type Abi} from 'viem';
import {mnemonicToAccount, privateKeyToAccount} from 'viem/accounts';
import {metronomeVaultAbi as abi} from '../src/abi/metronomeVault.js';
import {types, vaultDomain} from '../src/attestor.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
const count=Number(process.env.BENCH_WORKERS || 32), concurrency=Number(process.env.BENCH_CONCURRENCY || 4);
if(!Number.isInteger(count)||count<1||count>1000||!Number.isInteger(concurrency)||concurrency<1||concurrency>64)throw new Error('Workers must be 1–1000 and concurrency 1–64');
const external=process.env.BENCH_MODE==='testnet';
const workerKeys=(process.env.BENCH_WORKER_KEYS || '').split(',').filter(Boolean);
if(external&&workerKeys.length!==count)throw new Error('Set exactly BENCH_WORKERS worker signing keys locally for the prepared testnet fixtures');
const workerAccounts=Array.from({length:count},(_,i)=>external?privateKeyToAccount(workerKeys[i]?.trim() as Hex):mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex:101+i}));
const duration=BigInt(process.env.BENCH_SHIFT_SECONDS || 60),withdrawAmount=100000n;
if(duration<60n||duration>3600n)throw new Error('Benchmark shifts must be 60–3600 seconds');
const rpc=external?process.env.MONAD_RPC_URL:'http://127.0.0.1:18545';
if(!rpc)throw new Error('MONAD_RPC_URL required');
const chain=defineChain({id:external?Number(process.env.MONAD_CHAIN_ID):31337,name:external?'Monad benchmark':'Local benchmark',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:{default:{http:[rpc]}}});
const transport=http(rpc),client=createPublicClient({chain,transport});
const localAccount=(i:number)=>mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex:i});
const adminAccount=external?privateKeyToAccount(process.env.BENCH_ADMIN_KEY as Hex):localAccount(0);
const signer=external?privateKeyToAccount(process.env.ATTESTOR_PRIVATE_KEY as Hex):localAccount(1);
const relayAccounts=external?(process.env.RELAYER_PRIVATE_KEYS || '').split(',').filter(Boolean).map(k=>privateKeyToAccount(k.trim() as Hex)):Array.from({length:concurrency},(_,i)=>localAccount(i+2));
if(relayAccounts.length<concurrency)throw new Error('Provide at least BENCH_CONCURRENCY distinct funded relayer keys');
if(new Set(relayAccounts.map(a=>a.address)).size!==relayAccounts.length)throw new Error('Relayers must have distinct addresses');
const relays=relayAccounts.slice(0,concurrency).map(account=>createWalletClient({account,chain,transport}));
const admin=createWalletClient({account:adminAccount,chain,transport});
let anvil:ReturnType<typeof spawn>|undefined;
const artifacts=(file:string,name:string)=>JSON.parse(readFileSync(join(root,'contracts/out',file,name+'.json'),'utf8'));
const binary=(name:string)=>{
  const full=join(process.env.USERPROFILE || '', '.foundry','bin',name+(process.platform==='win32'?'.exe':''));
  return existsSync(full)?full:name;
};
async function receipt(hash:Hex){const r=await client.waitForTransactionReceipt({hash,timeout:120000,pollingInterval:100});if(r.status!=='success')throw new Error(`Reverted ${hash}`);return r;}
async function adminWrite(address:Address, contractAbi:Abi, functionName:string,args:unknown[]){return receipt(await admin.writeContract({address,abi:contractAbi,functionName,args} as never));}
type Raw={design:string;stage:string;workerId:number;hash?:Hex;submittedAt:string;latencyMs:number;gasUsed?:string;block?:string;status:string;error?:string};
const raw:Raw[]=[],summary:object[]=[];
const results=join(root,'benchmark/results',new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(results,{recursive:true});
async function prepare(name:string,token:Address){
  const art=artifacts(name+'.sol',name);
  const deployed=await receipt(await admin.deployContract({abi:art.abi,bytecode:art.bytecode.object,args:[token]}));
  const vault=deployed.contractAddress!;
  await adminWrite(vault,abi,'createEmployer',[signer.address,localAccount(1001).address]);
  const tokenAbi=artifacts('MockERC20.sol','MockERC20').abi;
  await adminWrite(token,tokenAbi,'mint',[adminAccount.address,BigInt(count)*240_000_000n]);
  for(let i=1;i<=count;i++)await adminWrite(vault,abi,'createWorker',[1n,BigInt(i),24_000_000n,2000,28800,localAccount(100+i).address]);
  await adminWrite(token,tokenAbi,'approve',[vault,BigInt(count)*240_000_000n]);
  await adminWrite(vault,abi,'fundWorkers',[1n,Array.from({length:count},(_,i)=>BigInt(i+1)),Array(count).fill(240_000_000n)]);
  return vault;
}
async function run(vault:Address,design:string){
  const ids=Array.from({length:count},(_,i)=>BigInt(i+1));
  const employer=await client.readContract({address:vault,abi,functionName:'employers',args:[1n]});
  if(employer[1].toLowerCase()!==signer.address.toLowerCase())throw new Error('Benchmark attestor is not registered as employer 1');
  for(const id of ids){
    const w=await client.readContract({address:vault,abi,functionName:'workers',args:[id]});
    if(w[0]!==24_000_000n||w[1]!==240_000_000n||w[2]!==0n||w[3]!==0n||w[4]!==0n||w[6]!==0n||w[7]!==0n||w[8]!==1n||w[9]!==28800||w[10]!==2000||w[11]!==1||w[12].toLowerCase()!==workerAccounts[Number(id)-1].address.toLowerCase())throw new Error(`Prepare equivalent fresh worker ${id} on ${design} before benchmarking`);
  }
  const start=(await client.getBlock()).timestamp,deadline=start+86400n,domain=vaultDomain(chain.id,vault);
  const shiftId=(id:bigint)=>BigInt(Date.now())*10000n+id;
  const shifts=ids.map(shiftId);
  async function stage(stageName:string,build:(id:bigint,index:number)=>Promise<{functionName:string;args:unknown[]}>){
    const jobs=await Promise.all(ids.map(build));
    const started=performance.now();
    await Promise.all(relays.map(async(relay,lane)=>{
      for(let i=lane;i<jobs.length;i+=concurrency){
        const at=performance.now(),submittedAt=new Date().toISOString();let hash:Hex|undefined;
        try{
          hash=await relay.writeContract({address:vault,abi,functionName:jobs[i].functionName,args:jobs[i].args,gas:800000n} as never);
          const r=await client.waitForTransactionReceipt({hash,timeout:120000,pollingInterval:100});
          raw.push({design,stage:stageName,workerId:i+1,hash,submittedAt,latencyMs:performance.now()-at,gasUsed:r.gasUsed.toString(),block:r.blockNumber.toString(),status:r.status});
        }catch(e){raw.push({design,stage:stageName,workerId:i+1,hash,submittedAt,latencyMs:performance.now()-at,status:'error',error:String(e)});}
      }
    }));
    const elapsedMs=performance.now()-started,rows=raw.filter(r=>r.design===design&&r.stage===stageName),ok=rows.filter(r=>r.status==='success'),times=ok.map(r=>r.latencyMs).sort((a,b)=>a-b);
    summary.push({design,stage:stageName,workers:count,concurrency,elapsedMs,confirmed:ok.length,failures:count-ok.length,confirmedPerSecond:ok.length/(elapsedMs/1000),p50Ms:times[Math.floor(times.length*.5)]||null,p95Ms:times[Math.min(times.length-1,Math.floor(times.length*.95))]||null,totalGas:ok.reduce((n,r)=>n+BigInt(r.gasUsed!),0n).toString()});
    if(ok.length!==count)throw new Error(`${design} ${stageName} has failed transactions; raw results retained`);
  }
  await stage('open',async(id,i)=>({functionName:'openShift',args:[id,shifts[i],start,deadline,await signer.signTypedData({domain,types,primaryType:'OpenShift',message:{workerId:id,shiftId:shifts[i],startAt:start,deadline}})]}));
  if(external){while((await client.getBlock()).timestamp<start+duration)await new Promise(r=>setTimeout(r,1000));}
  else{const test=createTestClient({chain,transport,mode:'anvil'});const now=(await client.getBlock()).timestamp;if(now<start+duration)await test.setNextBlockTimestamp({timestamp:start+duration});await test.mine({blocks:1});}
  await stage('close',async(id,i)=>({functionName:'closeShift',args:[id,start,start+duration,24_000_000n,shifts[i],deadline,await signer.signTypedData({domain,types,primaryType:'Shift',message:{workerId:id,startAt:start,endAt:start+duration,ratePerHour:24_000_000n,shiftId:shifts[i],deadline}})]}));
  await stage('withdraw',async(id)=>({functionName:'withdrawWithSig',args:[id,withdrawAmount,deadline,await workerAccounts[Number(id)-1].signTypedData({domain,types,primaryType:'Withdraw',message:{workerId:id,amount:withdrawAmount,nonce:0n,deadline}})]}));
  for(const id of ids){
    const w=await client.readContract({address:vault,abi,functionName:'workers',args:[id]});
    const gross=24_000_000n*duration/3600n,tax=gross*2000n/10000n;
    if(w[2]!==withdrawAmount||w[3]!==gross-tax||w[4]!==tax)throw new Error(`Accounting mismatch ${design} worker ${id}`);
  }
}
try{
  let naive:Address,sharded:Address;
  if(external){
    if(chain.id!==10143||await client.getChainId()!==chain.id)throw new Error('Testnet benchmark requires chain 10143');
    naive=process.env.BENCH_NAIVE_VAULT as Address;sharded=process.env.BENCH_SHARDED_VAULT as Address;
    if(!naive||!sharded||naive.toLowerCase()===sharded.toLowerCase())throw new Error('Provide distinct prepared benchmark vault addresses');
    const tokens=await Promise.all([naive,sharded].map(address=>client.readContract({address,abi,functionName:'token'})));
    if(tokens[0].toLowerCase()!==tokens[1].toLowerCase())throw new Error('Benchmark vaults must use the same settlement token');
  }else{
  execFileSync(binary('forge'),['build'],{cwd:join(root,'contracts'),stdio:'inherit'});
  anvil=spawn(binary('anvil'),['--port','18545','--silent','--accounts',String(count+1100)],{stdio:'ignore',windowsHide:true});
  anvil.on('error',e=>console.error(e));
  let connected=false;
  for(let i=0;i<100;i++){try{await client.getChainId();connected=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
  if(!connected||anvil.exitCode!==null||await client.getChainId()!==31337)throw new Error('Could not start isolated local anvil on port 18545');
  const tokenArt=artifacts('MockERC20.sol','MockERC20');
  const token=(await receipt(await admin.deployContract({abi:tokenArt.abi,bytecode:tokenArt.bytecode.object}))).contractAddress!;
  naive=await prepare('NaiveVault',token);sharded=await prepare('MetronomeVault',token);
  }
  // Alternate order on successive invocations; raw metadata records the order.
  const order=Date.now()%2?[[naive,'naive'],[sharded,'sharded']]:[[sharded,'sharded'],[naive,'naive']];
  for(const [vault,design] of order)await run(vault as Address,design);
  writeFileSync(join(results,'environment.json'),JSON.stringify({chainId:chain.id,rpc,local:!external,workers:count,concurrency,duration:duration.toString(),order:order.map(x=>x[1]),node:process.version,clientVersion:await client.request({method:'web3_clientVersion'}),limitations:external?'Public testnet results depend on RPC limits, block capacity and unrelated traffic. Repeat in alternating order.':'Anvil is sequential. These results validate the harness and accounting, not Monad parallel execution or production throughput.'},null,2));
}finally{
  writeFileSync(join(results,'raw.json'),JSON.stringify(raw,null,2));writeFileSync(join(results,'summary.json'),JSON.stringify(summary,null,2));
  const columns=['design','stage','workerId','hash','submittedAt','latencyMs','gasUsed','block','status','error'];
  writeFileSync(join(results,'raw.csv'),columns.join(',')+'\n'+raw.map(row=>columns.map(key=>JSON.stringify(String(row[key as keyof Raw]??''))).join(',')).join('\n'));
  const bars=(summary as {design:string;stage:string;p95Ms:number}[]).map((r,i)=>`<text x="10" y="${45+i*42}">${r.design} ${r.stage}</text><rect x="170" y="${25+i*42}" width="${Math.min(650,r.p95Ms/5)}" height="25" fill="${r.design==='sharded'?'#203b2e':'#8eaa65'}"/><text x="830" y="${45+i*42}">${r.p95Ms?.toFixed(0)} ms</text>`).join('');
  writeFileSync(join(results,'latency.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="320"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" font-size="14">${bars}<text x="10" y="310">${external?'Monad testnet':'Local Anvil (not Monad performance)'} p95 confirmation latency. Scale: 5 ms per pixel.</text></g></svg>`);
  anvil?.kill();console.log('Benchmark artifacts:',results);
}
