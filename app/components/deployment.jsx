'use client';
import {useState,useRef,useEffect} from 'react';
import {usePayroll} from './payroll.jsx';
import PasskeyAccess from './passkey-access.jsx';
import Link from 'next/link';
import {createPublicClient,defineChain,http,isAddress,parseEventLogs,parseEther,zeroAddress,encodeDeployData,encodeFunctionData} from 'viem';
import {prepareSetupTransaction} from '../lib/setup-funding.mjs';
import {readMeraMetadata} from '../lib/mera.mjs';
import {loadSetupRecord} from '../lib/deployment-store.mjs';
import artifact from '../lib/deployment-artifact.json';
import accounts from '../lib/deployment-accounts.json';
import {metronomeVaultAbi as abi} from '../lib/vault-abi.mjs';
import {testnetTokens} from '../lib/testnet-tokens.mjs';
import {requestAusd} from '../lib/agora.mjs';

const confirmedTaxRecipient='0x4e3f8497F732326CFB8cC4d17Ad0688b74582776';
const chain=defineChain({id:10143,name:'Monad Testnet',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:{default:{http:['https://testnet-rpc.monad.xyz/']}}});
const client=createPublicClient({chain,transport:http()});
export default function Deployment(){
  const payroll=usePayroll();
  const [savedCompany,setSavedCompany]=useState('');
  const company=payroll.meraWallet?.address||savedCompany;
  useEffect(()=>{try{setSavedCompany(readMeraMetadata(localStorage,location.hostname)?.address||'');}catch(e){setError(e.message);}},[]);
  const key=asset=>`shiftpay:deployment:10143:${company}:${asset}`;
  const [companyName,setCompanyName]=useState(''),[enablePayouts,setEnablePayouts]=useState(false);
  const [asset,setAsset]=useState('USDC'),[tax,setTax]=useState(confirmedTaxRecipient),[record,setRecord]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const lock=useRef(false);
  const save=value=>{const named={...value,companyName:companyName||value.companyName};localStorage.setItem(key(asset),JSON.stringify(named));if(named.companyName)localStorage.setItem('shiftpay:company-name',named.companyName);setRecord(named);};
  function load(selected){return loadSetupRecord(localStorage,company,selected,testnetTokens[selected].address);}
  useEffect(()=>{try{const saved=load(asset);setRecord(saved);if(saved?.companyName)setCompanyName(saved.companyName);else setCompanyName(localStorage.getItem('shiftpay:company-name')||'');}catch(e){setError(e.message);}},[asset,company]);
  async function run(task){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await task();}catch(e){setError(e.shortMessage||e.message);}finally{lock.current=false;setBusy(false);}}
  async function wallet(){
    const active=payroll.meraWallet;if(!active||active.address.toLowerCase()!==company.toLowerCase())throw new Error('Unlock the company payroll passkey first.');
    if(await client.getChainId()!==10143)throw new Error('RPC chain mismatch');
    return {wallet:active.client,current:active.address};
  }
  async function confirm(value){
    if(!value?.pending)throw new Error('No pending deployment transaction');
    const receipt=await client.waitForTransactionReceipt({hash:value.pending.hash,timeout:120000});
    if(receipt.status!=='success'){save({...value,pending:null,failedHash:receipt.transactionHash});throw new Error('Transaction reverted. No successful deployment was recorded');}
    if(value.pending.kind==='deploy'){
      if(!receipt.contractAddress)throw new Error('Receipt has no contract address');
      const token=await client.readContract({address:receipt.contractAddress,abi,functionName:'token'});
      if(token.toLowerCase()!==value.token.toLowerCase())throw new Error('Deployed vault token mismatch');
      save({...value,vault:receipt.contractAddress,deployHash:receipt.transactionHash,deployBlock:receipt.blockNumber.toString(),pending:null});setNotice('Vault confirmed. Register the company next.');
    }else if(value.pending.kind==='register'){
      const logs=parseEventLogs({abi,eventName:'EmployerCreated',logs:receipt.logs}).filter(log=>log.address.toLowerCase()===value.vault.toLowerCase());
      if(logs.length!==1)throw new Error('Expected one employer registration event');
      const event=logs[0].args;
      if(event.admin.toLowerCase()!==company.toLowerCase()||event.attestor.toLowerCase()!==value.attestor.toLowerCase()||event.taxAddr.toLowerCase()!==value.tax.toLowerCase())throw new Error('Employer event does not match approved settings');
      save({...value,employerId:event.employerId.toString(),registerHash:receipt.transactionHash,pending:null});setNotice('Company registration confirmed. Save these actual deployment details for the backend.');
    }else if(value.pending.kind==='gas'){
      save({...value,gasFundingHash:receipt.transactionHash,pending:null});setNotice('Backend gas funding confirmed.');
    }else{
      throw new Error('Unknown pending transaction type');
    }
  }
  async function deployStep(){
    const previous=load(asset);if(previous?.vault||previous?.pending)throw new Error('A deployment already exists or is pending. Check its confirmation first');
    if(!isAddress(tax)||tax.toLowerCase()===zeroAddress)throw new Error('Enter the public address that should receive withheld test tokens');
    const {wallet:signer,current}=await wallet();
    if(!artifact.bytecode?.startsWith('0x'))throw new Error('Compiled deployment artifact missing');
    const token=testnetTokens[asset].address;
    const code=await client.getCode({address:token});if(!code||code==='0x')throw new Error('Settlement token contract unavailable');
    const request=await prepareSetupTransaction({client,signer,account:current,data:encodeDeployData({abi,bytecode:artifact.bytecode,args:[token]})});
    const hash=await signer.deployContract({...request,abi,bytecode:artifact.bytecode,args:[token]});
    const value={chainId:10143,company,asset,token,attestor:accounts[asset].attestor,tax,pending:{kind:'deploy',hash}};
    save(value);setNotice('Vault deployment submitted: '+hash);await confirm(value);
  }
  async function registerStep(){
    const value=load(asset);if(!value?.vault||value.pending||value.employerId)throw new Error('A confirmed, unregistered vault is required');
    const {wallet:signer,current}=await wallet();
    const token=await client.readContract({address:value.vault,abi,functionName:'token'});
    if(token.toLowerCase()!==value.token.toLowerCase())throw new Error('Vault token mismatch');
    const request=await prepareSetupTransaction({client,signer,account:current,to:value.vault,data:encodeFunctionData({abi,functionName:'createEmployer',args:[value.attestor,value.tax]})});
    const hash=await signer.writeContract({...request,address:value.vault,abi,functionName:'createEmployer',args:[value.attestor,value.tax]});
    const next={...value,pending:{kind:'register',hash}};save(next);setNotice('Company registration submitted: '+hash);await confirm(next);
  }
  async function fundGasStep(){
    const value=load(asset);if(!value?.employerId||value.pending)throw new Error('Complete company registration first');
    const {wallet:signer,current}=await wallet();
    const request=await prepareSetupTransaction({client,signer,account:current,to:accounts[asset].relayer,value:parseEther('0.05')});
    const hash=await signer.sendTransaction(request);
    const next={...value,pending:{kind:'gas',hash}};save(next);setNotice('Backend gas funding submitted: '+hash);await confirm(next);
  }
  const complete=!!record?.employerId&&(!enablePayouts||!!record?.gasFundingHash);
  const stage=record?.employerId?1:0;
  const labels=['Company details','Company registered'];
  const primary=complete?'Open business dashboard':record?.pending?'Resume company registration':'Register company';
  async function next(){await run(async()=>{
    if(!companyName.trim())throw new Error('Enter your company name.');
    await wallet();
    let value=load(asset);
    if(value?.pending){await confirm(value);value=load(asset);}
    if(!value?.vault){await deployStep();value=load(asset);}
    if(!value?.employerId){await registerStep();value=load(asset);}
    if(enablePayouts&&!value?.gasFundingHash)await fundGasStep();
    setNotice('Company registration confirmed. Continue to add employees and fund payroll once the payroll service is connected.');
  });}
  return <div className="setup-shell"><header className="topbar"><Link className="brand" href="/employer">SHIFTPAY<span className="brand-mark" aria-hidden="true">S</span></Link><span className="company-label">Company setup</span><Link className="button quiet" href="/employer">Back to dashboard</Link></header><main className="setup-main"><p className="eyebrow">BUSINESS / GET STARTED</p><h1>Payroll starts<br/>with your company.</h1><p className="intro">Set up your company, add payroll funding, then invite your employees to access wages as they earn.</p><ol className="setup-steps" aria-label="Company registration progress">{labels.map((label,index)=><li key={label} aria-current={stage===index?'step':undefined}><span>{stage>index?'✓':index+1}</span>{label}</li>)}</ol><section className="setup-card"><div className="section-heading"><h2>{complete?'Company registered':'Company registration'}</h2><span className="tag">Monad testnet</span></div><label>Company name<input required maxLength={100} autoComplete="organization" value={companyName} onChange={e=>{setCompanyName(e.target.value);localStorage.setItem('shiftpay:company-name',e.target.value)}} disabled={busy||!!record?.vault||!!record?.pending}/></label><PasskeyAccess allowCreate company disabled={busy} name={companyName}/>{payroll.error&&<p className="notice error" role="alert">{payroll.error}</p>}{company&&!payroll.meraWallet&&<p className="notice">Your saved company account is shown below. Unlock your existing payroll passkey only when you need to sign an action.</p>}{company&&asset==='AUSD'&&<div className="actions"><button disabled={busy||!payroll.meraWallet} onClick={()=>run(async()=>{const hash=await requestAusd({client,wallet:payroll.meraWallet.client,account:payroll.meraWallet.address});setNotice('Agora faucet sent 10,000 test AUSD · '+hash);})}>Get 10,000 test AUSD from Agora</button></div>}{company&&<p className="muted">Fund your payroll passkey account with {asset} for wages and test MON for company setup. Withheld tax goes to the previously selected tax recipient.</p>}<label>Payroll currency<select disabled={busy||!!record?.pending} value={asset} onChange={e=>{setAsset(e.target.value);setError('');setNotice('');}}>{Object.keys(testnetTokens).map(symbol=><option key={symbol}>{symbol}</option>)}</select></label><div className="setup-policy"><strong>Tax set aside</strong><p>Your payroll keeps tax withholding separate from employee take-home pay. The tax recipient is the address you previously selected.</p><details><summary>View tax account</summary><p className="address">{record?.tax||tax}</p><p className="muted">This receives reserved test tokens when your company remits them. It is separate from employee pay and is not a payment to a tax authority.</p></details></div><p className="muted">One action completes company registration. ShiftPay reuses an authorized company account, creates payroll, and registers your company in sequence. Your account may request separate authorizations for the real setup transactions.</p><label className="setup-checkbox"><input type="checkbox" checked={enablePayouts} disabled={busy||!!record?.gasFundingHash} onChange={e=>setEnablePayouts(e.target.checked)}/><span>Also fund the employee payout service with 0.05 test MON</span></label><p className="muted">Optional service funding covers transaction costs for employee withdrawals. It is separate from wage funding.</p>{complete&&<div className="notice"><strong>Company registered.</strong><p>Payroll infrastructure transactions are confirmed. The payroll service still needs to be connected before you can add employees and fund wages.</p></div>}{error&&<p className="notice error" role="alert">{error}</p>}{busy&&<p role="status">Waiting for your account approval or settlement confirmation…</p>}{record?.pending&&<p className="notice" role="status">Setup submitted. Confirm its settlement before continuing.</p>}<div className="setup-actions">{complete?<Link className="button primary" href="/employer">{primary}</Link>:<button className="primary" disabled={busy||payroll.busy||(!record?.pending&&(!companyName.trim()||!payroll.meraWallet))} onClick={next}>{busy?'Please wait…':primary}</button>}</div>{notice&&<details className="setup-status"><summary>Latest setup status</summary><p className="address" role="status">{notice}</p></details>}</section><details className="setup-technical" open={!!record}><summary>Company registration details</summary><section><p className="muted">These details support payroll administration and service deployment.</p><p className="address">Company account: {company}</p><p className="address">Settlement token: {testnetTokens[asset].address}</p><p className="address">Work verification service: {accounts[asset].attestor}</p><p className="address">Payout service: {accounts[asset].relayer}</p><label>Tax recipient address<input value={tax} disabled={busy||!!record?.vault||!!record?.pending} onChange={e=>setTax(e.target.value.trim())}/></label>{record&&<><h3>Confirmed setup record</h3><pre className="address">{JSON.stringify(record,null,2)}</pre><button disabled={busy} onClick={()=>run(()=>navigator.clipboard.writeText(JSON.stringify(record,null,2)))}>Copy public setup record</button></>}</section></details><p className="trust">Employer funded · Employee wages kept separate from tax · No employee withdrawal fee</p></main></div>;
}
