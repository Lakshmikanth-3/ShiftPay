// Real Monad RPC and deployed Vercel endpoints only. No Anvil, mock clients or token minting.
import {describe,it,expect} from 'vitest';
import {createPublicClient,defineChain,http,erc20Abi,isAddress,type Address} from 'viem';
import {metronomeVaultAbi} from '../src/abi/metronomeVault.js';

if(!isAddress(process.env.TESTNET_EMPLOYER_ADDRESS || ''))throw new Error('Set TESTNET_EMPLOYER_ADDRESS to the actual registered Mera company address');
const employer=process.env.TESTNET_EMPLOYER_ADDRESS as Address;
const tokens={AUSD:'0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC',USDC:'0x534b2f3A21130d7a60830c2Df862319e593943A3'} as const;
if(!process.env.TESTNET_APP_URL)throw new Error('Set TESTNET_APP_URL to the actual approved business deployment');
const origin=process.env.TESTNET_APP_URL;
if(new URL(origin).protocol!=='https:')throw new Error('Live acceptance requires the actual public HTTPS app URL');
const chain=defineChain({id:10143,name:'Monad Testnet',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:{default:{http:['https://testnet-rpc.monad.xyz/']}}});
const client=createPublicClient({chain,transport:http(undefined,{timeout:20000,retryCount:1})});
async function api(asset:string,path:string){
  const response=await fetch(`${origin}/api/bridge/${path}?asset=${asset}`,{signal:AbortSignal.timeout(20000)});
  const data=await response.json();
  expect(response.status,`${asset} ${path}: ${data.message || response.status}`).toBe(200);
  return data;
}

