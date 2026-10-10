// Agora AUSD actions on Monad testnet, using the contracts Agora publishes:
// https://docs.agora.finance/developer/contract-deployments
// https://docs.agora.finance/instant-settlement/protocol-deployments
import {erc20Abi,formatUnits,isAddress,padHex,parseAbi,parseUnits} from 'viem';

export const agora={
  ausd:'0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC',
  faucet:'0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C',
  pair:'0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae',
  whitelister:'0x7c10F56d6f04a51376393a1C3670e966863F6BD5',
  ctk:'0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D',
  decimals:6,
};
export const faucetAbi=parseAbi(['function requestFunds(address recipient)']);
export const pairAbi=parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function hasRole(string role,address account) view returns (bool)',
  'function getAmountsOut(uint256 amountIn,address[] path) view returns (uint256[])',
  'function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline) returns (uint256[])',
]);
// Agora's testnet Whitelister grants APPROVED_SWAPPER to the address passed (selector observed in its public transactions).
export const whitelistSelector='0x89702d0d';
export const whitelistCalldata=account=>whitelistSelector+padHex(account,{size:32}).slice(2);

export function parseAmount(value,decimals=agora.decimals){
  if(!/^\d+(\.\d+)?$/.test(String(value).trim())||(String(value).split('.')[1]?.length||0)>decimals)throw new Error('Enter a positive amount within the token precision.');
  const amount=parseUnits(String(value).trim(),decimals);if(amount<=0n)throw new Error('Amount must be positive.');return amount;
}

async function confirm(client,hash){
  const receipt=await client.waitForTransactionReceipt({hash});
  if(receipt.status!=='success')throw new Error('Transaction reverted · '+hash);
  return receipt;
}

export async function balances(client,account,tokens){
  const [mon,...values]=await Promise.all([client.getBalance({address:account}),...tokens.map(t=>client.readContract({address:t.address,abi:erc20Abi,functionName:'balanceOf',args:[account]}))]);
  return {MON:mon,...Object.fromEntries(tokens.map((t,i)=>[t.symbol,values[i]]))};
}

/** Agora faucet: sends 10,000 test AUSD to the account. The caller pays network gas. */
export async function requestAusd({client,wallet,account}){
  const {request}=await client.simulateContract({address:agora.faucet,abi:faucetAbi,functionName:'requestFunds',args:[account],account});
  const hash=await wallet.writeContract(request);
  await confirm(client,hash);return hash;
}

/** Person-to-person AUSD (or USDC) transfer signed by the user's own account. */
export async function sendToken({client,wallet,account,token,to,amount}){
  if(!isAddress(to))throw new Error('Enter a valid recipient address.');
  if(to.toLowerCase()===account.toLowerCase())throw new Error('Choose a different recipient.');
  const balance=await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[account]});
  if(balance<amount)throw new Error('Insufficient balance for this transfer.');
  const {request}=await client.simulateContract({address:token,abi:erc20Abi,functionName:'transfer',args:[to,amount],account});
  const hash=await wallet.writeContract(request);
  await confirm(client,hash);return hash;
}

export async function quoteSettlement(client,amount){
  const out=await client.readContract({address:agora.pair,abi:pairAbi,functionName:'getAmountsOut',args:[amount,[agora.ausd,agora.ctk]]});
  return out[1];
}

/**
 * Instant Settlement: AUSD -> CTK through Agora's fixed-price pair. Whitelists the account through
 * Agora's testnet Whitelister on first use, approves the pair, then swaps to the recipient.
 * Each step is a confirmed on-chain transaction; returns their hashes.
 */
export async function instantSettle({client,wallet,account,amount,to=account,slippageBps=0,onStep=()=>{}}){
  const hashes={};
  const [token0,token1]=await Promise.all([client.readContract({address:agora.pair,abi:pairAbi,functionName:'token0'}),client.readContract({address:agora.pair,abi:pairAbi,functionName:'token1'})]);
  if(token0.toLowerCase()!==agora.ctk.toLowerCase()||token1.toLowerCase()!==agora.ausd.toLowerCase())throw new Error('Agora settlement pair does not match the published CTK/AUSD pair.');
  const balance=await client.readContract({address:agora.ausd,abi:erc20Abi,functionName:'balanceOf',args:[account]});
  if(balance<amount)throw new Error('Insufficient AUSD for this settlement.');
  const quoted=await quoteSettlement(client,amount);
  if(quoted===0n)throw new Error('Agora settlement has no liquidity for this amount.');
  if(!await client.readContract({address:agora.pair,abi:pairAbi,functionName:'hasRole',args:['APPROVED_SWAPPER',account]})){
    onStep('Registering with Agora Instant Settlement');
    const data=whitelistCalldata(account);
    await client.call({account,to:agora.whitelister,data});
    hashes.whitelist=await wallet.sendTransaction({to:agora.whitelister,data});
    await confirm(client,hashes.whitelist);
  }
  const allowance=await client.readContract({address:agora.ausd,abi:erc20Abi,functionName:'allowance',args:[account,agora.pair]});
  if(allowance<amount){
    onStep('Authorizing AUSD for settlement');
    const {request}=await client.simulateContract({address:agora.ausd,abi:erc20Abi,functionName:'approve',args:[agora.pair,amount],account});
    hashes.approve=await wallet.writeContract(request);
    await confirm(client,hashes.approve);
  }
  onStep('Settling');
  const block=await client.getBlock();
  const minOut=quoted*BigInt(10000-slippageBps)/10000n;
  const {request}=await client.simulateContract({address:agora.pair,abi:pairAbi,functionName:'swapExactTokensForTokens',args:[amount,minOut,[agora.ausd,agora.ctk],to,block.timestamp+300n],account});
  hashes.settle=await wallet.writeContract(request);
  await confirm(client,hashes.settle);
  return {hashes,received:quoted,display:formatUnits(quoted,18)};
}

/** Agora public API (no key): AUSD supply on Monad mainnet, shown as live trust data next to transfers. */
export async function agoraMonadMetrics(fetcher=fetch){
  const response=await fetcher('https://api.agora.finance/v0/metrics',{cache:'no-store'});
  if(!response.ok)throw new Error('Agora metrics unavailable');
  const data=await response.json(),monad=data.chains?.find(c=>c.network==='monad'||c.chainId==='eip155:143');
  if(!monad)throw new Error('Agora metrics do not list Monad');
  return {circulating:Number(monad.circulatingSupply),total:Number(monad.totalSupply),chains:data.chains.length};
}
