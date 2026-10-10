// Isolated local-chain demo. Public Anvil development accounts never reach a public RPC.
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PrismaClient} from '@prisma/client';
import {mnemonicToAccount} from 'viem/accounts';
import {createWalletClient,http,toHex,type Hex,type Address,type Abi} from 'viem';
import {makeChain} from '../src/chain.js';
import {makeAttestor} from '../src/attestor.js';
import {loadConfig} from '../src/config.js';
import {buildApp} from '../src/app.js';
import {Submitter} from '../src/submitter.js';
import {handleClockEvent} from '../src/services/clock.js';
import {wallClock,type Ctx} from '../src/context.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
const bin=(name:string)=>{const full=join(process.env.USERPROFILE || '', '.foundry','bin',name+(process.platform==='win32'?'.exe':''));return existsSync(full)?full:name;};
const account=(i:number)=>mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex:i});
const key=(i:number)=>toHex(account(i).getHdKey().privateKey!) as Hex;
const rpc='http://127.0.0.1:18546';
const db=`postgresql://metronome:metronome@127.0.0.1:5433/metronome?schema=shiftpay_demo_${Date.now()}`;
execFileSync(bin('forge'),['build','--quiet'],{cwd:join(root,'contracts'),stdio:'inherit'});
const anvil=spawn(bin('anvil'),['--port','18546','--block-time','1','--silent'],{stdio:'ignore',windowsHide:true});
let app:ReturnType<typeof buildApp>|undefined,prisma:PrismaClient|undefined,submitter:Submitter|undefined;
async function shutdown(){await app?.close();await submitter?.stop();await prisma?.$disconnect();anvil.kill();}
process.on('SIGINT',()=>shutdown().then(()=>process.exit(0)));process.on('SIGTERM',()=>shutdown().then(()=>process.exit(0)));
try{
  const cfg=loadConfig({DATABASE_URL:db,MONAD_RPC_URL:rpc,MONAD_CHAIN_ID:'31337',VAULT_ADDRESS:'0x0000000000000000000000000000000000000001',EMPLOYER_ID:'1',ATTESTOR_PRIVATE_KEY:key(1),RELAYER_PRIVATE_KEYS:key(3),WEBHOOK_SECRET:'local-demo-only-not-for-public-networks',ADMIN_API_TOKEN:'local-demo-only-not-for-public-admin-use',PORT:'8787'});
  let chain=makeChain(cfg),connected=false;
  for(let i=0;i<100;i++){try{await chain.publicClient.getChainId();connected=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
  if(!connected||anvil.exitCode!==null||await chain.publicClient.getChainId()!==31337)throw new Error('Could not start isolated local chain on port 18546');
  const admin=createWalletClient({account:account(0),chain:chain.chain,transport:http(rpc)});
  const artifact=(file:string,name:string)=>JSON.parse(readFileSync(join(root,'contracts/out',file,name+'.json'),'utf8'));
  const wait=async(hash:Hex)=>{const r=await chain.publicClient.waitForTransactionReceipt({hash,pollingInterval:100});if(r.status!=='success')throw new Error('Local fixture transaction reverted');return r;};
  const tokenArt=artifact('MockERC20.sol','MockERC20'),vaultArt=artifact('MetronomeVault.sol','MetronomeVault');
  const token=(await wait(await admin.deployContract({abi:tokenArt.abi,bytecode:tokenArt.bytecode.object}))).contractAddress!;
  cfg.vault=(await wait(await admin.deployContract({abi:vaultArt.abi,bytecode:vaultArt.bytecode.object,args:[token]}))).contractAddress!;
  chain=makeChain(cfg);
  const write=async(address:Address,abi:Abi,functionName:string,args:unknown[])=>wait(await admin.writeContract({address,abi,functionName,args} as never));
  await write(cfg.vault,vaultArt.abi,'createEmployer',[account(1).address,account(4).address]);
  await write(cfg.vault,vaultArt.abi,'createWorker',[1n,7n,24_000_000n,2000,28800,account(2).address]);
  await write(token,tokenArt.abi,'mint',[account(0).address,240_000_000n]);
  await write(token,tokenArt.abi,'approve',[cfg.vault,240_000_000n]);
  await write(cfg.vault,vaultArt.abi,'fundWorkers',[1n,[7n],[240_000_000n]]);
  // Prisma owns only this fresh demo schema. Previous schemas are preserved for inspection.
  process.env.DATABASE_URL=db;
  const prismaCLI=join(root,'bridge/node_modules/prisma/build/index.js');
  execFileSync(process.execPath,[prismaCLI,'db','push','--skip-generate'],{cwd:join(root,'bridge'),env:process.env,stdio:'inherit'});
  prisma=new PrismaClient({datasources:{db:{url:db}}});
  const log={info:(data:object,msg='')=>console.log(msg,JSON.stringify(data)),warn:(data:object,msg='')=>console.warn(msg,JSON.stringify(data)),error:(data:object,msg='')=>console.error(msg,JSON.stringify(data))};
  const ctx:Ctx={cfg,chain,prisma,attestor:makeAttestor(cfg.attestorKey,31337,cfg.vault),now:wallClock,kick:()=>{},log};
  submitter=new Submitter(ctx);ctx.kick=submitter.kick;await submitter.start();
  await handleClockEvent(ctx,{workerId:7n,type:'CLOCK_IN',idempotencyKey:'local-demo-open',at:wallClock()-7200n});
  app=buildApp(ctx);await app.listen({port:8787,host:'127.0.0.1'});
  console.log('LOCAL TEST PAYROLL ONLY. Chain 31337, mock mAUSD; no Monad deployment.');
  console.log('Bridge http://127.0.0.1:8787; worker 7; employer',account(0).address,'worker payout',account(2).address);
  console.log('Start app with NEXT_PUBLIC_CHAIN_ID=31337 and NEXT_PUBLIC_RPC_URL=http://127.0.0.1:18546.');
}catch(e){await shutdown();throw e;}
