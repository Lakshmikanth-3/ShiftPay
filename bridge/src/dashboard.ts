import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isAddress, isHex, verifyTypedData, keccak256, toBytes, type Address, type Hex } from 'viem';
import {monadTestnet} from 'viem/chains';
import {metronomeVaultAbi as abi} from './abi/metronomeVault.js';
import {HttpError,type Ctx} from './context.js';
import {queryPayrollEvents} from './envio.js';
import {requireServed,servedEmployer,employerWorkerIds} from './employers.js';
export const accessTypes={Access:[{name:'workerId',type:'uint256'},{name:'deadline',type:'uint64'},{name:'payloadHash',type:'bytes32'}]} as const;
const dataSchema=z.object({companyName:z.string().trim().min(1).max(100).optional(),employee:z.object({workerId:z.string().regex(/^[1-9]\d*$/),name:z.string().trim().min(1).max(100),role:z.string().trim().min(1).max(100),department:z.string().trim().min(1).max(100),notes:z.string().max(2000).optional()}).strict().optional()}).strict();
const requestSchema=z.object({address:z.string().refine(isAddress),employerId:z.string().regex(/^[1-9]\d*$/).optional(),workerId:z.string().regex(/^\d+$/),deadline:z.string().regex(/^\d+$/),signature:z.string().refine(isHex),data:dataSchema}).strict();
export function payloadHash(data:unknown){return keccak256(toBytes(JSON.stringify(data)));}
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
export function dashboardRoutes(app:FastifyInstance,ctx:Ctx){
  let scanLock:Promise<any>|null=null;
  let snapshot:any=null,snapshotAt=0,snapshotKey='',snapshotLock:Promise<any>|null=null,heldTax=0n;
  const cursorId=ctx.chain.vault.toLowerCase()+':'+ctx.cfg.employerId.toString();
  const tracked=['WorkerCreated','Withdrawn','TaxEscrowed','Funded'];
  async function rows(logs:any[]){
    const {parseEventLogs}=await import('viem');
    return parseEventLogs({abi,logs,strict:true}).filter((log:any)=>log.transactionHash&&log.logIndex!==null&&tracked.includes(log.eventName)).map((log:any)=>({
      id:log.transactionHash+':'+log.logIndex,blockNumber:log.blockNumber,logIndex:log.logIndex,eventName:log.eventName,
      workerId:log.args.workerId?.toString()??null,employerId:log.args.employerId?.toString()??null,
      amount:(log.args.amount??log.args.delta)?.toString()??null,hash:log.transactionHash}));
  }
  /**
   * Indexes vault logs into Postgres. Monad RPC limits eth_getLogs to 100 blocks, so ranges are fetched in
   * parallel within a time budget; the cursor persists so every serverless instance resumes where the last stopped.
   */
  async function scan(budgetMs=8000){
    if(ctx.cfg.vaultDeployBlock===undefined)throw new HttpError(503,'Configure VAULT_DEPLOY_BLOCK from the confirmed deployment receipt to index the workforce.','index_not_configured');
    if(scanLock)return scanLock;
    scanLock=(async()=>{
      const end=Date.now()+budgetMs;
      let cursor=await ctx.prisma.indexCursor.findUnique({where:{id:cursorId}})??{id:cursorId,nextBlock:ctx.cfg.vaultDeployBlock!,blockHash:null};
      const head=await ctx.chain.publicClient.getBlockNumber();const target=head-BigInt(ctx.cfg.confirmations-1);
      if(cursor.blockHash&&cursor.nextBlock>ctx.cfg.vaultDeployBlock!){
        const last=await ctx.chain.publicClient.getBlock({blockNumber:cursor.nextBlock-1n});
        if(last.hash!==cursor.blockHash){
          // Reorg: drop recent events and rescan a safe window.
          const from=cursor.nextBlock-500n>ctx.cfg.vaultDeployBlock!?cursor.nextBlock-500n:ctx.cfg.vaultDeployBlock!;
          await ctx.prisma.vaultEvent.deleteMany({where:{blockNumber:{gte:from}}});
          cursor={...cursor,nextBlock:from,blockHash:null};
        }
      }
      let next=cursor.nextBlock;
      while(next<=target&&Date.now()<end){
        let scannedNext:bigint,logs:any[]=[];
        if(ctx.cfg.eventSource==='envio'){
          // HyperSync serves large ranges in one request and reports how far it got (next_block).
          const to=next+2_000_000n>target?target:next+2_000_000n;
          const result=await queryPayrollEvents({chainId:ctx.cfg.chainId,token:ctx.cfg.envioToken??'',vault:ctx.chain.vault,fromBlock:next,toBlock:to});
          if(result.nextBlock===next)break; // Indexer is behind; never invent progress.
          for(const log of result.logs){const canonical=await ctx.chain.publicClient.getBlock({blockNumber:log.blockNumber!});if(canonical.hash!==log.blockHash)throw new HttpError(503,'Payroll events are awaiting canonical chain confirmation.','envio_reorg');}
          logs=result.logs;scannedNext=result.nextBlock;
        }else{
          // The public Monad RPC allows 25 requests/second; keep each paced batch well below that.
          const ranges:[bigint,bigint][]=[],started=Date.now();
          for(let from=next;from<=target&&ranges.length<8;from+=100n)ranges.push([from,from+99n>target?target:from+99n]);
          let results;
          try{results=await Promise.all(ranges.map(([fromBlock,toBlock])=>ctx.chain.publicClient.getLogs({address:ctx.chain.vault,fromBlock,toBlock})));}
          catch(err){ctx.log.warn({err:String(err).slice(0,200)},'vault log scan paused');break;}
          logs=results.flat();scannedNext=ranges[ranges.length-1][1]+1n;
          await wait(Math.max(0,700-(Date.now()-started)));
        }
        const data=await rows(logs);
        const blockHash=(await ctx.chain.publicClient.getBlock({blockNumber:scannedNext-1n})).hash!;
        await ctx.prisma.$transaction([
          ctx.prisma.vaultEvent.createMany({data,skipDuplicates:true}),
          ctx.prisma.indexCursor.upsert({where:{id:cursorId},create:{id:cursorId,nextBlock:scannedNext,blockHash},update:{nextBlock:scannedNext,blockHash}}),
        ]);
        next=scannedNext;
      }
      return {complete:next>target,indexedBlock:next-1n,targetBlock:target,source:ctx.cfg.eventSource==='envio'?'envio-hypersync':'rpc'};
    })().finally(()=>{scanLock=null;});
    return scanLock;
  }
  /** Workers created for this employer on chain, plus registered profiles (each verified on chain before display). */
  async function roster(employerId:bigint){
    const [created,profiles]=await Promise.all([
      ctx.prisma.vaultEvent.findMany({where:{eventName:'WorkerCreated',employerId:employerId.toString()},select:{workerId:true}}),
      ctx.prisma.workerProfile.findMany({select:{workerId:true}}),
    ]);
    return [...new Set([...created.map(r=>r.workerId!),...profiles.map(r=>r.workerId)])].sort((a,b)=>Number(BigInt(a)-BigInt(b)));
  }
  async function readSnapshots(workerIds:string[]){
    const block=await ctx.chain.publicClient.getBlock();
    const functions=['workers','earned','claimable','reclaimable','allocationRunway','owedBack'] as const;
    const calls=workerIds.flatMap(id=>functions.map(functionName=>({address:ctx.chain.vault,abi,functionName,args:[BigInt(id)]})));
    let results:readonly any[];
    if(ctx.cfg.chainId===10143){const address=monadTestnet.contracts.multicall3.address;if(!(await ctx.chain.publicClient.getCode({address})))throw new HttpError(503,'Verified batch-read contract is unavailable.','batch_unavailable');results=await ctx.chain.publicClient.multicall({contracts:calls as any,allowFailure:false,multicallAddress:address,blockNumber:block.number!});}
    else results=await Promise.all(calls.map(call=>ctx.chain.publicClient.readContract({...call,blockNumber:block.number!} as any)));
    return workerIds.map((id,index)=>{const [v,earned,claimable,remaining,runway,owedBack]=results.slice(index*6,index*6+6);return {workerId:id,worker:{ratePerHour:v[0],funded:v[1],withdrawn:v[2],netSettled:v[3],taxSettled:v[4],taxEscrowed:v[5],clockInAt:v[6],nonce:v[7],employerId:v[8],maxShiftSeconds:v[9],withholdingBps:v[10],flags:v[11],payoutAddr:v[12],openShiftId:v[13]},earned:{net:earned[0],tax:earned[1],openGross:earned[2]},claimable,remaining,runwaySeconds:runway,owedBack,readAt:block.timestamp,blockNumber:block.number};});
  }
  // Short-lived lookup cache: repeated address lookups cannot be used to exhaust RPC quota.
  const lookupCache=new Map<string,{at:number;value:unknown}>();

  /** Every worker id the index or profiles know about, across companies (each is re-checked on chain). */
  async function allWorkers(){
    const [created,profiles]=await Promise.all([
      ctx.prisma.vaultEvent.findMany({where:{eventName:'WorkerCreated'},select:{workerId:true}}),
      ctx.prisma.workerProfile.findMany({select:{workerId:true}}),
    ]);
    return [...new Set([...created.map(r=>r.workerId!),...profiles.map(r=>r.workerId)])].sort((a,b)=>Number(BigInt(b)-BigInt(a)));
  }

  /** Companies administered by an address and served by this payroll service (newest first). */
  app.get<{Params:{address:string}}>('/employers/by-admin/:address',async(req)=>{
    if(!isAddress(req.params.address))throw new HttpError(400,'Invalid address.','bad_request');
    const count=await ctx.chain.publicClient.readContract({address:ctx.chain.vault,abi,functionName:'employerCount'}) as bigint;
    const address=req.params.address.toLowerCase(),hit=lookupCache.get('e:'+address);if(hit&&Date.now()-hit.at<20_000)return hit.value;
    const ids:string[]=[];
    for(let id=count;id>=1n;id--){const e=await servedEmployer(ctx,id);if(e&&e.admin.toLowerCase()===address)ids.push(id.toString());}
    const value={employerIds:ids};lookupCache.set('e:'+address,{at:Date.now(),value});return value;
  });

  app.post('/dashboard',async(req)=>{
    const parsed=requestSchema.safeParse(req.body);if(!parsed.success)throw new HttpError(400,'Invalid dashboard authorization.','bad_request');
    const body=parsed.data,deadline=BigInt(body.deadline),workerId=BigInt(body.workerId);
    if(deadline<=ctx.now()||deadline>ctx.now()+600n)throw new HttpError(401,'Dashboard authorization expired. Connect again.','expired');
    // The company is named by the request; an employee's request resolves to the company that registered them.
    let employerId:bigint=body.employerId?BigInt(body.employerId):ctx.cfg.employerId;
    const employer=await requireServed(ctx,employerId);
    const admin=body.address.toLowerCase()===employer.admin.toLowerCase();
    if(!admin){if(workerId===0n)throw new HttpError(403,'Company account required.','forbidden');const worker=await ctx.chain.readWorker(workerId);if(!body.employerId)employerId=worker.employerId;if(worker.employerId!==employerId||!(await servedEmployer(ctx,worker.employerId))||worker.flags===0||worker.payoutAddr.toLowerCase()!==body.address.toLowerCase())throw new HttpError(403,'Registered employee account required.','forbidden');}
    const valid=await verifyTypedData({address:body.address as Address,domain:{name:'MetronomeAccess',version:'1',chainId:ctx.cfg.chainId,verifyingContract:ctx.chain.vault},types:accessTypes,primaryType:'Access',message:{workerId,deadline,payloadHash:payloadHash((req.body as {data:unknown}).data)},signature:body.signature as Hex});if(!valid)throw new HttpError(401,'Registered account signature required.','bad_signature');
    if(Object.keys(body.data).length&&!admin)throw new HttpError(403,'Only the company can edit HR details.','forbidden');
    if(body.data.employee){const worker=await ctx.chain.readWorker(BigInt(body.data.employee.workerId));if(worker.flags===0||worker.employerId!==employerId)throw new HttpError(403,'Register the employee on chain before saving HR details.','wrong_employer');}
    if(Object.keys(body.data).length){const signatureHash=keccak256(body.signature.toLowerCase() as Hex);await ctx.prisma.$transaction(async tx=>{const consumed=await tx.consumedAuthorization.findUnique({where:{id:signatureHash}});if(consumed)return;await tx.consumedAuthorization.create({data:{id:signatureHash,deadline}});if(body.data.companyName)await tx.companyProfile.upsert({where:{id:employerId.toString()},create:{id:employerId.toString(),name:body.data.companyName},update:{name:body.data.companyName}});if(body.data.employee){const profile=body.data.employee;await tx.workerProfile.upsert({where:{workerId:profile.workerId},create:profile,update:profile});}});}
    const progress=await scan();
    const ids=await roster(employerId),key=employerId+':'+ids.join(',');
    if(!snapshot||snapshotKey!==key||Date.now()-snapshotAt>5000){
      if(!snapshotLock)snapshotLock=readSnapshots(ids).then(async value=>{const blockNumber=value[0]?.blockNumber??await ctx.chain.publicClient.getBlockNumber();const contracts=Array.from({length:64},(_,shard)=>({address:ctx.chain.vault,abi,functionName:'withheld' as const,args:[employerId,BigInt(shard)] as const}));let amounts:readonly bigint[];if(ctx.cfg.chainId===10143)amounts=await ctx.chain.publicClient.multicall({contracts,allowFailure:false,multicallAddress:monadTestnet.contracts.multicall3.address,blockNumber});else amounts=await Promise.all(contracts.map(call=>ctx.chain.publicClient.readContract({...call,blockNumber})));heldTax=amounts.reduce((sum,amount)=>sum+amount,0n);snapshot=value.filter((w:any)=>w.worker.employerId===employerId&&w.worker.flags!==0);snapshotKey=key;snapshotAt=Date.now();return snapshot;}).finally(()=>{snapshotLock=null;});
      await snapshotLock;
    }
    const workers=(snapshot||[]).filter((w:any)=>admin||w.workerId===body.workerId);
    const visible=new Set(workers.map((w:any)=>w.workerId));
    const profiles=await ctx.prisma.workerProfile.findMany({where:{workerId:{in:[...visible] as string[]}}});
    const company=await ctx.prisma.companyProfile.findUnique({where:{id:employerId.toString()}});
    const events=await ctx.prisma.vaultEvent.findMany({where:{eventName:{in:['Withdrawn','TaxEscrowed','Funded']},workerId:{in:[...visible] as string[]}},orderBy:[{blockNumber:'desc'},{logIndex:'desc'}],take:500});
    const payments=events.map(e=>({id:e.id,workerId:e.workerId,type:e.eventName,amount:e.amount,hash:e.hash,blockNumber:e.blockNumber,status:'CONFIRMED'}));
    return {company,workers:workers.map((w:any)=>({...w,profile:profiles.find(p=>p.workerId===w.workerId)||null})),payments,progress,heldTax:admin?heldTax:undefined,readAt:workers[0]?.readAt??null};
  });
  /** Stateless recovery: the employee app finds its payroll from the passkey address alone. */
  app.get<{Params:{address:string}}>('/workers/by-address/:address',async(req)=>{
    if(!isAddress(req.params.address))throw new HttpError(400,'Invalid address.','bad_request');
    const address=req.params.address.toLowerCase(),hit=lookupCache.get('w:'+address);
    if(hit&&Date.now()-hit.at<20_000)return hit.value;
    await scan(4000).catch(()=>undefined);
    const ids=await allWorkers(),matches:string[]=[];
    // Active workers only, newest first: a suspended record never shadows a fresh registration.
    for(const id of ids){const w=await ctx.chain.readWorker(BigInt(id));if(w.flags===1&&w.payoutAddr.toLowerCase()===address&&await servedEmployer(ctx,w.employerId))matches.push(id);}
    const value={workerIds:matches.sort((a,b)=>Number(BigInt(b)-BigInt(a)))};lookupCache.set('w:'+address,{at:Date.now(),value});return value;
  });

  /**
   * Gas sponsorship: the employer's relayer tops up a registered employee's network-fee balance so a new
   * passkey account can send and settle immediately. Bounded per worker per day and only when nearly empty.
   */
  // Monad reserves gasLimit × maxFee up front: an Agora settlement needs ~0.05 MON of headroom on testnet.
  const grant=BigInt(process.env.GAS_GRANT_WEI||'200000000000000000'),floor=50_000_000_000_000_000n;
  app.post('/gas-grants',async(req)=>{
    const parsed=z.union([z.object({workerId:z.string().regex(/^[1-9]\d*$/)}).strict(),z.object({address:z.string().refine(isAddress)}).strict()]).safeParse(req.body);
    if(!parsed.success)throw new HttpError(400,'Invalid request.','bad_request');
    if(!ctx.transfer)throw new HttpError(503,'Gas sponsorship is unavailable.','no_sponsor');
    if('address' in parsed.data){
      // Onboarding grant: one small top-up per new address, capped per day across all addresses.
      const address=parsed.data.address as `0x${string}`,key='new:'+address.toLowerCase(),small=grant/2n; // 0.1 MON once
      if(await ctx.chain.publicClient.getBalance({address})>=floor)return {granted:false,reason:'sufficient'};
      if(await ctx.prisma.gasGrant.findFirst({where:{workerId:key}}))return {granted:false,reason:'already'};
      const today=await ctx.prisma.gasGrant.count({where:{workerId:{startsWith:'new:'},at:{gt:new Date(Date.now()-24*3600_000)}}});
      if(today>=Number(process.env.GAS_GRANT_DAILY||'15'))return {granted:false,reason:'daily_cap'};
      const hash=await ctx.transfer(0,address,small);
      await ctx.prisma.gasGrant.create({data:{workerId:key,address,amount:small.toString(),hash}});
      await ctx.chain.publicClient.waitForTransactionReceipt({hash,timeout:30_000}).catch(()=>undefined);
      return {granted:true,hash,amount:small.toString()};
    }
    const workerId=parsed.data.workerId,w=await ctx.chain.readWorker(BigInt(workerId));
    if(w.flags!==1||!(await servedEmployer(ctx,w.employerId)))throw new HttpError(403,'Active registered employee required.','forbidden');
    const balance=await ctx.chain.publicClient.getBalance({address:w.payoutAddr});
    if(balance>=floor)return {granted:false,reason:'sufficient'};
    const since=new Date(Date.now()-24*3600_000);
    const recent=await ctx.prisma.gasGrant.findFirst({where:{workerId,at:{gt:since}}});
    if(recent)return {granted:false,reason:'recent',hash:recent.hash};
    // Self-serve companies: at most 5 worker fee credits per day each, and 30 per day across all companies.
    if(w.employerId!==ctx.cfg.employerId){
      const ids=await employerWorkerIds(ctx,w.employerId);
      if(await ctx.prisma.gasGrant.count({where:{workerId:{in:ids},at:{gt:since}}})>=5)return {granted:false,reason:'daily_cap'};
    }
    if(await ctx.prisma.gasGrant.count({where:{NOT:{workerId:{startsWith:'new:'}},at:{gt:since}}})>=30)return {granted:false,reason:'daily_cap'};
    const hash=await ctx.transfer(Number(BigInt(workerId)%64n),w.payoutAddr,grant);
    await ctx.prisma.gasGrant.create({data:{workerId,address:w.payoutAddr,amount:grant.toString(),hash}});
    await ctx.chain.publicClient.waitForTransactionReceipt({hash,timeout:30_000}).catch(()=>undefined);
    return {granted:true,hash,amount:grant.toString()};
  });

  /**
   * Private payslip vaults: ciphertext encrypted on the employee's device with a key derived from a separate
   * Mera PRF salt. The id is derived from the same namespace, so only the passkey holder can locate or replace it.
   */
  const vaultId=z.string().regex(/^[0-9a-f]{64}$/);
  app.get<{Params:{id:string}}>('/vault/:id',async(req)=>{
    if(!vaultId.safeParse(req.params.id).success)throw new HttpError(400,'Invalid vault id.','bad_request');
    const row=await ctx.prisma.privateVault.findUnique({where:{id:req.params.id}});
    return row?{nonce:row.nonce,ciphertext:row.ciphertext,updatedAt:row.updatedAt}:{nonce:null,ciphertext:null};
  });
  app.post('/vault',async(req)=>{
    const parsed=z.object({id:vaultId,nonce:z.string().regex(/^[A-Za-z0-9_-]{16}$/),ciphertext:z.string().regex(/^[A-Za-z0-9_-]{24,40000}$/)}).strict().safeParse(req.body);
    if(!parsed.success)throw new HttpError(400,'Invalid encrypted record.','bad_request');
    const {id,nonce,ciphertext}=parsed.data;
    await ctx.prisma.privateVault.upsert({where:{id},create:{id,nonce,ciphertext},update:{nonce,ciphertext}});
    return {saved:true};
  });

}
