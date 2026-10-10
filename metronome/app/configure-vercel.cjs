// Configures both ShiftPay Vercel projects for hosted payroll. Run by the owner from metronome/app:
//   node configure-vercel.cjs
// Reads service keys from ../bridge/.env.runtime-keys and never prints secret values.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const org='team_8Fv00GA46GntpoNzqHuUPuV2';
const projects={business:'prj_SxoLusiEvxMvKG8oELelpN6pGpWO',employee:'prj_KxQtBd6Y6hmQ2Te4Q9LGTZ7T4I1v'};
const keysFile=path.join(__dirname,'../bridge/.env.runtime-keys');
const keys=Object.fromEntries(fs.readFileSync(keysFile,'utf8').split(/\r?\n/).filter(l=>/^\w+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim()]));
const relay=crypto.randomBytes(32).toString('hex');

const business={PAYROLL_BACKEND:'local',BRIDGE_RELAY_SECRET:relay,MONAD_RPC_URL:'https://testnet-rpc.monad.xyz/',
  EXPECTED_EMPLOYER_ADMIN:'0x430ff06AB045911e5dC6B7a742ddC11f27F47487',
  USDC_VAULT_ADDRESS:'0xA1C794EA48A1D86294848D28E85c76328070DB24',USDC_VAULT_DEPLOY_BLOCK:'69456787',USDC_EMPLOYER_ID:'1'};
for(const k of ['ATTESTOR_PRIVATE_KEY','RELAYER_PRIVATE_KEYS','WEBHOOK_SECRET','ADMIN_API_TOKEN'])for(const a of ['USDC','AUSD']){
  if(!keys[`${a}_${k}`])throw new Error(`${a}_${k} is missing from ${keysFile}`);business[`${a}_${k}`]=keys[`${a}_${k}`];
}
// The AUSD vault is added by configure-vercel.cjs ausd <vault> <block> <employerId> once deployed.
if(process.argv[2]==='ausd'){
  const [vault,block,id]=process.argv.slice(3);
  if(!/^0x[0-9a-fA-F]{40}$/.test(vault||'')||!/^\d+$/.test(block||'')||!/^\d+$/.test(id||''))throw new Error('usage: node configure-vercel.cjs ausd <vault> <deployBlock> <employerId>');
  for(const name of Object.keys(business))delete business[name];
  Object.assign(business,{AUSD_VAULT_ADDRESS:vault,AUSD_VAULT_DEPLOY_BLOCK:block,AUSD_EMPLOYER_ID:id});
}
const employee=process.argv[2]==='ausd'?{}:{BRIDGE_ORIGIN:'https://shiftpay-business.vercel.app',BRIDGE_RELAY_SECRET:relay};

function set(project,vars){
  const env={...process.env,VERCEL_ORG_ID:org,VERCEL_PROJECT_ID:projects[project]};
  for(const [name,value] of Object.entries(vars))for(const target of ['production','preview']){
    spawnSync('vercel',['env','rm',name,target,'--yes'],{shell:true,stdio:'ignore',env});
    const r=spawnSync('vercel',['env','add',name,target,'--sensitive'],{shell:true,input:value,encoding:'utf8',env});
    console.log(`${project} ${name} ${target}: ${r.status===0?'set':'FAILED'}`);
    if(r.status!==0)process.exitCode=1;
  }
}
set('business',business);
set('employee',employee);
