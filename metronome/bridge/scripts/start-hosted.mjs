import 'dotenv/config';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
const url=new URL(process.env.DATABASE_URL);
if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('PostgreSQL is required');
if(process.env.DATABASE_SCHEMA){
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(process.env.DATABASE_SCHEMA))throw new Error('Invalid DATABASE_SCHEMA');
  url.searchParams.set('schema',process.env.DATABASE_SCHEMA);
}
process.env.DATABASE_URL=url.toString();
const migrations=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/prisma/build/index.js',import.meta.url)), 'migrate','deploy'],{stdio:'inherit'});
const code=await new Promise((resolve,reject)=>{migrations.once('error',reject);migrations.once('exit',resolve);});
if(code!==0)throw new Error('Database migrations failed; payroll service was not started');
const server=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs',import.meta.url)), 'src/server.ts'],{stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.kill(signal));
server.once('error',error=>{console.error(error.message);process.exitCode=1;});
server.once('exit',code=>{process.exitCode=code ?? 1;});
