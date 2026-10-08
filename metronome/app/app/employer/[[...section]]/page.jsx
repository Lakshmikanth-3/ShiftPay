import {notFound} from 'next/navigation';
import Product from '../../../product.jsx';
export default async function Page({params}){const {section=[]}=await params;if(process.env.METRONOME_PRODUCT==='employee'||section.length>1||!['','employees','payroll','funding','payments','shifts','reports','settings'].includes(section[0]||''))notFound();return <Product role="employer" section={section[0]||''}/>}
