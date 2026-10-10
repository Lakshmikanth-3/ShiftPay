// Bundles the payroll bridge into this app so the business deployment can serve it from Vercel functions.
// Deployments upload the generated copy; ../bridge stays the only source.
const fs=require('node:fs'),path=require('node:path');
const bridge=path.resolve(__dirname,'../bridge');
if(!fs.existsSync(path.join(bridge,'src/runtime.ts'))){
  if(!fs.existsSync(path.join(__dirname,'bridge-runtime/runtime.mjs')))throw new Error('Payroll bridge bundle is missing');
  return;
}
require('esbuild').buildSync({entryPoints:[path.join(bridge,'src/runtime.ts')],outfile:path.join(__dirname,'bridge-runtime/runtime.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',packages:'external',logLevel:'warning'});
fs.rmSync(path.join(__dirname,'prisma'),{recursive:true,force:true});
fs.cpSync(path.join(bridge,'prisma'),path.join(__dirname,'prisma'),{recursive:true});
