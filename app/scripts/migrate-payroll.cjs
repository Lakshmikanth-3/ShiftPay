// Applies bridge migrations to each configured token schema during the business deployment build.
const {execFileSync}=require('node:child_process'),path=require('node:path');
if(process.env.PAYROLL_BACKEND!=='local')return;
const base=process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL;
if(!base)throw new Error('DATABASE_URL is required for the hosted payroll backend');
for(const asset of ['USDC','AUSD']){
  if(!process.env[asset+'_VAULT_ADDRESS'])continue;
  const url=new URL(base);url.searchParams.set('schema',asset.toLowerCase());
  execFileSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy'],{stdio:'inherit',cwd:path.resolve(__dirname,'..'),env:{...process.env,DATABASE_URL:url.toString()}});
}
