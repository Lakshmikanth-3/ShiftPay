import '../connected.css';
import '../product.css';
import Providers from '../providers.jsx';
export const metadata = { title: 'ShiftPay — Your work. Your money.', description: 'Continuous employer-funded earned wages', manifest: '/manifest.webmanifest' };
export const viewport = { themeColor: '#203b2e' };
export default function Layout({children}) { return <html lang="en"><body><Providers>{children}</Providers></body></html>; }
