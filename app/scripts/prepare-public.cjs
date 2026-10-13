const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
fs.writeFileSync(path.join(root,'lib','vault-abi.mjs'),'export const metronomeVaultAbi = '+JSON.stringify(JSON.parse(fs.readFileSync(path.join(root,'lib','vault-abi.json'),'utf8')))+';\n');
// Remove only generated legacy preview assets inside this app's public directory.
const preview=path.resolve(root,'public/preview');
if(preview!==path.join(root,'public','preview'))throw new Error('Invalid preview cleanup path');
fs.rmSync(preview,{recursive:true,force:true});
// App icons (logo-mark.png, icon-192.png, icon-512.png) are committed PNGs made from the ShiftPay logo.
