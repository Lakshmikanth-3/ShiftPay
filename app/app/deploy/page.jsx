import {notFound} from 'next/navigation';
import DeploymentClient from '../../components/deployment-client.jsx';
export default function Page(){if(process.env.METRONOME_PRODUCT==='employee')notFound();return <DeploymentClient/>;}
