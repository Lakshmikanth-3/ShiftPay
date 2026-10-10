const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
fs.writeFileSync(path.join(root,'lib','vault-abi.mjs'),'export const metronomeVaultAbi = '+JSON.stringify(JSON.parse(fs.readFileSync(path.join(root,'lib','vault-abi.json'),'utf8')))+';\n');
// Remove only generated legacy preview assets inside this app's public directory.
const preview=path.resolve(root,'public/preview');
if(preview!==path.join(root,'public','preview'))throw new Error('Invalid preview cleanup path');
fs.rmSync(preview,{recursive:true,force:true});
async function icons(){const sharp=require('sharp');for(const size of [192,512])await sharp(path.join(root,'public/icon.svg')).resize(size,size).png().toFile(path.join(root,`public/icon-${size}.png`));}
icons().catch(error=>{console.error(error);process.exitCode=1;});
