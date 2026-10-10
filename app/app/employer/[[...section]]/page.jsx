import {notFound} from 'next/navigation';
import BusinessApp from '../../../components/business-app.jsx';
const sections=['','employees','payroll','funding','payments','shifts','reports','settings'];
export default async function Page({params}){const {section=[]}=await params;if(process.env.METRONOME_PRODUCT==='employee'||section.length>1||!sections.includes(section[0]||''))notFound();return <BusinessApp section={section[0]||''}/>}
