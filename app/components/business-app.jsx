'use client';
// Business payroll dashboard: one sign-in step, then a sidebar of payroll tasks backed by the vault and bridge.
import React,{useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {erc20Abi,formatUnits} from 'viem';
import {usePayroll} from './payroll.jsx';
import {PaymentLedger,ProfileEditor} from './business.jsx';
import {testnetTokens} from '../lib/testnet-tokens.mjs';
import {requestAusd} from '../lib/agora.mjs';

const nav=[['','Overview','◧'],['employees','Employees','☺'],['shifts','Shifts','◷'],['funding','Funding','◈'],['payments','Payments','☰'],['settings','Settings','⚙']];
const short=a=>a?a.slice(0,6)+'…'+a.slice(-4):'';
const status=w=>w.worker.flags!==1?['Suspended','off']:w.worker.clockInAt!=='0'?['On shift','on']:['Off shift','idle'];
const gross=w=>BigInt(w.earned.net)+BigInt(w.earned.tax);
const name=w=>w.profile?.name||'Employee '+w.workerId;

function SignIn(){
  const p=usePayroll();
  return <div className="b-signin"><div className="b-signin-card">
    <div className="b-logo">S</div><h1>ShiftPay for Business</h1>
    <p>Fund payroll, verify shifts and pay employees as they earn on Monad.</p>
    <button className="b-primary wide" disabled={p.busy} onClick={()=>p.startMera(false)}>{p.busy?'Waiting for passkey…':'Unlock company passkey'}</button>
    {p.error&&<p className="b-alert error">{p.error}</p>}
    <p className="b-muted">New company? <Link href="/deploy">Create a company passkey and payroll</Link></p>
    <p className="b-fine">Secured by a Mera passkey bound to this site. No wallet extension or seed phrase.</p>
  </div></div>;
}

function useCompanyBalances(){
  const p=usePayroll(),[bal,setBal]=useState(null);
  async function load(){
    if(!p.wallet)return;
    const [mon,...tokens]=await Promise.all([p.client.getBalance({address:p.wallet.address}),...Object.values(testnetTokens).map(t=>p.client.readContract({address:t.address,abi:erc20Abi,functionName:'balanceOf',args:[p.wallet.address]}))]);
    setBal({MON:mon,...Object.fromEntries(Object.keys(testnetTokens).map((s,i)=>[s,tokens[i]]))});
  }
  useEffect(()=>{load().catch(()=>{});const t=setInterval(()=>load().catch(()=>{}),10000);return()=>clearInterval(t)},[p.wallet?.address]);
  return [bal,load];
}

function Card({label,value,note,tone}){return <article className={'b-stat'+(tone?' '+tone:'')}><span>{label}</span><strong>{value}</strong>{note&&<small>{note}</small>}</article>}

function Totals({workers}){
  const p=usePayroll(),sum=f=>workers.reduce((a,w)=>a+BigInt(f(w)),0n);
  const active=workers.filter(w=>w.worker.flags===1),on=active.filter(w=>w.worker.clockInAt!=='0');
  return <div className="b-stats">
    <Card label="Funded payroll" value={p.units(sum(w=>w.worker.funded))}/>
    <Card label="Earned so far" value={p.units(sum(gross))}/>
    <Card label="Available to employees" value={p.units(sum(w=>w.claimable))}/>
    <Card label="Withdrawn" value={p.units(sum(w=>w.worker.withdrawn))}/>
    <Card label="Tax escrow" value={p.units(p.dashboard?.heldTax??0)}/>
    <Card label="Employees" value={active.length} note={on.length+' on shift'}/>
  </div>;
}

function EmployeeTable({workers,onOpen,actions=false}){
  const p=usePayroll();
  if(!workers.length)return <div className="b-empty"><h3>No employees yet</h3><p>Add your first employee to start paying wages as they work.</p><Link className="b-primary" href="/employer/employees?add=1">Add employee</Link></div>;
  return <div className="b-table"><table><thead><tr><th>Employee</th><th>Status</th><th>Rate</th><th>Earned</th><th>Available</th><th>Funded</th><th></th></tr></thead><tbody>
    {workers.map(w=>{const [label,tone]=status(w);return <tr key={w.workerId}><td><b>{name(w)}</b><small>ID {w.workerId} · {w.profile?.role||short(w.worker.payoutAddr)}</small></td><td><span className={'b-pill '+tone}>{label}</span></td><td>{p.units(w.worker.ratePerHour)}/h</td><td>{p.units(gross(w))}</td><td>{p.units(w.claimable)}</td><td>{p.units(w.worker.funded)}</td>
      <td className="right">{actions&&w.worker.flags===1?<button className="b-small" disabled={p.busy||!!p.pending} onClick={()=>onOpen(w)}>{w.worker.clockInAt==='0'?'Start shift…':'End shift…'}</button>:<button className="b-small ghost" onClick={()=>onOpen(w)}>Open</button>}</td></tr>})}
  </tbody></table></div>;
}

function AddEmployee({onDone}){
  const p=usePayroll(),[f,setF]=useState({name:'',role:'',department:'',notes:'',allocation:''}),[gas,setGas]=useState(true);
  const set=k=>e=>setF({...f,[k]:e.target.value});
  return <section className="b-card"><div className="b-head"><h2>Add employee</h2><button className="b-small ghost" onClick={onDone}>Close</button></div>
    <p className="b-muted">The employee creates a passkey in the ShiftPay employee app and shares the address from <b>Receive</b>. Registration, funding and profile are saved in sequence.</p>
    <form className="b-form" onSubmit={async e=>{await p.register(e,{name:f.name,role:f.role,department:f.department,notes:f.notes},f.allocation,gas);}}>
      <label>Full name<input required maxLength={100} value={f.name} onChange={set('name')}/></label>
      <label>Role<input required maxLength={100} value={f.role} onChange={set('role')}/></label>
      <label>Department<input required maxLength={100} value={f.department} onChange={set('department')}/></label>
      <label>Employee ID<input required inputMode="numeric" value={p.workerId} onChange={e=>p.setWorkerId(e.target.value)} placeholder="e.g. 1"/></label>
      <label className="span">Employee wallet address<input required value={p.payout} onChange={e=>p.setPayout(e.target.value.trim())} placeholder="0x… from the employee app"/></label>
      <label>Hourly rate ({p.asset})<input required inputMode="decimal" value={p.rate} onChange={e=>p.setRate(e.target.value)} placeholder="5"/></label>
      <label>Tax withholding (%)<input required inputMode="decimal" value={p.bps===''?'':Number(p.bps)/100} onChange={e=>p.setBps(e.target.value===''?'':String(Math.round(Number(e.target.value)*100)))} placeholder="10"/></label>
      <label>Initial allocation ({p.asset})<input required inputMode="decimal" value={f.allocation} onChange={set('allocation')} placeholder="10"/></label>
      <label className="span">Notes for the employee<textarea rows={2} maxLength={2000} value={f.notes} onChange={set('notes')}/></label>
      <label className="b-check span"><input type="checkbox" checked={gas} onChange={e=>setGas(e.target.checked)}/>Send 0.1 test MON so the employee can pay network fees to send and cash out AUSD</label>
      <p className="b-fine span">Withholding is a company-chosen reserve rate held in escrow; ShiftPay does not calculate statutory tax.</p>
      <button className="b-primary span" disabled={p.busy||!!p.pending}>{p.busy?'Confirming on Monad…':'Register and fund employee'}</button>
    </form></section>;
}

function EmployeeDetail({w,onClose}){
  const p=usePayroll(),[amount,setAmount]=useState('');
  const loaded=p.worker&&p.selected===w.workerId;
  const x=loaded?{...w,worker:p.worker.worker,claimable:p.worker.claimable,earned:p.worker.earned,runwaySeconds:p.worker.runwaySeconds}:w;
  const [label,tone]=status(x),on=x.worker.clockInAt!=='0';
  return <section className="b-card"><div className="b-head"><div><h2>{name(w)}</h2><p className="b-muted">ID {w.workerId} · {w.profile?.role||'—'} · {w.profile?.department||'—'}</p></div><span className={'b-pill '+tone}>{label}</span></div>
    <div className="b-stats small"><Card label="Available now" value={p.units(x.claimable)}/><Card label="Earned" value={p.units(gross(x))}/><Card label="Funded" value={p.units(x.worker.funded)}/><Card label="Runway" value={(Number(x.runwaySeconds)/3600).toFixed(2)+' h'} tone={Number(x.runwaySeconds)<7200?'warn':''}/></div>
    <dl className="b-dl"><dt>Wallet</dt><dd className="mono">{x.worker.payoutAddr}</dd><dt>Rate</dt><dd>{p.units(x.worker.ratePerHour)} / hour</dd><dt>Withholding</dt><dd>{Number(x.worker.withholdingBps)/100}%</dd>{w.profile?.notes&&<><dt>Notes</dt><dd>{w.profile.notes}</dd></>}</dl>
    {!loaded?<p className="b-muted">Loading live payroll state…</p>:<div className="b-actions">
      <button className="b-primary" disabled={p.disabled||x.worker.flags!==1} onClick={()=>p.clock(on?'clock_out':'clock_in')}>{on?'End verified shift':'Start verified shift'}</button>
      <form className="b-inline" onSubmit={e=>{e.preventDefault();p.fund(amount)}}><input inputMode="decimal" placeholder={'Add '+p.asset} value={amount} onChange={e=>setAmount(e.target.value)} required/><button disabled={p.disabled}>Fund</button></form>
      <button className="b-small ghost" disabled={p.disabled} onClick={()=>p.execute(()=>p.direct(x.worker.flags===1?'suspend':'reinstate',[BigInt(w.workerId)],x.worker.flags===1?'Suspend employee':'Reinstate employee'))}>{x.worker.flags===1?'Suspend':'Reinstate'}</button>
      <button className="b-small ghost" onClick={onClose}>Back</button></div>}
    {p.pending&&<p className="b-alert">{p.pending.label}: confirming on Monad…</p>}
  </section>;
}

function Funding({bal,reload}){
  const p=usePayroll(),[busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[copied,setCopied]=useState(false);
  async function faucet(){setBusy(true);setMsg('');try{const w=await p.walletClient();const hash=await requestAusd({client:p.client,wallet:w,account:p.wallet.address});setMsg('Agora faucet sent 10,000 test AUSD · '+hash);await reload();}catch(e){setMsg(e.shortMessage||e.message)}finally{setBusy(false)}}
  return <section className="b-card"><h2>Company wallet</h2><p className="b-muted">Payroll is funded from this passkey account. Allocate funds to employees from their profile.</p>
    <div className="b-stats small">{['USDC','AUSD','MON'].map(s=><Card key={s} label={s} value={bal?Number(formatUnits(bal[s],s==='MON'?18:6)).toLocaleString(undefined,{maximumFractionDigits:4}):'…'}/>)}</div>
    <p className="mono">{p.wallet.address}</p>
    <div className="b-actions"><button className="b-small ghost" onClick={()=>navigator.clipboard.writeText(p.wallet.address).then(()=>setCopied(true)).catch(()=>{})}>{copied?'Copied':'Copy address'}</button>
      <button className="b-small" disabled={busy} onClick={faucet}>{busy?'Requesting…':'Get 10,000 test AUSD (Agora)'}</button>
      <a className="b-small ghost" href={testnetTokens.USDC.faucet} target="_blank" rel="noreferrer">Get test USDC</a></div>
    {msg&&<p className="b-alert mono">{msg}</p>}</section>;
}

export default function BusinessApp({section=''}){
  const p=usePayroll(),[bal,reload]=useCompanyBalances(),[open,setOpen]=useState(null),[adding,setAdding]=useState(false),requested=useRef('');
  const signedIn=p.authenticated&&p.wallet;
  useEffect(()=>{setAdding(typeof window!=='undefined'&&new URLSearchParams(location.search).has('add'));setOpen(null)},[section]);
  // Load the signed dashboard once per account and currency; the passkey signs without a prompt.
  useEffect(()=>{const key=p.wallet?.address+':'+p.asset+':'+(p.meraWallet?.session?'s':'');if(p.admin&&!p.dashboard&&!p.busy&&requested.current!==key){requested.current=key;p.loadDashboard();}},[p.admin,p.dashboard,p.asset,p.busy,p.meraWallet]);
  useEffect(()=>{if(!p.wallet)requested.current='';},[p.wallet]);
  async function openWorker(w){setOpen(w);await p.choose({preventDefault(){}},w.workerId);}
  if(!signedIn)return <SignIn/>;
  const workers=p.dashboard?.workers||[];
  const title=nav.find(([k])=>k===section)?.[1]||'Overview';
  let body;
  if(!p.cfg)body=<section className="b-card"><h2>{p.asset} payroll not connected</h2><p className="b-muted">{p.error||'Connecting…'}</p><div className="b-actions"><button className="b-small" onClick={p.configure}>Retry</button><Link className="b-small ghost" href="/deploy">Set up {p.asset} payroll</Link></div></section>;
  else if(!p.admin)body=<section className="b-card"><h2>Not the payroll administrator</h2><p className="b-muted">This passkey account ({short(p.wallet.address)}) is not the registered company account ({short(p.cfg.admin)}).</p></section>;
  else if(!p.dashboard)body=<section className="b-card"><h2>Loading payroll…</h2><p className="b-muted">{p.busy?'Reading verified payroll records…':p.dashboardError||p.error||'Payroll records are not loaded.'}</p><button className="b-small" disabled={p.busy} onClick={()=>p.loadDashboard()}>{p.busy?'Loading…':'Load payroll'}</button></section>;
  else if(open)body=<EmployeeDetail w={workers.find(w=>w.workerId===open.workerId)||open} onClose={()=>setOpen(null)}/>;
  else if(section==='employees')body=<>{adding?<AddEmployee onDone={()=>setAdding(false)}/>:<div className="b-toolbar"><button className="b-primary" onClick={()=>setAdding(true)}>+ Add employee</button></div>}<section className="b-card"><h2>Employees</h2><EmployeeTable workers={workers} onOpen={openWorker}/></section></>;
  else if(section==='shifts')body=<section className="b-card"><h2>Shifts</h2><p className="b-muted">Start and end verified shifts. Each one is signed by your company passkey and settled on Monad.</p><EmployeeTable workers={workers} onOpen={openWorker} actions/></section>;
  else if(section==='funding')body=<><Funding bal={bal} reload={reload}/><section className="b-card"><h2>Employee allocations</h2><EmployeeTable workers={workers} onOpen={openWorker}/></section></>;
  else if(section==='payments')body=<div className="b-legacy"><PaymentLedger/></div>;
  else if(section==='settings')body=<><div className="b-legacy"><ProfileEditor/></div><section className="b-card"><h2>Payroll contract</h2><dl className="b-dl"><dt>Vault</dt><dd className="mono">{p.cfg.vault}</dd><dt>Token</dt><dd className="mono">{p.cfg.token}</dd><dt>Tax recipient</dt><dd className="mono">{p.cfg.taxAddress}</dd><dt>Employer ID</dt><dd>{p.cfg.employerId}</dd></dl><Link className="b-small ghost" href="/deploy">Company setup</Link></section></>;
  else body=<><Totals workers={workers}/><div className="b-grid"><section className="b-card"><div className="b-head"><h2>Workforce</h2><Link className="b-small ghost" href="/employer/employees">Manage</Link></div><EmployeeTable workers={workers.slice(0,6)} onOpen={openWorker}/></section><Funding bal={bal} reload={reload}/></div></>;
  return <div className="b-shell">
    <aside className="b-side"><Link className="b-brand" href="/employer"><span className="b-logo small">S</span>ShiftPay</Link>
      <nav aria-label="Business navigation">{nav.map(([k,l,i])=><Link key={k} href={'/employer'+(k?'/'+k:'')} aria-current={section===k?'page':undefined}><i>{i}</i>{l}</Link>)}</nav>
      <div className="b-account"><span>Company account</span><b className="mono">{short(p.wallet.address)}</b><button className="b-small ghost" onClick={()=>p.logout().catch(()=>{})}>Sign out</button></div></aside>
    <main className="b-main"><header className="b-top"><div><p className="b-eyebrow">{p.dashboard?.company?.name||'Business payroll'}</p><h1>{title}</h1></div>
      <label className="b-currency">Currency<select value={p.asset} disabled={p.busy||!!p.pending} onChange={e=>{requested.current='';p.setAsset(e.target.value)}}><option>USDC</option><option>AUSD</option></select></label></header>
      {p.error&&p.cfg&&<p className="b-alert error">{p.error}</p>}{p.notice&&<p className="b-alert mono">{p.notice}</p>}
      {body}</main></div>;
}
