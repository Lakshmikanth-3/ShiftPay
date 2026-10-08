import 'dotenv/config';
import {createPublicClient,defineChain,http,erc20Abi,isAddress,type Address,type Hex} from 'viem';
import {privateKeyToAccount,mnemonicToAccount} from 'viem/accounts';
const rpc=process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz/';
const token=(process.env.SETTLEMENT_TOKEN_ADDRESS || process.env.AUSD_ADDRESS || '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC') as Address;
const id=Number(process.env.MONAD_CHAIN_ID || 10143);
if(id!==10143)throw new Error('This preflight is restricted to Monad testnet 10143');
const chain=defineChain({id,name:'Monad Testnet',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:{default:{http:[rpc]}}});
const client=createPublicClient({chain,transport:http(rpc,{timeout:15000})});
const missing:string[]=[];
const keys:[string,string|undefined][]=[['deployer',process.env.DEPLOYER_PRIVATE_KEY],['attestor',process.env.ATTESTOR_PRIVATE_KEY],...(process.env.RELAYER_PRIVATE_KEYS || '').split(',').filter(Boolean).map((k,i):[string,string]=>['relayer '+i,k])];
const publicDev=new Set(Array.from({length:10},(_,i)=>mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex:i}).address.toLowerCase()));
const actual=await client.getChainId();if(actual!==id)throw new Error('RPC chain mismatch');
if(!isAddress(token)||!(await client.getCode({address:token})))throw new Error('No settlement token at the configured address');
const [symbol,decimals]=await Promise.all([client.readContract({address:token,abi:erc20Abi,functionName:'symbol'}),client.readContract({address:token,abi:erc20Abi,functionName:'decimals'})]);
const known={AUSD:'0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC',USDC:'0x534b2f3A21130d7a60830c2Df862319e593943A3'};
if(!['AUSD','USDC'].includes(symbol)||decimals!==6||token.toLowerCase()!==known[symbol as keyof typeof known].toLowerCase())throw new Error('Expected an issuer-published testnet AUSD or USDC token with 6 decimals');
console.log('Verified network/token:',JSON.stringify({chainId:id,token,symbol,decimals}));
for(const [asset,address] of Object.entries(known)){
  const [actualSymbol,actualDecimals]=await Promise.all([client.readContract({address:address as Address,abi:erc20Abi,functionName:'symbol'}),client.readContract({address:address as Address,abi:erc20Abi,functionName:'decimals'})]);
  if(actualSymbol!==asset||actualDecimals!==6)throw new Error('Testnet token metadata mismatch: '+asset);
  console.log('Verified testnet asset:',JSON.stringify({asset,address,decimals:actualDecimals}));
}
if(!(process.env.RELAYER_PRIVATE_KEYS || '').trim())missing.push('RELAYER_PRIVATE_KEYS');
if(!isAddress(process.env.TAX_ADDRESS || ''))missing.push('TAX_ADDRESS');
if(!(process.env.WEBHOOK_SECRET || '').trim() || process.env.WEBHOOK_SECRET!.length<32)missing.push('WEBHOOK_SECRET (32+ characters)');
if(!(process.env.ADMIN_API_TOKEN || '').trim() || process.env.ADMIN_API_TOKEN!.length<32)missing.push('ADMIN_API_TOKEN (32+ characters)');
for(const [role,value] of keys){
  if(!value||!/^0x[0-9a-fA-F]{64}$/.test(value.trim())){missing.push(role+' private key');continue;}
  const account=privateKeyToAccount(value.trim() as Hex);if(publicDev.has(account.address.toLowerCase()))throw new Error('Public Anvil development accounts must never be used on testnet');
  if(process.env.ATTESTOR_ADDRESS&&role==='attestor'&&account.address.toLowerCase()!==process.env.ATTESTOR_ADDRESS.toLowerCase())throw new Error('Attestor address and key differ');
  if(role==='deployer'||role.startsWith('relayer')){if(await client.getBalance({address:account.address})===0n)missing.push(role+' needs test MON');}
}
if(missing.length){console.log('Owner setup still needed:',missing.join(', '));process.exitCode=1;}else console.log('Preflight passed. Deploy with the contract script and record/verify the resulting address.');
