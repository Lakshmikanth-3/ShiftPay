'use client';
// Employee mobile wallet: payroll wages plus AUSD send, receive and Agora Instant Settlement.
import React,{useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {formatUnits} from 'viem';
import {usePayroll} from './payroll.jsx';
import PasskeyAccess from './passkey-access.jsx';
import {testnetTokens} from '../lib/testnet-tokens.mjs';
import {pitchUrl} from '../lib/pitch.mjs';
import {agora,balances,instantSettle,parseAmount,quoteSettlement,requestAusd,sendToken} from '../lib/agora.mjs';

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

function TxLink({hash,children='View on explorer'}){return hash?<a className="m-link" href={explorer(hash)} target="_blank" rel="noreferrer">{children} ↗</a>:null}
function Feedback({w}){return <>{w.error&&<p className="m-alert error" role="alert">{w.error}</p>}{w.status&&!w.error&&<p className="m-alert" role="status">{w.status}</p>}</>}
function GasNote({w}){return w.bal&&w.bal.MON===0n?<p className="m-alert warn">This account needs a little test MON for network fees. Ask your employer, or use <a href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">faucet.monad.xyz</a>.</p>:null}

function Login(){
  const p=usePayroll();
  return <div className="m-login"><div className="m-logo">S</div><h1>ShiftPay</h1><p>Your wages, as you earn them. Send AUSD anywhere in seconds.</p>
    <div className="m-card"><PasskeyAccess allowCreate/></div>
    <button className="m-ghost" disabled={!p.ready} onClick={p.login}>Continue with email instead</button>
    <p className="m-fine">Secured by a Mera passkey on this device. No seed phrase, no wallet pop-ups.</p></div>;
}

function Wages({w}){
  const p=w.p,[id,setId]=useState('');
  const key=w.account?'shiftpay:worker:'+w.account.toLowerCase():null;
  useEffect(()=>{if(!key||!p.cfg||p.selected)return;let saved=null;try{saved=localStorage.getItem(key)}catch{}if(saved){p.setWorkerId(saved);p.choose({preventDefault(){}},saved)}},[key,p.cfg]);
  useEffect(()=>{if(key&&p.owns&&p.selected)try{localStorage.setItem(key,p.selected)}catch{}},[key,p.owns,p.selected]);
  const dialog=useRef(null);
  if(!p.cfg)return <section className="m-card"><h3>Payroll</h3><p className="m-muted">{p.error?.includes('pending')?'Your employer has not connected '+p.asset+' payroll yet.':p.error||'Connecting to payroll…'}</p><button className="m-ghost" onClick={p.configure}>Retry</button></section>;
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
  const p=w.p,b=w.bal;
  async function faucet(){const hash=await w.run('Requesting test AUSD from Agora',wallet=>requestAusd({client:p.client,wallet,account:w.account}));if(hash){w.addActivity({type:'Received from Agora faucet',amount:'10,000',symbol:'AUSD',hash});w.setStatus('10,000 test AUSD received.')}}
  return <>
    <section className="m-balance"><p>Wallet balance</p><strong>{b?fmt(b.AUSD,6):'…'} <small>AUSD</small></strong>
      <div className="m-sub">{b&&<>{fmt(b.USDC,6)} USDC · {fmt(b.CTK,18)} CTK · {fmt(b.MON,18,3)} MON</>}</div>
      <div className="m-address" title={w.account}>{short(w.account)}</div></section>
    <nav className="m-actions" aria-label="Quick actions">
      <Link href="/employee/send"><i>↗</i>Send</Link>
      <Link href="/employee/receive"><i>↙</i>Receive</Link>
      <Link href="/employee/cashout"><i>⇄</i>Cash out</Link>
      <button onClick={faucet} disabled={w.working}><i>＋</i>Get AUSD</button>
    </nav>
    <Feedback w={w}/><GasNote w={w}/>
    <Wages w={w}/>
    <Recent w={w}/>
  </>;
}

function Send({w}){
  const p=w.p,[to,setTo]=useState(''),[amount,setAmount]=useState(''),[symbol,setSymbol]=useState('AUSD'),[note,setNote]=useState(''),[done,setDone]=useState(null);
  const token=tokenList.find(t=>t.symbol===symbol);
  async function submit(e){e.preventDefault();setDone(null);
    const value=(()=>{try{return parseAmount(amount,token.decimals)}catch(err){w.setError(err.message)}})();if(!value)return;
    const hash=await w.run('Sending '+amount+' '+symbol,wallet=>sendToken({client:p.client,wallet,account:w.account,token:token.address,to,amount:value}));
    if(hash){w.addActivity({type:'Sent to '+short(to)+(note?' · '+note:''),amount:'-'+amount,symbol,hash});w.setStatus('');setDone({hash,amount,to});setAmount('');}}
  return <section className="m-card"><h2>Send money</h2><p className="m-muted">Send to family or anyone, anywhere. Settles on Monad in about a second.</p>
    <form className="m-form" onSubmit={submit}>
      <label>Recipient address<input value={to} onChange={e=>setTo(e.target.value.trim())} placeholder="0x…" required autoComplete="off"/></label>
      <label>Amount<div className="m-row"><input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00" required/><select value={symbol} onChange={e=>setSymbol(e.target.value)}><option>AUSD</option><option>USDC</option></select></div></label>
      <small className="m-muted">Balance: {w.bal?fmt(w.bal[symbol],token.decimals,6):'…'} {symbol}</small>
      <label>Note (optional, kept on this device)<input maxLength={80} value={note} onChange={e=>setNote(e.target.value)}/></label>
      <button className="m-primary wide" disabled={w.working}>{w.working?'Sending…':'Send '+symbol}</button>
    </form><Feedback w={w}/><GasNote w={w}/>
    {done&&<div className="m-success"><b>Sent {done.amount} {symbol}</b><p>To {short(done.to)}</p><TxLink hash={done.hash}/></div>}</section>;
}

function Receive({w}){
  const [qr,setQr]=useState(''),[copied,setCopied]=useState(false);
  useEffect(()=>{if(!w.account)return;import('qrcode').then(QR=>QR.toDataURL(w.account,{margin:1,width:240})).then(setQr).catch(()=>setQr(''))},[w.account]);
  return <section className="m-card center"><h2>Receive</h2><p className="m-muted">Share this address to receive AUSD or USDC on Monad testnet.</p>
    {qr&&<img className="m-qr" src={qr} alt="QR code of your wallet address" width={240} height={240}/>}
    <p className="m-mono">{w.account}</p>
    <button className="m-primary wide" onClick={()=>navigator.clipboard.writeText(w.account).then(()=>setCopied(true),()=>setCopied(false))}>{copied?'Copied':'Copy address'}</button></section>;
}

function CashOut({w}){
  const p=w.p,[amount,setAmount]=useState(''),[quote,setQuote]=useState(null),[done,setDone]=useState(null);
  useEffect(()=>{let live=true;setQuote(null);let value;try{value=parseAmount(amount)}catch{return}quoteSettlement(p.client,value).then(q=>live&&setQuote(q)).catch(()=>live&&setQuote(0n));return()=>{live=false}},[amount]);
  async function submit(e){e.preventDefault();setDone(null);
    const value=(()=>{try{return parseAmount(amount)}catch(err){w.setError(err.message)}})();if(!value)return;
    const result=await w.run('Preparing Agora Instant Settlement',wallet=>instantSettle({client:p.client,wallet,account:w.account,amount:value,onStep:w.setStatus}));
    if(result){w.addActivity({type:'Instant Settlement AUSD → CTK',amount:'-'+amount,symbol:'AUSD',hash:result.hashes.settle});w.setStatus('');setDone(result);setAmount('');}}
  return <section className="m-card"><h2>Cash out</h2><p className="m-muted">Convert AUSD instantly at Agora's fixed price through the Instant Settlement pair. No slippage, no order book.</p>
    <form className="m-form" onSubmit={submit}>
      <label>You pay (AUSD)<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00" required/></label>
      <div className="m-quote"><span>You receive</span><b>{quote===null?'—':fmt(quote,18,6)+' CTK'}</b></div>
      <small className="m-muted">Balance: {w.bal?fmt(w.bal.AUSD,6,6):'…'} AUSD · Pair {short(agora.pair)}</small>
      <button className="m-primary wide" disabled={w.working||quote===0n}>{w.working?'Settling…':'Settle instantly'}</button>
    </form><Feedback w={w}/><GasNote w={w}/>
    {done&&<div className="m-success"><b>Received {done.display} CTK</b>{done.hashes.whitelist&&<TxLink hash={done.hashes.whitelist}>Agora registration</TxLink>}{done.hashes.approve&&<TxLink hash={done.hashes.approve}>Authorization</TxLink>}<TxLink hash={done.hashes.settle}>Settlement</TxLink></div>}
    <p className="m-fine">First use registers this account with Agora's testnet whitelister, then authorizes AUSD. Testnet supports AUSD → CTK only.</p></section>;
}

function Recent({w,all=false}){
  const p=w.p,shifts=p.history||[];
  const items=all?w.activity:w.activity.slice(0,4);
  return <section className="m-card"><div className="m-row between"><h3>{all?'Wallet activity':'Recent activity'}</h3>{!all&&<Link className="m-link" href="/employee/history">See all</Link>}</div>
    {items.length?<ul className="m-list">{items.map((a,i)=><li key={a.hash+i}><div><b>{a.type}</b><small>{new Date(a.at).toLocaleString()}</small></div><div className="right"><b className={a.amount.startsWith('-')?'':'pos'}>{a.amount} {a.symbol}</b><TxLink hash={a.hash}>Tx</TxLink></div></li>)}</ul>:<p className="m-muted">No transactions from this device yet.</p>}
    {all&&<><h3>Verified shifts</h3>{shifts.length?<ul className="m-list">{shifts.map(s=>{const tx=s.attestations.flatMap(a=>a.txs).find(t=>t.hash);return <li key={s.id}><div><b>{s.status==='OPEN'?'Current shift':'Completed shift'}</b><small>{new Date(Number(s.startAt)*1000).toLocaleString()}{s.endAt?' — '+new Date(Number(s.endAt)*1000).toLocaleTimeString():''}</small></div><div className="right">{tx&&<TxLink hash={tx.hash}>Tx</TxLink>}</div></li>})}</ul>:<p className="m-muted">Link your payroll on Home to see shifts.</p>}</>}
  </section>;
}

function History({w}){return <Recent w={w} all/>}

function Profile({w}){
  const p=w.p,profile=p.dashboard?.workers?.find(r=>r.workerId===p.selected)?.profile;
  return <section className="m-card"><h2>{profile?.name||'Your account'}</h2>{profile&&<p className="m-muted">{profile.role} · {profile.department}</p>}
    {profile?.notes&&<p className="m-alert">{profile.notes}</p>}
    <dl className="m-dl"><dt>Wallet</dt><dd className="m-mono">{w.account}</dd><dt>Sign-in</dt><dd>{p.wallet?.walletClientType==='mera'?'Mera passkey':'Email account'}</dd>
      {p.worker&&<><dt>Employee ID</dt><dd>{p.selected}</dd><dt>Hourly rate</dt><dd>{p.units(p.worker.worker.ratePerHour)}</dd><dt>Withholding</dt><dd>{Number(p.worker.worker.withholdingBps)/100}%</dd></>}</dl>
    <label className="m-form">Payroll currency<select value={p.asset} disabled={p.busy||!!p.pending} onChange={e=>p.setAsset(e.target.value)}><option>AUSD</option><option>USDC</option></select></label>
    {(p.owns)&&<button className="m-ghost wide" disabled={p.busy} onClick={()=>p.loadDashboard()}>Load company notes (signature, no funds move)</button>}
    <button className="m-ghost wide" onClick={()=>p.logout().catch(()=>{})}>Sign out</button></section>;
}

export default function WalletApp({section=''}){
  const p=usePayroll(),w=useWallet();
  const signedIn=p.authenticated&&p.wallet;
  const screen={send:Send,receive:Receive,cashout:CashOut,history:History,profile:Profile}[section]||Home;
  return <div className="m-shell"><div className="m-phone">
    <header className="m-top"><span className="m-logo small">S</span><b>ShiftPay</b><a className="m-pitch" href={pitchUrl} target="_blank" rel="noreferrer">▶ Pitch</a><span className="m-net">Testnet</span></header>
    <main className="m-main">{!signedIn?<Login/>:React.createElement(screen,{w})}
      {p.error&&signedIn&&!p.error.includes('pending')&&<p className="m-alert error">{p.error}</p>}
      {p.notice&&signedIn&&<p className="m-alert">{p.notice}</p>}</main>
    {signedIn&&<nav className="m-tabs" aria-label="Employee navigation">{tabs.map(([key,label,icon])=><Link key={key} href={'/employee'+(key?'/'+key:'')} aria-current={section===key?'page':undefined}><i>{icon}</i>{label}</Link>)}</nav>}
  </div></div>;
}
