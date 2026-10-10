'use client';
import dynamic from 'next/dynamic';
const Payroll=dynamic(()=>import('./payroll.jsx'),{ssr:false,loading:()=> <main><p>Connecting ShiftPay…</p></main>});
export default function Providers({children}){return <Payroll>{children}</Payroll>}
