import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {existsSync,writeFileSync,readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const privateFile=new URL('../.env.runtime-keys',import.meta.url);
const publicFile=new URL('../../app/lib/deployment-accounts.json',import.meta.url);
if(existsSync(privateFile)){
  if(!existsSync(publicFile))throw new Error('Existing keys found without their public address record. Restore the public record; do not regenerate keys.');
  console.log('Existing service wallets preserved:',readFileSync(publicFile,'utf8'));
}else{
  if(existsSync(publicFile))throw new Error('A public record already exists. Refusing to replace its associated service wallets.');
  const addresses={},lines=['# Private service keys. Never commit or share this file.'];
  for(const asset of ['AUSD','USDC']){
    const attestor=generatePrivateKey(),relayer=generatePrivateKey();
    addresses[asset]={attestor:privateKeyToAccount(attestor).address,relayer:privateKeyToAccount(relayer).address};
    lines.push(`${asset}_ATTESTOR_PRIVATE_KEY=${attestor}`,`${asset}_RELAYER_PRIVATE_KEYS=${relayer}`,`${asset}_WEBHOOK_SECRET=${randomBytes(32).toString('hex')}`,`${asset}_ADMIN_API_TOKEN=${randomBytes(32).toString('hex')}`);
  }
  writeFileSync(privateFile,lines.join('\n')+'\n',{flag:'wx',mode:0o600});
  writeFileSync(publicFile,JSON.stringify(addresses,null,2)+'\n',{flag:'wx'});
  console.log('Created private backend service keys locally. Public addresses:',JSON.stringify(addresses));
}
