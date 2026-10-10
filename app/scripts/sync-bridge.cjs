// Bundles the payroll bridge into this app so the business deployment can serve it from Vercel functions.
// Deployments upload the generated copy; ../bridge stays the only source.
const fs=require('node:fs'),path=require('node:path');
const app=path.resolve(__dirname,'..');
const bridge=path.resolve(__dirname,'../../bridge');
if(!fs.existsSync(path.join(bridge,'src/runtime.ts'))){
  if(!fs.existsSync(path.join(app,'bridge-runtime/runtime.mjs')))throw new Error('Payroll bridge bundle is missing');
  return;
}
require('esbuild').buildSync({entryPoints:[path.join(bridge,'src/runtime.ts')],outfile:path.join(app,'bridge-runtime/runtime.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',packages:'external',logLevel:'warning'});
fs.rmSync(path.join(app,'prisma'),{recursive:true,force:true});
fs.cpSync(path.join(bridge,'prisma'),path.join(app,'prisma'),{recursive:true});
