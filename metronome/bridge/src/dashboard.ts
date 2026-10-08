import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isAddress, isHex, verifyTypedData, keccak256, toBytes, type Address, type Hex } from 'viem';
import {monadTestnet} from 'viem/chains';
import {metronomeVaultAbi as abi} from './abi/metronomeVault.js';
import {HttpError,type Ctx} from './context.js';
import {queryPayrollEvents} from './envio.js';
export const accessTypes={Access:[{name:'workerId',type:'uint256'},{name:'deadline',type:'uint64'},{name:'payloadHash',type:'bytes32'}]} as const;
const dataSchema=z.object({companyName:z.string().trim().min(1).max(100).optional(),employee:z.object({workerId:z.string().regex(/^[1-9]\d*$/),name:z.string().trim().min(1).max(100),role:z.string().trim().min(1).max(100),department:z.string().trim().min(1).max(100),notes:z.string().max(2000).optional()}).strict().optional()}).strict();
const requestSchema=z.object({address:z.string().refine(isAddress),workerId:z.string().regex(/^\d+$/),deadline:z.string().regex(/^\d+$/),signature:z.string().refine(isHex),data:dataSchema}).strict();
export function payloadHash(data:unknown){return keccak256(toBytes(JSON.stringify(data)));}
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
export function dashboardRoutes(app:FastifyInstance,ctx:Ctx){
  let next:bigint=ctx.cfg.vaultDeployBlock??0n, scanLock=false, indexedHash:Hex|undefined;
  const events=new Map<string,any>(),ids=new Set<string>();
  let snapshot:any=null,snapshotAt=0,snapshotLock:Promise<any>|null=null,heldTax=0n;
  async function scan(){
    if(ctx.cfg.vaultDeployBlock===undefined)throw new HttpError(503,'Configure VAULT_DEPLOY_BLOCK from the confirmed deployment receipt to index the workforce.','index_not_configured');
    if(scanLock)return {complete:false};scanLock=true;
    try{
      const head=await ctx.chain.publicClient.getBlockNumber();const target=head-BigInt(ctx.cfg.confirmations-1);
      if(indexedHash&&next>ctx.cfg.vaultDeployBlock!){const last=await ctx.chain.publicClient.getBlock({blockNumber:next-1n});if(last.hash!==indexedHash){next=ctx.cfg.vaultDeployBlock;events.clear();ids.clear();snapshot=null;}}
      let loops=0;
      while(next<=target&&loops++<8){
        const end=next+99n>target?target:next+99n;
        let scannedNext=end+1n;
        let logs;
        if(ctx.cfg.eventSource==='envio'){
          const result=await queryPayrollEvents({chainId:ctx.cfg.chainId,token:ctx.cfg.envioToken??'',vault:ctx.chain.vault,fromBlock:next,toBlock:end});
          logs=result.logs;scannedNext=result.nextBlock;
          if(scannedNext===next)break; // Indexer is behind; never invent progress.
          const blocks=new Map<string,Hex>();
          for(const log of logs){const number=log.blockNumber!.toString(),hash=log.blockHash!;
            if(blocks.has(number)&&blocks.get(number)!==hash)throw new HttpError(503,'Payroll indexer returned conflicting block hashes.','envio_reorg');
            blocks.set(number,hash);
          }
          for(const [number,hash] of blocks){
            const canonical=await ctx.chain.publicClient.getBlock({blockNumber:BigInt(number)});
            if(canonical.hash!==hash)throw new HttpError(503,'Payroll events are awaiting canonical chain confirmation.','envio_reorg');
          }
        }else logs=await ctx.chain.publicClient.getLogs({address:ctx.chain.vault,fromBlock:next,toBlock:end});
        const {parseEventLogs}=await import('viem');
        for(const log of parseEventLogs({abi,logs,strict:true})){if(!log.transactionHash||log.logIndex===null)continue;events.set(log.transactionHash+':'+log.logIndex,log);if(log.eventName==='WorkerCreated'&&log.args.employerId===ctx.cfg.employerId)ids.add(log.args.workerId.toString());}
        indexedHash=(await ctx.chain.publicClient.getBlock({blockNumber:scannedNext-1n})).hash!;next=scannedNext;await wait(60);
      }
      return {complete:next>target,indexedBlock:next-1n,targetBlock:target};
    }finally{scanLock=false;}
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
  app.post('/dashboard',async(req)=>{
    const parsed=requestSchema.safeParse(req.body);if(!parsed.success)throw new HttpError(400,'Invalid dashboard authorization.','bad_request');
    const body=parsed.data,deadline=BigInt(body.deadline),workerId=BigInt(body.workerId);
    if(deadline<=ctx.now()||deadline>ctx.now()+600n)throw new HttpError(401,'Dashboard authorization expired. Connect again.','expired');
    const employer=await ctx.chain.publicClient.readContract({address:ctx.chain.vault,abi,functionName:'employers',args:[ctx.cfg.employerId]});
    const admin=body.address.toLowerCase()===employer[0].toLowerCase();
    if(!admin){if(workerId===0n)throw new HttpError(403,'Company account required.','forbidden');const worker=await ctx.chain.readWorker(workerId);if(worker.employerId!==ctx.cfg.employerId||worker.flags===0||worker.payoutAddr.toLowerCase()!==body.address.toLowerCase())throw new HttpError(403,'Registered employee account required.','forbidden');}
    const valid=await verifyTypedData({address:body.address as Address,domain:{name:'MetronomeAccess',version:'1',chainId:ctx.cfg.chainId,verifyingContract:ctx.chain.vault},types:accessTypes,primaryType:'Access',message:{workerId,deadline,payloadHash:payloadHash((req.body as {data:unknown}).data)},signature:body.signature as Hex});if(!valid)throw new HttpError(401,'Registered account signature required.','bad_signature');
    if(Object.keys(body.data).length&&!admin)throw new HttpError(403,'Only the company can edit HR details.','forbidden');
    if(body.data.employee){const worker=await ctx.chain.readWorker(BigInt(body.data.employee.workerId));if(worker.flags===0||worker.employerId!==ctx.cfg.employerId)throw new HttpError(403,'Register the employee on chain before saving HR details.','wrong_employer');}
    if(Object.keys(body.data).length){const signatureHash=keccak256(body.signature.toLowerCase() as Hex);await ctx.prisma.$transaction(async tx=>{const consumed=await tx.consumedAuthorization.findUnique({where:{id:signatureHash}});if(consumed)return;await tx.consumedAuthorization.create({data:{id:signatureHash,deadline}});if(body.data.companyName)await tx.companyProfile.upsert({where:{id:ctx.cfg.employerId.toString()},create:{id:ctx.cfg.employerId.toString(),name:body.data.companyName},update:{name:body.data.companyName}});if(body.data.employee){const profile=body.data.employee;await tx.workerProfile.upsert({where:{workerId:profile.workerId},create:profile,update:profile});}});}
    const progress=await scan();
    if(progress.complete&&(!snapshot||Date.now()-snapshotAt>5000)){
      if(!snapshotLock)snapshotLock=readSnapshots([...ids]).then(async value=>{const blockNumber=value[0]?.blockNumber??await ctx.chain.publicClient.getBlockNumber();const contracts=Array.from({length:64},(_,shard)=>({address:ctx.chain.vault,abi,functionName:'withheld' as const,args:[ctx.cfg.employerId,BigInt(shard)] as const}));let amounts:readonly bigint[];if(ctx.cfg.chainId===10143)amounts=await ctx.chain.publicClient.multicall({contracts,allowFailure:false,multicallAddress:monadTestnet.contracts.multicall3.address,blockNumber});else amounts=await Promise.all(contracts.map(call=>ctx.chain.publicClient.readContract({...call,blockNumber})));heldTax=amounts.reduce((sum,amount)=>sum+amount,0n);snapshot=value;snapshotAt=Date.now();return value;}).finally(()=>{snapshotLock=null;});
      await snapshotLock;
    }
    const workers=(snapshot||[]).filter((w:any)=>admin||w.workerId===body.workerId);
    const profiles=await ctx.prisma.workerProfile.findMany({where:{workerId:{in:workers.map((w:any)=>w.workerId)}}});
    const company=await ctx.prisma.companyProfile.findUnique({where:{id:ctx.cfg.employerId.toString()}});
    const payments=[...events.values()].filter(log=>['Withdrawn','TaxEscrowed','Funded'].includes(log.eventName)&&ids.has(log.args.workerId?.toString())&&(admin||log.args.workerId.toString()===body.workerId)).sort((a,b)=>Number(b.blockNumber-a.blockNumber)||b.logIndex-a.logIndex).map(log=>({id:log.transactionHash+':'+log.logIndex,workerId:log.args.workerId.toString(),type:log.eventName,amount:log.args.amount??log.args.delta,hash:log.transactionHash,blockNumber:log.blockNumber,status:'CONFIRMED'}));
    return {company,workers:workers.map((w:any)=>({...w,profile:profiles.find(p=>p.workerId===w.workerId)||null})),payments,progress,heldTax:admin?heldTax:undefined,readAt:workers[0]?.readAt??null};
  });
}
