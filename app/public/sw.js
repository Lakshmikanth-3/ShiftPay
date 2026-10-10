// Never cache payroll, account data or RPC responses. Offline users get an explicit notice.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  if(event.request.mode==='navigate') event.respondWith(fetch(event.request).catch(()=>new Response('<!doctype html><title>ShiftPay offline</title><main><h1>You are offline</h1><p>Reconnect to see current wages and transaction status.</p></main>',{headers:{'Content-Type':'text/html'},status:503})));
});