describe('Real testnet release readiness',()=>{
  it('uses the actual Monad testnet RPC',async()=>{expect(await client.getChainId()).toBe(10143);expect(await client.getBlockNumber()).toBeGreaterThan(0n);});
  it('has MON in the selected employer wallet',async()=>{
    const mon=await client.getBalance({address:employer});
    console.log('Observed employer MON balance (wei):',mon.toString());
    expect(mon,'Employer needs test MON for deployment and funding transactions').toBeGreaterThan(0n);
  });
  for(const [asset,address] of Object.entries(tokens)){
    it(`${asset} is deployed with correct metadata`,async()=>{
      const code=await client.getCode({address});expect(code).toBeTruthy();expect(code).not.toBe('0x');
      const [symbol,decimals]=await Promise.all([client.readContract({address,abi:erc20Abi,functionName:'symbol'}),client.readContract({address,abi:erc20Abi,functionName:'decimals'})]);
      expect(symbol).toBe(asset);expect(decimals).toBe(6);
    });
    it(`${asset} employer funding tokens are available`,async()=>{
      const balance=await client.readContract({address,abi:erc20Abi,functionName:'balanceOf',args:[employer]});
      console.log(`Observed ${asset} employer balance (base units):`,balance.toString());
      expect(balance,`Obtain test ${asset} in the employer wallet before funding ${asset} payroll`).toBeGreaterThan(0n);
    });
    it(`${asset} hosted payroll matches the actual vault and employer`,async()=>{
      const config=await api(asset,'config');
      expect(config.chainId).toBe(10143);expect(config.symbol).toBe(asset);expect(config.decimals).toBe(6);
      expect(config.token.toLowerCase()).toBe(address.toLowerCase());expect(isAddress(config.vault)).toBe(true);
      const code=await client.getCode({address:config.vault});expect(code).toBeTruthy();expect(code).not.toBe('0x');
      const [token,registered]=await Promise.all([
        client.readContract({address:config.vault,abi:metronomeVaultAbi,functionName:'token'}),
        client.readContract({address:config.vault,abi:metronomeVaultAbi,functionName:'employers',args:[BigInt(config.employerId)]}),
      ]);
      expect(token.toLowerCase()).toBe(address.toLowerCase());expect(registered[0].toLowerCase()).toBe(employer.toLowerCase());
      expect(config.admin.toLowerCase()).toBe(registered[0].toLowerCase());expect(config.taxAddress.toLowerCase()).toBe(registered[2].toLowerCase());
      const health=await api(asset,'health');expect(health.ok).toBe(true);expect(health.attestorRegistered).toBe(true);
      expect(health.vault.toLowerCase()).toBe(config.vault.toLowerCase());expect(health.chainId).toBe(10143);
      expect(health.attestor.toLowerCase()).toBe(registered[1].toLowerCase());
    });
    it(`${asset} employee has completed a funded shift and two real withdrawals`,async()=>{
      const workerId=process.env[`TESTNET_${asset}_WORKER_ID`],start=process.env[`TESTNET_${asset}_DEPLOY_BLOCK`],employee=process.env.TESTNET_EMPLOYEE_ADDRESS;
      expect(typeof workerId,`Set TESTNET_${asset}_WORKER_ID to the actually registered worker`).toBe('string');
      expect(workerId,`Set TESTNET_${asset}_WORKER_ID to the actually registered worker`).toMatch(/^[1-9]\d*$/);
      expect(typeof start,`Set TESTNET_${asset}_DEPLOY_BLOCK from the observed deployment receipt`).toBe('string');
      expect(start,`Set TESTNET_${asset}_DEPLOY_BLOCK from the observed deployment receipt`).toMatch(/^\d+$/);
      expect(employee && isAddress(employee),'Configure the actual employee payout wallet').toBe(true);
      const config=await api(asset,'config'),worker=await api(asset,`workers/${workerId}`),history=await api(asset,`workers/${workerId}/shifts`);
      expect(worker.worker.payoutAddr.toLowerCase()).toBe(employee!.toLowerCase());
      expect(worker.worker.employerId).toBe(config.employerId);
      expect(BigInt(worker.worker.funded)).toBeGreaterThan(0n);expect(BigInt(worker.worker.withdrawn)).toBeGreaterThan(0n);
      const closed=history.shifts.find((s:{status:string})=>s.status==='CLOSED');expect(closed,'Complete a clock-in and clock-out against the deployed bridge').toBeTruthy();
      for(const kind of ['OPEN','CLOSE']){
        const attestation=closed.attestations.find((a:{kind:string})=>a.kind===kind);expect(attestation).toBeTruthy();
        const tx=attestation.txs.find((t:{status:string,hash?:string})=>t.status==='CONFIRMED'&&t.hash);expect(tx,`${kind} needs a confirmed actual transaction`).toBeTruthy();
        expect((await client.getTransactionReceipt({hash:tx.hash})).status).toBe('success');
      }
      const withdrawals=await client.getContractEvents({address:config.vault,abi:metronomeVaultAbi,eventName:'Withdrawn',args:{workerId:BigInt(workerId!)},fromBlock:BigInt(start!),toBlock:'latest'});
      expect(new Set(withdrawals.map(log=>log.transactionHash)).size,'Complete partial and full withdrawals with real employee signatures').toBeGreaterThanOrEqual(2);
      expect(withdrawals.some(log=>log.args.remaining!>0n)).toBe(true);
      expect(withdrawals.at(-1)?.args.remaining,'Complete the final full withdrawal').toBe(0n);
      expect(withdrawals.reduce((sum,log)=>sum+log.args.amount!,0n)).toBe(BigInt(worker.worker.withdrawn));
      for(const log of withdrawals)expect((await client.getTransactionReceipt({hash:log.transactionHash!})).status).toBe('success');
      expect(BigInt(worker.claimable)).toBe(0n);
    });
  }
  it('serves the real app without public simulated payroll pages',async()=>{
    const response=await fetch(origin,{signal:AbortSignal.timeout(20000)});expect(response.status).toBe(200);
    for(const route of ['/demo','/preview/index.html','/preview/app.js']){
      expect((await fetch(origin+route,{signal:AbortSignal.timeout(20000)})).status,route).toBe(404);
    }
  });
});
