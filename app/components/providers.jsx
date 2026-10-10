'use client';
import dynamic from 'next/dynamic';
const Payroll=dynamic(()=>import('./payroll.jsx'),{ssr:false,loading:()=> <div className="splash" role="status"><span className="splash-logo">S</span><b>ShiftPay</b><small>Loading secure payroll…</small></div>});
export default function Providers({children}){return <Payroll>{children}</Payroll>}
