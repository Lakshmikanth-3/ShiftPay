import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';

it('deployment preflight checks the actual public company account without requiring its private key',()=>{
  const source=readFileSync(new URL('../scripts/deployment-check.ts',import.meta.url),'utf8');
  expect(source).not.toContain('DEPLOYER_PRIVATE_KEY');
  expect(source).toContain('EXPECTED_EMPLOYER_ADMIN');
  expect(source).toContain('getBalance({address:company})');
  expect(source).toContain("functionName:'balanceOf',args:[company]");
  expect(source).toContain('company passkey in the business portal');
});
