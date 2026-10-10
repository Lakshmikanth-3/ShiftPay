import '../styles/connected.css';
import '../styles/product.css';
import '../styles/wallet.css';
import '../styles/business.css';
import Providers from '../components/providers.jsx';
export const metadata = { title: 'ShiftPay — Your work. Your money.', description: 'Continuous employer-funded earned wages', manifest: '/manifest.webmanifest' };
export const viewport = { themeColor: '#203b2e', width: 'device-width', initialScale: 1, viewportFit: 'cover' };
export default function Layout({children}) { return <html lang="en"><body><Providers>{children}</Providers></body></html>; }
