import {describe,it,expect,vi} from 'vitest';
import {queryPayrollEvents} from '../src/envio.js';

// Isolated provider-response fixtures; production only queries real HyperSync.
const vault='0x1111111111111111111111111111111111111111' as const;
const hash='0x'+'ab'.repeat(32);
const log={address:vault,block_number:100,block_hash:hash,transaction_hash:hash,
  transaction_index:0,log_index:0,data:'0x',topic0:hash,topic1:null,topic2:null,topic3:null};
const args={chainId:10143,token:'test-only-secret',vault,fromBlock:100n,toBlock:199n};
const fixture=(body:unknown,status=200)=>vi.fn(async()=>new Response(JSON.stringify(body),{status})) as unknown as typeof fetch;
describe('Envio payroll event source',()=>{
  it('queries the official testnet endpoint and converts real event fields',async()=>{
    const fetcher=fixture({next_block:150,data:{logs:[log]}});
    const result=await queryPayrollEvents({...args,fetcher});
    expect(result.nextBlock).toBe(150n);expect(result.logs[0].blockNumber).toBe(100n);
    expect(result.logs[0].transactionHash).toBe(hash);expect(result.logs[0].topics).toEqual([hash]);
    expect(fetcher).toHaveBeenCalledWith('https://monad-testnet.hypersync.xyz/query',expect.objectContaining({
      headers:{'Content-Type':'application/json',Authorization:'Bearer test-only-secret'},redirect:'error',
      body:JSON.stringify({from_block:100,to_block:200,logs:[{address:[vault]}],field_selection:{log:[
        'address','block_number','block_hash','transaction_hash','transaction_index','log_index','data','topic0','topic1','topic2','topic3',
      ]}}),
    }));
  });
  it('does not treat indexer lag as completed coverage',async()=>{
    const result=await queryPayrollEvents({...args,fetcher:fixture({next_block:100,data:{logs:[]}})});
    expect(result.nextBlock).toBe(100n);expect(result.logs).toEqual([]);
  });
  it('rejects a missing token before any request',async()=>{
    const fetcher=fixture({});await expect(queryPayrollEvents({...args,token:'',fetcher})).rejects.toThrow('Configure');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects other chains before requesting data',async()=>{
    const fetcher=fixture({});await expect(queryPayrollEvents({...args,chainId:143,fetcher})).rejects.toThrow('Testnet only');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401,403,429,500])('stops on HTTP %i without leaking the token or switching providers',async(status)=>{
    const fetcher=fixture({secret:args.token},status);
    await expect(queryPayrollEvents({...args,fetcher})).rejects.not.toThrow(args.token);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects cursor overflow',async()=>{
    await expect(queryPayrollEvents({...args,fetcher:fixture({next_block:201,data:{logs:[]}})})).rejects.toThrow('cursor');
  });
  it('rejects events from a different vault',async()=>{
    await expect(queryPayrollEvents({...args,fetcher:fixture({next_block:150,data:{logs:[{...log,address:'0x'+'22'.repeat(20)}]}})})).rejects.toThrow('outside');
  });
  it('rejects events past the returned cursor',async()=>{
    await expect(queryPayrollEvents({...args,fetcher:fixture({next_block:150,data:{logs:[{...log,block_number:150}]}})})).rejects.toThrow('outside');
  });
  it('rejects missing transaction evidence',async()=>{
    await expect(queryPayrollEvents({...args,fetcher:fixture({next_block:150,data:{logs:[{...log,transaction_hash:null}]}})})).rejects.toThrow('Invalid');
  });
});
