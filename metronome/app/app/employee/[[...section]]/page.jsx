import {notFound} from 'next/navigation';
import Product from '../../../product.jsx';
export default async function Page({params}){const {section=[]}=await params;if(process.env.METRONOME_PRODUCT==='employer'||section.length>1||!['','earnings','shifts','payments','profile'].includes(section[0]||''))notFound();return <Product role="employee" section={section[0]||''}/>}
