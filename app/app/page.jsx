import {redirect} from 'next/navigation';
import {Landing} from '../components/product.jsx';
export default function Page(){const product=process.env.METRONOME_PRODUCT;if(product==='employee'||product==='employer')redirect('/'+product);return <Landing/>}
