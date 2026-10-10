import {erc20Abi,parseEventLogs} from 'viem';
import {metronomeVaultAbi as abi} from './vault-abi.mjs';
export async function fundingPlan({client,wallet,cfg,workerId,amount}){
  if(amount<=0n)throw new Error('Enter a positive payroll allocation.');
  const account=wallet.account.address;
  const [balance,allowance]=await Promise.all([
    client.readContract({address:cfg.token,abi:erc20Abi,functionName:'balanceOf',args:[account]}),
    client.readContract({address:cfg.token,abi:erc20Abi,functionName:'allowance',args:[account,cfg.vault]}),
  ]);
  if(balance<amount)throw new Error('The company account needs more '+cfg.symbol+' before this allocation can be funded.');
  const funding={to:cfg.vault,abi,functionName:'fundWorkers',args:[BigInt(cfg.employerId),[BigInt(workerId)],[amount]]};
  if(allowance>=amount)return {mode:'fund',calls:[funding]};
  const calls=[{to:cfg.token,abi:erc20Abi,functionName:'approve',args:[cfg.vault,amount]},funding];
  // A local signer (Mera passkey) has no wallet capabilities endpoint; asking the public RPC fails.
  if(wallet.account?.type==='local')return {mode:'approve-then-fund',calls};
  let capabilities;
  try{capabilities=await wallet.getCapabilities({chainId:cfg.chainId});}
  catch(error){
    // Only a refusal by the account holder stops here; an unsupported method falls back to two transactions.
    const code=error.code??error.cause?.code??error.cause?.cause?.code;
    if(code===4001||/denied|rejected/i.test(error.message||''))throw error;
    return {mode:'approve-then-fund',calls};
  }
  // Only use an already-ready atomic account. Do not upgrade or delegate an EOA automatically.
  return {mode:capabilities?.atomic?.status==='ready'?'atomic':'approve-then-fund',calls};
}
export async function confirmFundingBatch({client,wallet,cfg,pending}){
  const status=await wallet.getCallsStatus({id:pending.bundleId});
  if(status.chainId!==cfg.chainId)throw new Error('Funding confirmation came from a different network.');
  if(status.status==='pending')return 'SUBMITTED';
  if(status.status==='failure')return 'FAILED';
  if(status.status!=='success'||!status.atomic||!status.receipts.length)throw new Error('Awaiting verifiable atomic funding settlement.');
  let funded=0n;
  for(const supplied of status.receipts){const receipt=await client.getTransactionReceipt({hash:supplied.transactionHash});if(receipt.status!=='success')return 'FAILED';
    for(const log of parseEventLogs({abi,eventName:'Funded',logs:receipt.logs,strict:true})){if(log.address.toLowerCase()===cfg.vault.toLowerCase()&&log.args.workerId===BigInt(pending.workerId))funded+=log.args.amount;}
  }
  if(funded!==BigInt(pending.amount))throw new Error('Confirmed allocation does not match the requested employee and amount.');
  return 'CONFIRMED';
}
