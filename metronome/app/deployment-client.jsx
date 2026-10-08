'use client';
import dynamic from 'next/dynamic';
const Deployment=dynamic(()=>import('./deployment.jsx'),{ssr:false,loading:()=> <main><p>Loading company setup…</p></main>});
export default function DeploymentClient(){return <Deployment/>;}
