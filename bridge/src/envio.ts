import {z} from 'zod';
import type {Address,Hex,Log} from 'viem';
import {HttpError} from './context.js';

// Official Monad Testnet HyperSync endpoint. Secrets remain server-side.
const endpoint='https://monad-testnet.hypersync.xyz/query';
const hash=z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const number=z.number().int().nonnegative().safe();
const logSchema=z.object({
  address:z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  block_number:number,block_hash:hash,transaction_hash:hash,
  transaction_index:number,log_index:number,
  data:z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/),
  topic0:hash,topic1:hash.nullable(),topic2:hash.nullable(),topic3:hash.nullable(),
});
// HyperSync's JSON API returns `data` as a list of batches, each with its own logs; a single batch object is also accepted.
const batch=z.object({logs:z.array(logSchema).optional().default([])}).passthrough();
const responseSchema=z.object({next_block:number,data:z.union([z.array(batch),batch])}).passthrough();

/** A paginated real event source. Failures never switch to another provider. */
export async function queryPayrollEvents(options:{
  chainId:number;token:string;vault:Address;fromBlock:bigint;toBlock:bigint;
  fetcher?:typeof fetch;
}):Promise<{logs:Log[];nextBlock:bigint}>{
  const {chainId,token,vault,fromBlock,toBlock}=options;
  if(chainId!==10143)throw new HttpError(503,'Envio payroll indexing is configured for Monad Testnet only.','envio_chain');
  if(!token.trim())throw new HttpError(503,'Configure the server-side Envio HyperSync token.','envio_not_configured');
  if(fromBlock<0n||toBlock<fromBlock||toBlock>=BigInt(Number.MAX_SAFE_INTEGER))throw new HttpError(503,'Invalid payroll indexing range.','envio_range');
  let response:Response;
  try{
    response=await (options.fetcher??fetch)(endpoint,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
      body:JSON.stringify({from_block:Number(fromBlock),to_block:Number(toBlock+1n),
        logs:[{address:[vault]}],field_selection:{log:[
          'address','block_number','block_hash','transaction_hash','transaction_index',
          'log_index','data','topic0','topic1','topic2','topic3',
        ]}}),
    });
  }catch{throw new HttpError(503,'Envio payroll indexing is unavailable. Try again later.','envio_unavailable');}
  // Never forward provider bodies or secret-bearing request objects to clients/logs.
  if(!response.ok)throw new HttpError(503,
    response.status===401||response.status===403?'Envio token needs access to HyperSync.':
    response.status===429?'Envio indexing rate limit reached. Try again later.':'Envio payroll indexing is unavailable.',
    'envio_unavailable');
  let raw:unknown;try{raw=await response.json();}catch{throw new HttpError(503,'Invalid Envio payroll event response.','envio_response');}
  const result=responseSchema.safeParse(raw);
  if(!result.success)throw new HttpError(503,'Invalid Envio payroll event response: '+result.error.issues.slice(0,2).map(i=>i.path.join('.')+' '+i.message).join('; '),'envio_response');
  const nextBlock=BigInt(result.data.next_block);
  if(nextBlock<fromBlock||nextBlock>toBlock+1n)throw new HttpError(503,'Invalid Envio indexing cursor.','envio_response');
  const batches=Array.isArray(result.data.data)?result.data.data:[result.data.data];
  const logs=batches.flatMap(b=>b.logs).map(value=>{
    if(value.address.toLowerCase()!==vault.toLowerCase()||BigInt(value.block_number)<fromBlock||BigInt(value.block_number)>=nextBlock)
      throw new HttpError(503,'Envio returned events outside the requested payroll vault or range.','envio_response');
    const topics=[value.topic0,value.topic1,value.topic2,value.topic3];
    const firstNull=topics.indexOf(null);
    if(firstNull>=0&&topics.slice(firstNull).some(topic=>topic!==null))throw new HttpError(503,'Invalid Envio event topics.','envio_response');
    return {address:value.address as Address,blockNumber:BigInt(value.block_number),
      blockHash:value.block_hash as Hex,transactionHash:value.transaction_hash as Hex,
      transactionIndex:value.transaction_index,logIndex:value.log_index,data:value.data as Hex,
      topics:topics.filter((topic):topic is Hex=>topic!==null),removed:false} as Log;
  });
  return {logs,nextBlock};
}
