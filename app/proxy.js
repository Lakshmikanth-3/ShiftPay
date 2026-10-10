import {NextResponse} from 'next/server';
const routes={employer:new Set(['','employees','payroll','funding','payments','shifts','reports','settings']),employee:new Set(['','send','receive','cashout','history','profile'])};
export function proxy(request){const path=request.nextUrl.pathname,parts=path.split('/').filter(Boolean),role=parts[0],product=process.env.METRONOME_PRODUCT;
  const removed=role==='demo'||role==='preview';const invalid=routes[role]&&(parts.length>2||!routes[role].has(parts[1]||''));const wrongProduct=product&&((routes[role]&&product!==role)||(product==='employee'&&role==='deploy'));
  if(removed||invalid||wrongProduct)return new NextResponse('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ShiftPay — Page not found</title><body><main><h1>Page not found</h1><p>This page is not available in this portal.</p><a href="/">Return to ShiftPay</a></main></body></html>',{status:404,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
  return NextResponse.next();
}
export const config={matcher:['/employee/:path*','/employer/:path*','/deploy','/demo/:path*','/preview/:path*']};
