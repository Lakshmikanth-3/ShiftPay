import {notFound} from 'next/navigation';
import WalletApp from '../../../wallet-app.jsx';
const sections=['','send','receive','cashout','history','profile'];
export default async function Page({params}){const {section=[]}=await params;if(process.env.METRONOME_PRODUCT==='employer'||section.length>1||!sections.includes(section[0]||''))notFound();return <WalletApp section={section[0]||''}/>}
