'use client';
import dynamic from 'next/dynamic';
const Payroll=dynamic(()=>import('./payroll.jsx'),{ssr:false,loading:()=> <div className="splash" role="status"><img className="splash-logo" src="/logo-mark.png" alt="" width="56" height="56"/><b>ShiftPay</b><small>Loading secure payroll…</small></div>});
export default function Providers({children}){return <Payroll>{children}</Payroll>}
