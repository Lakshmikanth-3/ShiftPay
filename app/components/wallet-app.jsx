'use client';
// Employee mobile wallet: payroll wages plus AUSD send, receive and Agora Instant Settlement.
import React,{useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {formatUnits} from 'viem';
import {usePayroll} from './payroll.jsx';
import PasskeyAccess from './passkey-access.jsx';
import {testnetTokens} from '../lib/testnet-tokens.mjs';
import {pitchUrl} from '../lib/pitch.mjs';
import {unlockPayslipVault,openPayslips,sealPayslips} from '../lib/private-payslips.mjs';
import {agora,agoraMonadMetrics,balances,instantSettle,parseAmount,quoteSettlement,requestAusd,sendToken} from '../lib/agora.mjs';

const lowFee=50_000_000_000_000_000n; // below 0.05 MON the employer tops up network-fee credit (Monad reserves gasLimit × maxFee)

const tabs=[['','Home','⌂'],['send','Send','↗'],['cashout','Cash out','⇄'],['history','History','☰'],['profile','Profile','◉']];
const explorer=hash=>'https://testnet.monadexplorer.com/tx/'+hash;
const tokenList=[...Object.entries(testnetTokens).map(([symbol,t])=>({symbol,address:t.address,decimals:t.decimals})),{symbol:'CTK',address:agora.ctk,decimals:18}];
const fmt=(value,decimals,max=2)=>value===undefined?'—':Number(formatUnits(value,decimals)).toLocaleString(undefined,{maximumFractionDigits:max});
const short=a=>a?a.slice(0,6)+'…'+a.slice(-4):'';

function useActivity(address){
  const key=address?'shiftpay:activity:'+address.toLowerCase():null;
  const [items,setItems]=useState([]);
  useEffect(()=>{if(!key)return setItems([]);try{setItems(JSON.parse(localStorage.getItem(key)||'[]'))}catch{setItems([])}},[key]);
  const add=item=>setItems(list=>{const next=[{...item,at:Date.now()},...list].slice(0,100);try{localStorage.setItem(key,JSON.stringify(next))}catch{}return next});
  return [items,add];
}

function useWallet(){
  const p=usePayroll(),account=p.wallet?.address;
  const [bal,setBal]=useState(null),[status,setStatus]=useState(''),[error,setError]=useState(''),[working,setWorking]=useState(false);
  const [activity,addActivity]=useActivity(account);
  async function refresh(){if(!account)return;try{setBal(await balances(p.client,account,tokenList))}catch(e){setError(e.shortMessage||e.message)}}
  useEffect(()=>{setBal(null);refresh();if(!account)return;const t=setInterval(refresh,5000);return()=>clearInterval(t)},[account]);
  async function run(label,task){
    if(working)return;setWorking(true);setError('');setStatus(label+'…');
    try{if(!account)throw new Error('Unlock your passkey account first.');const w=await p.walletClient();const result=await task(w);await refresh();return result;}
    catch(e){setError(e.shortMessage||e.message||'Please try again.');setStatus('');}
    finally{setWorking(false);}
  }
  return {p,account,bal,status,setStatus,error,setError,working,run,activity,addActivity,refresh};
}

function TxLink({hash,children='View receipt'}){return hash?<a className="m-link" href={explorer(hash)} target="_blank" rel="noreferrer">{children} ↗</a>:null}
function Feedback({w}){return <>{w.error&&<p className="m-alert error" role="alert">{w.error}</p>}{w.status&&!w.error&&<p className="m-alert" role="status">{w.status}</p>}</>}
function GasNote({w}){if(!w.bal||w.bal.MON>=lowFee)return null;return <p className="m-alert warn">Setting up your free network-fee credit…</p>}

/** Employer-paid gas: a registered employee with an empty fee balance gets a small top-up from the payroll relayer. */
function useSponsoredGas(w){
  const p=w.p,asked=useRef('');
  useEffect(()=>{const key=(p.owns?p.selected:'new')+':'+w.account;if(!w.account||!w.bal||w.bal.MON>=lowFee||asked.current===key)return;asked.current=key;
    p.api('gas-grants',p.owns?{workerId:p.selected}:{address:w.account}).then(r=>{if(r.granted){w.addActivity({type:'Free fee credit added',amount:'+fees',symbol:'',hash:r.hash});w.refresh();}}).catch(()=>{asked.current='';});
  },[p.owns,p.selected,w.bal?.MON,w.account]);
}

function Login(){
  const p=usePayroll();
  return <div className="m-login"><div className="m-logo">S</div><h1>ShiftPay</h1><p>Your wages, as you earn them. Send money home in seconds.</p>
    <div className="m-card"><PasskeyAccess allowCreate/></div>
    {p.error&&<p className="m-alert error" role="alert">{p.error}</p>}
    <p className="m-fine">One fingerprint or face scan creates your account. No seed phrase, no app to install, no password. Use the same passkey on any device to get back in.</p></div>;
}

function Wages({w}){
  const p=w.p,[id,setId]=useState('');
  const key=w.account?'shiftpay:worker:'+w.account.toLowerCase():null;
  const [finding,setFinding]=useState(false);
  useEffect(()=>{if(!key||!p.cfg||p.selected)return;let saved=null;try{saved=localStorage.getItem(key)}catch{}
    const open=id=>{p.setWorkerId(id);p.choose({preventDefault(){}},id)};
    if(saved){open(saved);return;}
    // Stateless recovery: nothing saved on this device, so find the payroll registered to this passkey's address.
    setFinding(true);p.api('workers/by-address/'+w.account).then(r=>{if(r.workerIds?.length)open(r.workerIds[0]);}).catch(()=>{}).finally(()=>setFinding(false));
  },[key,p.cfg]);
  useEffect(()=>{if(key&&p.owns&&p.selected)try{localStorage.setItem(key,p.selected)}catch{}},[key,p.owns,p.selected]);
  const dialog=useRef(null);
  if(!p.cfg)return <section className="m-card"><h3>Payroll</h3><p className="m-muted">{p.error?.includes('pending')?'Your employer has not connected '+p.asset+' payroll yet.':p.error||'Connecting to payroll…'}</p><button className="m-ghost" onClick={p.configure}>Retry</button></section>;
  if(finding&&!p.worker)return <section className="m-card"><h3>Finding your payroll…</h3><p className="m-muted">Looking up the employer that registered this account.</p></section>;
  if(!p.worker||!p.owns)return <section className="m-card"><h3>Link your payroll</h3><p className="m-muted">Enter the employee ID your company gave you. Your passkey account must be the payout account they registered.</p>
    <form className="m-row" onSubmit={e=>{e.preventDefault();p.setWorkerId(id);p.choose(e,id)}}><input inputMode="numeric" placeholder="Employee ID" value={id} onChange={e=>setId(e.target.value)} required/><button className="m-primary" disabled={p.loading}>{p.loading?'…':'Link'}</button></form>
    {p.worker&&!p.owns&&<p className="m-alert error">Employee {p.selected} is registered to {short(p.worker.worker.payoutAddr)}, not this account.</p>}</section>;
  const x=p.worker,on=x.worker.clockInAt!=='0';
  return <section className="m-card wages"><div className="m-row between"><h3>Earned wages</h3><span className={'m-chip'+(on?' live':'')}>{on?'● On shift':'Off shift'}</span></div>
    <strong className="m-amount">{p.units(x.claimable)}</strong><p className="m-muted">Available to withdraw now · employer funded, no fee</p>
    <div className="m-stats"><div><span>Gross earned</span><b>{p.units(BigInt(x.earned.net)+BigInt(x.earned.tax))}</b></div><div><span>Tax set aside</span><b>{p.units(x.earned.tax)}</b></div><div><span>Withdrawn</span><b>{p.units(x.worker.withdrawn)}</b></div></div>
    <button className="m-primary wide" disabled={p.disabled||x.worker.flags!==1||BigInt(x.claimable)===0n} onClick={()=>{p.setAmount(formatUnits(BigInt(x.claimable),p.cfg.decimals));dialog.current.showModal()}}>Withdraw to my wallet</button>
    {p.pending&&<p className="m-alert" role="status">{p.pending.label}: confirming on Monad…</p>}
    <dialog ref={dialog} className="m-sheet"><h3>Withdraw earned wages</h3><form onSubmit={e=>{e.preventDefault();p.withdraw();dialog.current.close()}}><label>Amount ({p.asset})<input inputMode="decimal" value={p.amount} onChange={e=>p.setAmount(e.target.value)} required/></label><p className="m-muted">Your employer pays the network fee. Funds arrive in this wallet.</p><div className="m-row"><button type="button" className="m-ghost" onClick={()=>dialog.current.close()}>Cancel</button><button className="m-primary">Confirm</button></div></form></dialog>
  </section>;
}

function Home({w}){
  const p=w.p,b=w.bal;useSponsoredGas(w);
  async function faucet(){const hash=await w.run('Adding test dollars',wallet=>requestAusd({client:p.client,wallet,account:w.account}));if(hash){w.addActivity({type:'Test dollars added',amount:'+10,000',symbol:'USD',hash});w.setStatus('10,000 test dollars added.')}}
  return <>
    <section className="m-balance"><p>Digital dollars</p><strong>${b?fmt(b.AUSD+b.USDC,6):'…'}</strong>
      <div className="m-sub">{b&&<>Wages and transfers in US dollars{b.CTK>0n?<> · {fmt(b.CTK,18)} in local currency</>:null}</>}</div>
      <div className="m-sub">{b&&<>Fee credit {b.MON>=lowFee?'ready':'empty'} · paid by your employer</>}</div></section>
    <nav className="m-actions" aria-label="Quick actions">
      <Link href="/employee/send"><i>↗</i>Send</Link>
      <Link href="/employee/receive"><i>↙</i>Receive</Link>
      <Link href="/employee/cashout"><i>⇄</i>Cash out</Link>
      <button onClick={faucet} disabled={w.working}><i>＋</i>Add test $</button>
    </nav>
    <Feedback w={w}/><GasNote w={w}/>
    <Wages w={w}/>
    <Recent w={w}/>
  </>;
}

function AgoraTrust(){
  const [m,setM]=useState(null);
  useEffect(()=>{agoraMonadMetrics().then(setM).catch(()=>setM(false))},[]);
  return m?<p className="m-fine">AUSD by Agora · {Math.round(m.circulating).toLocaleString()} AUSD circulating on Monad · live from Agora's public API</p>:null;
}

function Send({w}){
  const p=w.p,[to,setTo]=useState(''),[amount,setAmount]=useState(''),[mode,setMode]=useState('settle'),[symbol,setSymbol]=useState('AUSD'),[note,setNote]=useState(''),[done,setDone]=useState(null);
  const settle=mode==='settle',sym=settle?'AUSD':symbol,token=tokenList.find(t=>t.symbol===sym);
  useSponsoredGas(w);
  async function submit(e){e.preventDefault();setDone(null);
    const value=(()=>{try{return parseAmount(amount,token.decimals)}catch(err){w.setError(err.message)}})();if(!value)return;
    if(settle){
      if(!/^0x[0-9a-fA-F]{40}$/.test(to)){w.setError('Enter a valid recipient address.');return;}
      const result=await w.run('Sending through Agora Instant Settlement',wallet=>instantSettle({client:p.client,wallet,account:w.account,amount:value,to,onStep:w.setStatus}));
      if(result){w.addActivity({type:'Sent abroad to '+short(to)+(note?' · '+note:''),amount:'-'+amount,symbol:'AUSD',hash:result.hashes.settle});w.setStatus('');setDone({hash:result.hashes.settle,amount,to,received:result.display+' in local currency'});setAmount('');}
      return;
    }
    const hash=await w.run('Sending '+amount+' '+sym,wallet=>sendToken({client:p.client,wallet,account:w.account,token:token.address,to,amount:value}));
    if(hash){w.addActivity({type:'Sent to '+short(to)+(note?' · '+note:''),amount:'-'+amount,symbol:sym,hash});w.setStatus('');setDone({hash,amount,to,received:'$'+amount});setAmount('');}}
  return <section className="m-card"><h2>Send money</h2><p className="m-muted">Send to family or anyone, anywhere. Settled instantly on Monad.</p>
    <div className="m-seg" role="radiogroup" aria-label="Delivery">
      <button type="button" role="radio" aria-checked={settle} className={settle?'on':''} onClick={()=>setMode('settle')}>Send abroad · instant</button>
      <button type="button" role="radio" aria-checked={!settle} className={!settle?'on':''} onClick={()=>setMode('direct')}>Send dollars</button>
    </div>
    <form className="m-form" onSubmit={submit}>
      <label>Recipient's pay ID (account number)<input value={to} onChange={e=>setTo(e.target.value.trim())} placeholder="0x…" required autoComplete="off"/></label>
      <label>Amount<div className="m-row"><input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00" required/>{settle?<span className="m-unit">AUSD</span>:<select value={symbol} onChange={e=>setSymbol(e.target.value)}><option>AUSD</option><option>USDC</option></select>}</div></label>
      <small className="m-muted">Balance: {w.bal?fmt(w.bal[sym],token.decimals,6):'…'} {sym}{settle?' · they receive local currency instantly, 1:1, no fee':''}</small>
      <label>Note (optional, kept on this device)<input maxLength={80} value={note} onChange={e=>setNote(e.target.value)}/></label>
      <button className="m-primary wide" disabled={w.working}>{w.working?'Sending…':'Send money'}</button>
    </form><Feedback w={w}/><GasNote w={w}/>
    {done&&<div className="m-success"><b>Sent ${done.amount}</b><p>To {short(done.to)} · they received {done.received}</p><TxLink hash={done.hash}/></div>}
    <AgoraTrust/></section>;
}

function Receive({w}){
  const [qr,setQr]=useState(''),[copied,setCopied]=useState(false);
  useEffect(()=>{if(!w.account)return;import('qrcode').then(QR=>QR.toDataURL(w.account,{margin:1,width:240})).then(setQr).catch(()=>setQr(''))},[w.account]);
  return <section className="m-card center"><h2>Receive money</h2><p className="m-muted">Show this code or share your pay ID. Your employer uses it to pay you.</p>
    {qr&&<img className="m-qr" src={qr} alt="QR code of your wallet address" width={240} height={240}/>}
    <p className="m-payid">Pay ID · {w.account?w.account.slice(2,6).toUpperCase()+' '+w.account.slice(-4).toUpperCase():''}</p>
    <details className="m-fine"><summary>Full account number</summary><p className="m-mono">{w.account}</p></details>
    <button className="m-primary wide" onClick={()=>navigator.clipboard.writeText(w.account).then(()=>setCopied(true),()=>setCopied(false))}>{copied?'Copied':'Copy pay ID'}</button></section>;
}

function CashOut({w}){
  useSponsoredGas(w);const p=w.p,[amount,setAmount]=useState(''),[quote,setQuote]=useState(null),[done,setDone]=useState(null);
  useEffect(()=>{let live=true;setQuote(null);let value;try{value=parseAmount(amount)}catch{return}quoteSettlement(p.client,value).then(q=>live&&setQuote(q)).catch(()=>live&&setQuote(0n));return()=>{live=false}},[amount]);
  async function submit(e){e.preventDefault();setDone(null);
    const value=(()=>{try{return parseAmount(amount)}catch(err){w.setError(err.message)}})();if(!value)return;
    const result=await w.run('Preparing Agora Instant Settlement',wallet=>instantSettle({client:p.client,wallet,account:w.account,amount:value,onStep:w.setStatus}));
    if(result){w.addActivity({type:'Instant Settlement AUSD → CTK',amount:'-'+amount,symbol:'AUSD',hash:result.hashes.settle});w.setStatus('');setDone(result);setAmount('');}}
  return <section className="m-card"><h2>Cash out</h2><p className="m-muted">Turn your dollars into local currency instantly, at a fixed 1:1 rate with no fee.</p>
    <form className="m-form" onSubmit={submit}>
      <label>You pay (AUSD)<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00" required/></label>
      <div className="m-quote"><span>You receive</span><b>{quote===null?'—':fmt(quote,18,6)+' local'}</b></div>
      <small className="m-muted">Available: ${w.bal?fmt(w.bal.AUSD,6,2):'…'}</small>
      <button className="m-primary wide" disabled={w.working||quote===0n}>{w.working?'Settling…':'Settle instantly'}</button>
    </form><Feedback w={w}/><GasNote w={w}/>
    {done&&<div className="m-success"><b>Received {done.display} in local currency</b>{done.hashes.whitelist&&<TxLink hash={done.hashes.whitelist}>Registration receipt</TxLink>}{done.hashes.approve&&<TxLink hash={done.hashes.approve}>Authorization receipt</TxLink>}<TxLink hash={done.hashes.settle}>Settlement receipt</TxLink></div>}
    <details className="m-fine"><summary>How it works</summary><p>Settled through Agora Instant Settlement on Monad. The first cash-out also registers your account with Agora and authorizes the amount; later ones are a single step.</p></details><AgoraTrust/></section>;
}

function Recent({w,all=false}){
  const p=w.p,shifts=p.history||[];
  const items=all?w.activity:w.activity.slice(0,4);
  return <section className="m-card"><div className="m-row between"><h3>{all?'Wallet activity':'Recent activity'}</h3>{!all&&<Link className="m-link" href="/employee/history">See all</Link>}</div>
    {items.length?<ul className="m-list">{items.map((a,i)=><li key={a.hash+i}><div><b>{a.type}</b><small>{new Date(a.at).toLocaleString()}</small></div><div className="right"><b className={a.amount.startsWith('-')?'':'pos'}>{a.amount} {a.symbol}</b><TxLink hash={a.hash}>Receipt</TxLink></div></li>)}</ul>:<p className="m-muted">No transactions from this device yet.</p>}
    {all&&<><h3>Verified shifts</h3>{shifts.length?<ul className="m-list">{shifts.map(s=>{const tx=s.attestations.flatMap(a=>a.txs).find(t=>t.hash);return <li key={s.id}><div><b>{s.status==='OPEN'?'Current shift':'Completed shift'}</b><small>{new Date(Number(s.startAt)*1000).toLocaleString()}{s.endAt?' — '+new Date(Number(s.endAt)*1000).toLocaleTimeString():''}</small></div><div className="right">{tx&&<TxLink hash={tx.hash}>Receipt</TxLink>}</div></li>})}</ul>:<p className="m-muted">Link your payroll on Home to see shifts.</p>}</>}
  </section>;
}

function History({w}){return <Recent w={w} all/>}


/** Payslips encrypted with a key derived from a separate passkey namespace; readable on any device with the passkey. */
function Payslips({w}){
  const p=w.p,vault=useRef(null),[slips,setSlips]=useState(null),[busy,setBusy]=useState(''),[error,setError]=useState('');
  async function unlock(){if(!vault.current)vault.current=await unlockPayslipVault();return vault.current;}
  async function open(){setBusy('Unlocking your private payslips…');setError('');try{const v=await unlock();setSlips(await openPayslips(v.key,await p.api('vault/'+v.id)));}catch(e){setError(e.message||'Could not open payslips.');}finally{setBusy('');}}
  async function save(){if(!p.worker||!p.owns){setError('Link your payroll first.');return;}
    setBusy('Encrypting this payslip on your device…');setError('');
    try{const v=await unlock(),x=p.worker,existing=await openPayslips(v.key,await p.api('vault/'+v.id));
      const slip={at:Date.now(),employeeId:p.selected,company:p.dashboard?.company?.name||'',rate:p.units(x.worker.ratePerHour)+'/h',gross:p.units(BigInt(x.earned.net)+BigInt(x.earned.tax)),tax:p.units(x.earned.tax),withdrawn:p.units(x.worker.withdrawn),available:p.units(x.claimable)};
      const next=[slip,...existing].slice(0,60),sealed=await sealPayslips(v.key,next);
      await p.api('vault',{id:v.id,...sealed});setSlips(next);}
    catch(e){setError(e.message||'Could not save payslip.');}finally{setBusy('');}}
  return <section className="m-card"><h3>Private payslips</h3>
    <p className="m-muted">Encrypted on this phone with a key only your passkey can recreate. ShiftPay stores unreadable data, not linked to your wallet. Open them on any device with the same passkey.</p>
    <div className="m-row"><button className="m-primary" disabled={!!busy} onClick={save}>Save today's payslip</button><button className="m-ghost" disabled={!!busy} onClick={open}>Open payslips</button></div>
    {busy&&<p className="m-alert" role="status">{busy}</p>}{error&&<p className="m-alert error" role="alert">{error}</p>}
    {slips&&(slips.length?<ul className="m-list">{slips.map(s=><li key={s.at}><div><b>{new Date(s.at).toLocaleString()}</b><small>{s.company||'Employee '+s.employeeId} · {s.rate}</small></div><div className="right"><b>{s.gross}</b><small>tax {s.tax} · taken {s.withdrawn}</small></div></li>)}</ul>:<p className="m-muted">No payslips saved yet.</p>)}
  </section>;
}

function Profile({w}){
  const p=w.p,profile=p.dashboard?.workers?.find(r=>r.workerId===p.selected)?.profile;
  return <section className="m-card"><h2>{profile?.name||'Your account'}</h2>{profile&&<p className="m-muted">{profile.role} · {profile.department}</p>}
    {profile?.notes&&<p className="m-alert">{profile.notes}</p>}
    <dl className="m-dl"><dt>Pay ID</dt><dd>{w.account?w.account.slice(2,6).toUpperCase()+' '+w.account.slice(-4).toUpperCase():''}</dd><dt>Sign-in</dt><dd>Passkey (face, fingerprint or PIN), works on any of your devices</dd>
      {p.worker&&<><dt>Employee ID</dt><dd>{p.selected}</dd><dt>Hourly rate</dt><dd>{p.units(p.worker.worker.ratePerHour)}</dd><dt>Withholding</dt><dd>{Number(p.worker.worker.withholdingBps)/100}%</dd></>}</dl>
    <details className="m-form"><summary>Advanced</summary><label>Payroll currency<select value={p.asset} disabled={p.busy||!!p.pending} onChange={e=>p.setAsset(e.target.value)}><option>AUSD</option><option>USDC</option></select></label></details>
    {(p.owns)&&<button className="m-ghost wide" disabled={p.busy} onClick={()=>p.loadDashboard()}>Load company notes (signature, no funds move)</button>}
    <button className="m-ghost wide" onClick={()=>p.logout().catch(()=>{})}>Sign out</button></section>;
}

function ProfileScreen({w}){return <><Profile w={w}/><Payslips w={w}/></>;
}

export default function WalletApp({section=''}){
  const p=usePayroll(),w=useWallet();
  const signedIn=p.authenticated&&p.wallet;
  const screen={send:Send,receive:Receive,cashout:CashOut,history:History,profile:ProfileScreen}[section]||Home;
  return <div className="m-shell"><div className="m-phone">
    <header className="m-top"><span className="m-logo small">S</span><b>ShiftPay</b><a className="m-pitch" href={pitchUrl} target="_blank" rel="noreferrer">▶ Pitch</a></header>
    <main className="m-main">{!signedIn?<Login/>:React.createElement(screen,{w})}
      {p.error&&signedIn&&!p.error.includes('pending')&&<p className="m-alert error">{p.error}</p>}
      {p.notice&&signedIn&&<p className="m-alert">{p.notice}</p>}</main>
    {signedIn&&<nav className="m-tabs" aria-label="Employee navigation">{tabs.map(([key,label,icon])=><Link key={key} href={'/employee'+(key?'/'+key:'')} aria-current={section===key?'page':undefined}><i>{icon}</i>{label}</Link>)}</nav>}
  </div></div>;
}
