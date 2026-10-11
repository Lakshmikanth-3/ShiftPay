'use client';
import React, {useEffect, useState, useRef, createContext, useContext} from 'react';
import {createPublicClient, createWalletClient, custom, defineChain, http, erc20Abi, parseUnits, parseEther, formatUnits, isAddress, toHex,keccak256,toBytes} from 'viem';
import {monadTransport} from '../lib/rpc.mjs';
import {metronomeVaultAbi as abi} from '../lib/vault-abi.mjs';
import {testnetTokens} from '../lib/testnet-tokens.mjs';
import {fundingPlan,confirmFundingBatch} from '../lib/funding.mjs';

const chain = defineChain({id:10143,name:'Monad testnet',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:{default:{http:['https://testnet-rpc.monad.xyz/']}}});
const client = createPublicClient({chain,transport:monadTransport()});
const clockTypes = {Clock:[{name:'workerId',type:'uint256'},{name:'action',type:'uint8'},{name:'nonce',type:'bytes32'},{name:'deadline',type:'uint64'}]};
async function bridgeApi(path, body,asset) {
  const url=new URL('/api/bridge/'+path,window.location.origin);url.searchParams.set('asset',asset);
  const response = await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store'});
  const data = await response.json();
  if(!response.ok) throw new Error(data.message || 'Payroll request failed');
  return data;
}
const BUSY='The Monad network is busy. Wait a few seconds and try again; nothing was submitted twice.';
function errorText(error) { const text=error.shortMessage || error.message || 'Please try again.'; return /RPC Request failed|rate limit|requests limited|internal error|Payroll service is unavailable|Failed to fetch/i.test(text+(error.details||''))?BUSY:text; }
function positiveAmount(value, decimals) {
  if(!/^\d+(\.\d+)?$/.test(value) || (value.split('.')[1]?.length || 0)>decimals) throw new Error('Enter a positive amount within the token precision.');
  const amount=parseUnits(value,decimals);if(amount<=0n)throw new Error('Amount must be positive.');return amount;
}
class Boundary extends React.Component {
  state={failed:false};static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<main><h1>ShiftPay could not load</h1><p>Check the login configuration and reload.</p></main>:this.props.children;}
}
const PayrollContext=createContext(null);
export const usePayroll=()=>useContext(PayrollContext);
// Mera passkeys are the entire account layer: no email login, extension or custody backend.
export default function Payroll({children}){return <Boundary><Workspace>{children}</Workspace></Boundary>;}
function Workspace({children}){
  const [dashboard,setDashboard]=useState(null),[dashboardError,setDashboardError]=useState('');
  const access=useRef(null),dashboardEpoch=useRef(0),dashboardPolling=useRef(false);
  const [employer,setEmployer]=useState(''),[asset,setAsset]=useState('USDC'),[holdings,setHoldings]=useState(null),[holdingsError,setHoldingsError]=useState('');
  const api=(path,body)=>bridgeApi(path,body,asset);
  const user=null,login=()=>{};
  const [meraWallet,setMeraWallet]=useState(null),meraRef=useRef(null);
  const wallets=meraWallet?[meraWallet]:[];
  const [walletAddress,setWalletAddress]=useState('');
  const wallet=wallets.find(w=>w.address===walletAddress) || wallets[0];
  const authenticated=wallet?.walletClientType==='mera',ready=true;
  const [cfg,setCfg]=useState(null),[workerId,setWorkerId]=useState(''),[selected,setSelected]=useState(''),[worker,setWorker]=useState(null),[history,setHistory]=useState([]),[amount,setAmount]=useState(''),[fundAmount,setFundAmount]=useState(''),[payout,setPayout]=useState(''),[rate,setRate]=useState(''),[bps,setBps]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(null),[online,setOnline]=useState(true),[loading,setLoading]=useState(false),[fresh,setFresh]=useState(false);
  const lock=useRef(false),generation=useRef(0),selection=useRef(''),polling=useRef(false),configEpoch=useRef(0),holdingsEpoch=useRef(0);
  async function startMera(create=false,name=''){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try{const {openPayrollPasskey}=await import('../lib/mera.mjs');const connected=await openPayrollPasskey({create,name});meraRef.current?.end();meraRef.current=connected;setMeraWallet(connected);setWalletAddress(connected.address);setNotice('Payroll passkey unlocked.');}
    catch(e){setError(e.code==='PRF_UNAVAILABLE'?'This authenticator cannot unlock a payroll passkey. Use a passkey provider with PRF support.':errorText(e));}
    finally{lock.current=false;setBusy(false);}
  }
  async function logout(){meraRef.current?.end();meraRef.current=null;setMeraWallet(null);setWalletAddress('');}
  useEffect(()=>()=>{meraRef.current?.end();},[]);
  useEffect(()=>{if(!meraWallet)return;const timer=setTimeout(()=>{meraWallet.end();if(meraRef.current===meraWallet){meraRef.current=null;setMeraWallet(null);setWalletAddress('');setNotice('Payroll passkey session ended. Unlock your passkey again to continue.');}},15*60*1000);return()=>clearTimeout(timer);},[meraWallet]);
  const [loginSlow,setLoginSlow]=useState(false);
  useEffect(()=>{if(ready){setLoginSlow(false);return;}const timer=setTimeout(()=>setLoginSlow(true),20000);return()=>clearTimeout(timer);},[ready]);
  const admin=authenticated && !!cfg && wallet?.address.toLowerCase()===cfg.admin.toLowerCase();
  const owns=authenticated && !!worker && wallet?.address.toLowerCase()===worker.worker.payoutAddr.toLowerCase();
  const storageKey=cfg&&wallet&&selected?`shiftpay:${cfg.chainId}:${cfg.vault}:${wallet.address}:${selected}`:null;
  // Both settlement tokens are dollar stablecoins, so amounts read as dollars; the token name stays in technical details.
  const units=value=>cfg?'$'+Number(formatUnits(BigInt(value),cfg.decimals)).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:6}):'—';
  async function configure(){
    const epoch=++configEpoch.current;
    try{
      const [config,health,rpcChain]=await Promise.all([api('config'+(employer?'?employer='+employer:'')),api('health'),client.getChainId()]);
      if(config.chainId!==chain.id || rpcChain!==chain.id)throw new Error('App RPC and payroll service chain IDs differ.');
      if(!health.ok || !health.attestorRegistered)throw new Error('Payroll service failed its readiness check.');
      const token=await client.readContract({address:config.vault,abi,functionName:'token'});
      if(token.toLowerCase()!==config.token.toLowerCase())throw new Error('Settlement token configuration mismatch.');
      if(chain.id===10143&&(config.symbol!==asset||token.toLowerCase()!==testnetTokens[asset].address.toLowerCase()))throw new Error('Bridge vault does not use the selected issuer-published testnet token.');
      if(epoch!==configEpoch.current)return;
      setCfg(config);setError('');
    }catch(e){if(epoch===configEpoch.current){setCfg(null);setError(errorText(e));}}
  }
  async function refreshHoldings(){
    const epoch=++holdingsEpoch.current;
    if(!wallet||!authenticated||chain.id!==10143)return;
    try{const id=await client.getChainId();if(id!==10143)throw new Error('RPC is not Monad testnet');const values=await Promise.all(Object.entries(testnetTokens).map(async([symbol,token])=>[symbol,formatUnits(await client.readContract({address:token.address,abi:erc20Abi,functionName:'balanceOf',args:[wallet.address]}),token.decimals)]));if(epoch!==holdingsEpoch.current)return;setHoldings(Object.fromEntries(values));setHoldingsError('');}catch(e){if(epoch===holdingsEpoch.current){setHoldings(null);setHoldingsError(errorText(e));}}
  }
  async function refresh(id=selection.current){
    if(!id)return;
    const run=generation.current;
    try{
      const [data,records]=await Promise.all([api(`workers/${id}`),api(`workers/${id}/shifts`)]);
      if(run!==generation.current || id!==selection.current)return;
      // Workers may belong to any company the payroll service serves; follow the worker's company.
      if(data.worker.employerId!==cfg.employerId&&!admin){setEmployer(String(data.worker.employerId));}
      setWorker(data);setHistory(records.shifts);setFresh(true);setError(current=>current===BUSY?'':current);
    }catch(e){if(run===generation.current){setFresh(false);setError(errorText(e));}throw e;}
  }
  useEffect(()=>{
    if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
    const update=()=>setOnline(navigator.onLine);update();window.addEventListener('online',update);window.addEventListener('offline',update);
    return ()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};
  },[]);
  useEffect(()=>{generation.current++;selection.current='';setCfg(null);setSelected('');setWorker(null);setHistory([]);setPending(null);setFresh(false);configure();},[asset,employer]);
  useEffect(()=>{setHoldings(null);refreshHoldings();},[wallet?.address,authenticated]);
  useEffect(()=>{if(!selected||!cfg)return;const timer=setInterval(async()=>{if(polling.current)return;polling.current=true;try{await refresh();}catch{}finally{polling.current=false;}},2000);return()=>clearInterval(timer);},[selected,cfg]);
  useEffect(()=>{
    generation.current++;selection.current='';setSelected('');setWorker(null);setHistory([]);setPending(null);setFresh(false);
  },[wallet?.address,authenticated]);
  useEffect(()=>{if(!storageKey)return;try{const saved=JSON.parse(localStorage.getItem(storageKey)||'null');if(saved)setPending(saved);}catch{setError('Saved transaction tracking could not load.');}},[storageKey]);
  function savePending(value){if(storageKey){if(value)localStorage.setItem(storageKey,JSON.stringify(value));else localStorage.removeItem(storageKey);}setPending(value);}
  useEffect(()=>{
    if(!pending || !cfg || !storageKey)return;
    let cancelled=false;
    const poll=async()=>{
      try{
        let status,hash=pending.hash;
        if(pending.bundleId){status=await confirmFundingBatch({client,wallet:await walletClient(),cfg,pending});}
        else if(pending.txId){const tx=await api(`txs/${pending.txId}`);status=tx.status;hash=tx.hash;}
        else{const receipt=await client.getTransactionReceipt({hash});status=receipt.status==='success'?'CONFIRMED':'FAILED';}
        if(cancelled)return;
        if(status==='CONFIRMED'||status==='FAILED'){
          savePending(null);setNotice(`${pending.label}: ${status.toLowerCase()}${hash?' · '+hash:''}`);await refresh();
          if(status==='FAILED')setError('Transaction failed. Balances were refreshed; review the wallet or service error before retrying.');
        }else setNotice(`${pending.label}: ${status.toLowerCase()}${hash?' · '+hash:''}`);
      }catch(e){if(!cancelled)setNotice(`${pending.label} is still being tracked. ${errorText(e)}`);}
    };
    poll();const timer=setInterval(poll,3000);return()=>{cancelled=true;clearInterval(timer);};
  },[pending,cfg,storageKey]);
  async function execute(task){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');
    try{if(!authenticated||!wallet)throw new Error('Log in and finish wallet setup first.');if(!online)throw new Error('Reconnect before submitting payroll actions.');await task();}catch(e){setError(errorText(e));}finally{lock.current=false;setBusy(false);}
  }
  async function walletClient(){if(wallet?.walletClientType!=='mera')throw new Error('Unlock your payroll passkey first.');if(await client.getChainId()!==chain.id)throw new Error('Payroll RPC chain mismatch.');return wallet.client;}
  async function authorizeDashboard(data={}){
    if(!cfg)throw new Error('Connect deployed payroll first.');
    const epoch=dashboardEpoch.current,block=await client.getBlock(),deadline=block.timestamp+600n;
    const id=admin?'0':selected;if(!id)throw new Error('Open your employee payroll first.');
    const w=await walletClient(),signature=await w.signTypedData({domain:{name:'MetronomeAccess',version:'1',chainId:cfg.chainId,verifyingContract:cfg.vault},types:{Access:[{name:'workerId',type:'uint256'},{name:'deadline',type:'uint64'},{name:'payloadHash',type:'bytes32'}]},primaryType:'Access',message:{workerId:BigInt(id),deadline,payloadHash:keccak256(toBytes(JSON.stringify(data)))}});
    const proof={address:wallet.address,...(admin?{employerId:String(cfg.employerId)}:{}),workerId:id,deadline:deadline.toString(),signature,data};
    const result=await api('dashboard',proof);if(epoch!==dashboardEpoch.current)return;
    setDashboard(result);setDashboardError('');if(Object.keys(data).length===0)access.current=proof;else{access.current=null;setNotice('Profile saved. Open verified dashboard to refresh account access.');}
  }
  async function loadDashboard(data={}){await execute(()=>authorizeDashboard(data));}
  useEffect(()=>{dashboardEpoch.current++;access.current=null;setDashboard(null);setDashboardError('');},[asset,wallet?.address,authenticated]);
  useEffect(()=>{if(admin)return;dashboardEpoch.current++;access.current=null;setDashboard(null);setDashboardError('');},[selected]);
  useEffect(()=>{if(!dashboard||!access.current)return;const timer=setInterval(async()=>{if(dashboardPolling.current)return;if(BigInt(access.current.deadline)<=BigInt(Math.floor(Date.now()/1000))){access.current=null;setDashboard(null);setDashboardError('Account access expired. Open the verified dashboard again.');return;}dashboardPolling.current=true;const epoch=dashboardEpoch.current;try{const result=await api('dashboard',access.current);if(epoch===dashboardEpoch.current){setDashboard(result);setDashboardError('');}}catch(e){/* A failed refresh keeps the last good dashboard; only an expired authorization clears it. */if(epoch===dashboardEpoch.current&&/expired|signature required|forbidden/i.test(e.message||'')){setDashboardError(errorText(e));setDashboard(null);}}finally{dashboardPolling.current=false;}},5000);return()=>clearInterval(timer);},[dashboard,cfg]);
  async function withdraw(){await execute(async()=>{
    if(!owns)throw new Error('Use the registered employee account.');await refresh();const value=positiveAmount(amount,cfg.decimals);
    const data=await api(`workers/${selected}/withdraw-typed-data?amount=${value}`);
    if(data.domain.chainId!==cfg.chainId||data.domain.verifyingContract.toLowerCase()!==cfg.vault.toLowerCase())throw new Error('Withdrawal signing domain mismatch.');
    if(data.message.workerId!==selected || data.message.amount!==value.toString())throw new Error('Withdrawal request mismatch.');
    const w=await walletClient();
    const message=Object.fromEntries(Object.entries(data.message).map(([key,value])=>[key,BigInt(value)]));
    const signature=await w.signTypedData({...data,message});
    const result=await api('withdrawals',{workerId:selected,amount:value.toString(),deadline:message.deadline.toString(),signature});
    savePending({txId:result.txId,label:'Withdrawal'});setNotice('Withdrawal queued. Your employer’s relayer pays gas.');
  });}
  async function clock(action){await execute(async()=>{
    if(!admin)throw new Error('Use the registered company account.');const block=await client.getBlock(),deadline=block.timestamp+300n,nonce=toHex(crypto.getRandomValues(new Uint8Array(32)));
    const w=await walletClient();const signature=await w.signTypedData({domain:{name:'ShiftPayClock',version:'1',chainId:cfg.chainId,verifyingContract:cfg.vault},types:clockTypes,primaryType:'Clock',message:{workerId:BigInt(selected),action:action==='clock_in'?0:1,nonce,deadline}});
    const result=await api('clock-intents',{workerId:selected,type:action,nonce,deadline:deadline.toString(),signature});
    if(result.txId)savePending({txId:result.txId,label:action==='clock_in'?'Clock in':'Clock out'});else setNotice('Clock event recorded. Refreshing shift history.');await refresh();
  });}
  async function direct(functionName,args,label){
    if(!admin)throw new Error('Use the registered company account.');const w=await walletClient();
    const {request}=await client.simulateContract({address:cfg.vault,abi,functionName,args,account:wallet.address});
    const hash=await w.writeContract(request);savePending({hash,label});setNotice(`${label} submitted · ${hash}`);
  }
  async function fund(input=fundAmount){await execute(async()=>{
    if(!admin)throw new Error('Use the registered company account.');const value=positiveAmount(input,cfg.decimals),w=await walletClient();
    const plan=await fundingPlan({client,wallet:w,cfg,workerId:selected,amount:value});
    if(plan.mode==='atomic'){setNotice('Authorize payroll funding once in your company account.');const bundle=await w.sendCalls({calls:plan.calls,forceAtomic:true});savePending({bundleId:bundle.id,workerId:selected,amount:value.toString(),label:'Payroll funding'});setNotice('Payroll funding submitted. Waiting for verified settlement.');return;}
    const balance=await client.readContract({address:cfg.token,abi:erc20Abi,functionName:'balanceOf',args:[wallet.address]});if(balance<value)throw new Error('Your company account has insufficient '+cfg.symbol+' to fund this allocation.');
    const allowance=await client.readContract({address:cfg.token,abi:erc20Abi,functionName:'allowance',args:[wallet.address,cfg.vault]});
    if(allowance<value){
      const {request}=await client.simulateContract({address:cfg.token,abi:erc20Abi,functionName:'approve',args:[cfg.vault,value],account:wallet.address});
      const hash=await w.writeContract(request);setNotice('Confirming token approval…');savePending({hash,label:'Token approval'});
      const receipt=await client.waitForTransactionReceipt({hash});if(receipt.status!=='success')throw new Error('Token approval failed.');savePending(null);
    }
    await direct('fundWorkers',[BigInt(cfg.employerId),[BigInt(selected)],[value]],'Payroll funding');
  });}
  async function register(event,profile,allocation,gas=false,plan={}){event.preventDefault();await execute(async()=>{
    if(!admin)throw new Error('Use the registered company account.');if(!/^\d+$/.test(workerId)||BigInt(workerId)===0n||!isAddress(payout))throw new Error('Provide a positive worker ID and a valid payout wallet.');
    const tax=Number(bps);if(!Number.isInteger(tax)||tax<0||tax>10000)throw new Error('Withholding must be between 0 and 10000 basis points.');
    // Select the ID before writing so transaction tracking is scoped to the new worker.
    const w=await walletClient();const {request}=await client.simulateContract({address:cfg.vault,abi,functionName:'createWorker',args:[BigInt(cfg.employerId),BigInt(workerId),positiveAmount(plan.rate??rate,cfg.decimals),tax,plan.maxShiftSeconds??28800,payout],account:wallet.address});
    const hash=await w.writeContract(request);setNotice(`Worker registration submitted · ${hash}`);
    const key=`shiftpay:${cfg.chainId}:${cfg.vault}:${wallet.address}:${workerId}`;localStorage.setItem(key,JSON.stringify({hash,label:'Worker registration'}));
    generation.current++;selection.current=workerId;setSelected(workerId);setPending({hash,label:'Worker registration'});setWorker(null);setFresh(false);
    if(profile){setNotice('Confirming employee registration…');const receipt=await client.waitForTransactionReceipt({hash});if(receipt.status!=='success')throw new Error('Employee registration failed. Details were not saved.');
      if(allocation){const value=positiveAmount(allocation,cfg.decimals),balance=await client.readContract({address:cfg.token,abi:erc20Abi,functionName:'balanceOf',args:[wallet.address]});if(balance<value)throw new Error('Employee registered, but the company account needs more '+cfg.symbol+' to fund the allocation.');const plan=await fundingPlan({client,wallet:w,cfg,workerId,amount:value});
        if(plan.mode==='atomic'){const bundle=await w.sendCalls({calls:plan.calls,forceAtomic:true});const tracked={bundleId:bundle.id,workerId,amount:value.toString(),label:'Employee allocation'};localStorage.setItem(key,JSON.stringify(tracked));setPending(tracked);await w.waitForCallsStatus({id:bundle.id,throwOnFailure:true,timeout:120000});if(await confirmFundingBatch({client,wallet:w,cfg,pending:tracked})!=='CONFIRMED')throw new Error('Employee registered. Funding still needs settlement confirmation.');}
        else{if(plan.mode==='approve-then-fund'){setNotice('This account requires token authorization followed by allocation confirmation.');const approved=await w.writeContract({address:cfg.token,abi:erc20Abi,functionName:'approve',args:[cfg.vault,value]});if((await client.waitForTransactionReceipt({hash:approved})).status!=='success')throw new Error('Employee registered, but funding approval failed.');}const funded=await w.writeContract({address:cfg.vault,abi,functionName:'fundWorkers',args:[BigInt(cfg.employerId),[BigInt(workerId)],[value]]});localStorage.setItem(key,JSON.stringify({hash:funded,label:'Employee allocation'}));setPending({hash:funded,label:'Employee allocation'});if((await client.waitForTransactionReceipt({hash:funded})).status!=='success')throw new Error('Employee registered, but payroll funding failed.');}}

      if(gas){setNotice('Sending 0.1 test MON for the employee network fees…');const gasHash=await w.sendTransaction({to:payout,value:parseEther('0.1')});if((await client.waitForTransactionReceipt({hash:gasHash})).status!=='success')throw new Error('Employee registered and funded, but the network fee transfer failed.');}
      await authorizeDashboard({employee:{workerId,...profile}});setNotice('Employee registered, payroll allocation confirmed, and employee details saved.');}
  });}
  /** Creates a company in the shared vault with this passkey as admin and tax account, served by ShiftPay's attestor. */
  async function createCompany(name){await execute(async()=>{
    if(!cfg?.attestor)throw new Error('Payroll service is not connected.');if(!name?.trim())throw new Error('Enter your company name.');
    const w=await walletClient();
    const {request,result}=await client.simulateContract({address:cfg.vault,abi,functionName:'createEmployer',args:[cfg.attestor,wallet.address],account:wallet.address});
    const hash=await w.writeContract(request);setNotice('Creating your company on Monad…');
    if((await client.waitForTransactionReceipt({hash})).status!=='success')throw new Error('Company creation failed.');
    setEmployer(String(result));setNotice('Company created · '+hash);
    try{localStorage.setItem('shiftpay:company-name:'+wallet.address.toLowerCase(),name.trim());}catch{}
  });}
  async function choose(event,requestedId=workerId){event.preventDefault();if(!/^\d+$/.test(requestedId)||BigInt(requestedId)===0n){setError('Enter a positive worker ID.');return;}const id=BigInt(requestedId).toString();setWorkerId(id);setLoading(true);setError('');generation.current++;selection.current=id;setSelected(id);setWorker(null);setHistory([]);setFresh(false);try{await refresh(id);}catch{}finally{setLoading(false);}}
  const disabled=busy||!!pending||!fresh||!online;
  return <PayrollContext.Provider value={{employer,setEmployer,createCompany,api,client,walletClient,meraWallet,startMera,dashboard,dashboardError,loadDashboard,asset,setAsset,holdings,holdingsError,ready,authenticated,login,logout,user,wallet,wallets,setWalletAddress,cfg,workerId,setWorkerId,selected,worker,history,amount,setAmount,fundAmount,setFundAmount,payout,setPayout,rate,setRate,bps,setBps,busy,error,notice,pending,online,loading,fresh,loginSlow,admin,owns,units,configure,refreshHoldings,withdraw,clock,direct,execute,fund,register,choose,disabled}}>{children}</PayrollContext.Provider>;
}
