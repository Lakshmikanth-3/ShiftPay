const allowed = /^(config|health|dashboard|workers\/\d+(\/shifts|\/withdraw-typed-data)?|txs\/[a-zA-Z0-9_-]+|withdrawals|clock-intents)$/;
async function proxy(request, context) {
  const {path} = await context.params;
  const target = path.join('/');
  if (!allowed.test(target) || (request.method === 'POST' && !['withdrawals','clock-intents','dashboard'].includes(target))) return Response.json({message:'Not found'}, {status:404});
  if (request.method === 'GET' && ['withdrawals','clock-intents','dashboard'].includes(target)) return Response.json({message:'Method not allowed'}, {status:405});
  if (request.method === 'POST' && request.headers.get('origin') !== new URL(request.url).origin) return Response.json({message:'Origin mismatch'}, {status:403});
  try {
    const url=new URL(request.url),asset=url.searchParams.get('asset') || 'AUSD';
    if(!['AUSD','USDC'].includes(asset))return Response.json({message:'Unsupported settlement token'}, {status:400});
    const configured=asset==='USDC'?process.env.BRIDGE_USDC_URL:process.env.BRIDGE_AUSD_URL;
    if(!configured)return Response.json({message:`${asset} payroll deployment is pending. Configure its deployed vault and hosted bridge.`}, {status:503});
    const raw = request.method === 'POST' ? await request.text() : undefined;
    if (raw && Buffer.byteLength(raw) > 65536) return Response.json({message:'Request too large'}, {status:413});
    // Render supplies a service hostname; Vercel supplies an explicit HTTPS URL.
    const base = new URL(/^[a-zA-Z0-9-]+\.onrender\.com$/.test(configured)?`https://${configured}`:configured);
    if((process.env.VERCEL || process.env.RENDER) && (base.protocol!=='https:'||['localhost','127.0.0.1','0.0.0.0'].includes(base.hostname)))return Response.json({message:'Hosted payroll requires a public HTTPS bridge.'},{status:503});
    url.searchParams.delete('asset');
    const upstream = await fetch(new URL('/'+target+url.search,base), {method:request.method,headers:{'content-type':'application/json'},body:raw,cache:'no-store',signal:AbortSignal.timeout(15000)});
    return new Response(await upstream.text(), {status:upstream.status,headers:{'content-type':'application/json','cache-control':'no-store'}});
  } catch { return Response.json({message:'Payroll service is unavailable. Check the bridge configuration and database.'}, {status:503}); }
}
export {proxy as GET, proxy as POST};
