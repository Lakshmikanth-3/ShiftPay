'use client';
import {usePayroll} from './payroll.jsx';
import {useState} from 'react';
export default function PasskeyAccess({allowCreate=false,name='',disabled=false,company=false}){
  const p=usePayroll();
  const [accountName,setAccountName]=useState('');
  const displayName=name||accountName;
  const blocked=disabled||p.busy||!!p.pending;
  return <div className="passkey-access"><p><strong>Payroll passkey</strong></p>
    {p.meraWallet?<><p className="address">{p.meraWallet.address}</p><p className="muted">Passkey unlocked. Payroll actions use this account when selected. The signing session ends after 15 minutes or when you sign out.</p><button disabled={blocked} onClick={()=>p.setWalletAddress(p.meraWallet.address)}>Use passkey account</button></>:
      <>{allowCreate&&!name&&!company&&<label>Account name<input maxLength={100} autoComplete="name" value={accountName} disabled={blocked} onChange={e=>setAccountName(e.target.value)}/></label>}<div className="actions"><button disabled={blocked} onClick={()=>p.startMera(false)}>Unlock payroll passkey</button>{allowCreate&&<button disabled={blocked||!displayName.trim()} onClick={()=>p.startMera(true,displayName)}>Create payroll passkey</button>}</div></>}
    {allowCreate&&<p className="muted">Creating a passkey creates your payroll account. Existing wallet balances stay in their original accounts. {company?'Fund this account before registering payroll.':'Your employer must register this account before you can access wages.'}</p>}
    <p className="muted">Passkeys belong to this website. A localhost passkey does not unlock an account on the published dashboard.</p>
  </div>;
}
