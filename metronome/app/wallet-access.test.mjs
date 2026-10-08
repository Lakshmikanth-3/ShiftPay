import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL(file,import.meta.url),'utf8');
test('active payroll UI contains no MetaMask or external connection entry points',()=>{
  for(const file of ['deployment.jsx','payroll.jsx','product.jsx','passkey-access.jsx'])
    assert.doesNotMatch(read(file),/metamask|useConnectWallet|connectWallet|window\.ethereum/i,file);
});
test('Privy uses email login and filters previously linked external wallets',()=>{
  const source=read('payroll.jsx');assert.match(source,/loginMethods:\['email'\]/);
  assert.match(source,/privyWallets\.filter\(w=>w\.walletClientType==='privy'\)/);
  assert.match(source,/createOnLogin:'all-users'/);
});
test('company registration requires the actual Mera signer',()=>{
  const source=read('deployment.jsx');assert.match(source,/const company=payroll\.meraWallet\?\.address\|\|''/);
  assert.doesNotMatch(source,/eth_requestAccounts|wallet_requestPermissions|connectStep/);
  assert.match(source,/Unlock the company payroll passkey first/);
});
test('employee onboarding supports creating a passkey and does not prefill an unsupported payout account',()=>{
  assert.match(read('product.jsx'),/<PasskeyAccess allowCreate\/>/);
  assert.match(read('payroll.jsx'),/\[payout,setPayout\]=useState\(''\)/);
});
