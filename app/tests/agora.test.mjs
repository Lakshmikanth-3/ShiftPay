// Checks the Agora integration against the live Monad testnet contracts (read-only calls only).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicClient,http,erc20Abi,decodeFunctionData} from 'viem';
import {monadTestnet} from 'viem/chains';
import {agora,pairAbi,faucetAbi,parseAmount,quoteSettlement,whitelistCalldata} from '../lib/agora.mjs';

const client=createPublicClient({chain:monadTestnet,transport:http('https://testnet-rpc.monad.xyz/')});
const company='0x430ff06AB045911e5dC6B7a742ddC11f27F47487';

test('parses amounts within token precision',()=>{
  assert.equal(parseAmount('12.5'),12_500_000n);
  assert.throws(()=>parseAmount('0'));
  assert.throws(()=>parseAmount('1.0000001'));
  assert.throws(()=>parseAmount('-1'));
});

test('published CTK/AUSD Instant Settlement pair is live',async()=>{
  assert.equal((await client.readContract({address:agora.pair,abi:pairAbi,functionName:'token1'})).toLowerCase(),agora.ausd.toLowerCase());
  assert.equal((await client.readContract({address:agora.pair,abi:pairAbi,functionName:'token0'})).toLowerCase(),agora.ctk.toLowerCase());
  assert.equal(await client.readContract({address:agora.ctk,abi:erc20Abi,functionName:'decimals'}),18);
  assert.equal(await client.readContract({address:agora.ausd,abi:erc20Abi,functionName:'decimals'}),6);
});

test('settlement quote is fixed-price and non-zero',async()=>{
  const out=await quoteSettlement(client,10_000_000n);
  assert.equal(out,10n*10n**18n);
});

test('whitelist calldata matches a confirmed public whitelister transaction',async()=>{
  const tx=await client.getTransaction({hash:'0x4f60b1d34fa89b30a56e39be8869b3dac4179f4d4c40145e49a8aa6a68a86fe5'});
  assert.equal(tx.to.toLowerCase(),agora.whitelister.toLowerCase());
  assert.equal(tx.input.toLowerCase(),whitelistCalldata(tx.from).toLowerCase());
  const receipt=await client.getTransactionReceipt({hash:tx.hash});
  assert.equal(receipt.status,'success');
  assert.equal(await client.readContract({address:agora.pair,abi:pairAbi,functionName:'hasRole',args:['APPROVED_SWAPPER',tx.from]}),true);
});

test('whitelisting is open to a new account',async()=>{
  await client.call({account:company,to:agora.whitelister,data:whitelistCalldata(company)});
});

test('Agora faucet holds AUSD and accepts a request',async()=>{
  const held=await client.readContract({address:agora.ausd,abi:erc20Abi,functionName:'balanceOf',args:[agora.faucet]});
  assert.ok(held>=10_000_000_000n,'faucet has at least 10,000 AUSD');
  await client.simulateContract({address:agora.faucet,abi:faucetAbi,functionName:'requestFunds',args:[company],account:company});
  assert.deepEqual(decodeFunctionData({abi:faucetAbi,data:'0x544c7cf9'+company.slice(2).toLowerCase().padStart(64,'0')}).args,[company]);
});
