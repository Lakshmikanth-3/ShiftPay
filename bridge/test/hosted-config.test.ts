import {describe,expect,it} from 'vitest';
import {assertHostedConfig} from '../src/hosted-config.js';
import type {Config} from '../src/config.js';

const cfg={chainId:10143,vaultDeployBlock:100n} as Config;
const env={VAULT_DEPLOY_BLOCK:'100',EXPECTED_EMPLOYER_ADMIN:'0x430ff06AB045911e5dC6B7a742ddC11f27F47487',SETTLEMENT_ASSET:'USDC'};
describe('hosted payroll readiness',()=>{
  it('accepts explicit real-network setup pins',()=>expect(()=>assertHostedConfig(cfg,env)).not.toThrow());
  it('refuses a different network',()=>expect(()=>assertHostedConfig({...cfg,chainId:31337},env)).toThrow(/Monad Testnet/));
  it('refuses missing or blank indexing start',()=>{
    expect(()=>assertHostedConfig({...cfg,vaultDeployBlock:undefined},env)).toThrow(/VAULT_DEPLOY_BLOCK/);
    expect(()=>assertHostedConfig({...cfg,vaultDeployBlock:0n},{...env,VAULT_DEPLOY_BLOCK:''})).toThrow(/blank/);
  });
  it('refuses absent or malformed company pins',()=>{
    expect(()=>assertHostedConfig(cfg,{...env,EXPECTED_EMPLOYER_ADMIN:undefined})).toThrow(/EXPECTED_EMPLOYER_ADMIN/);
    expect(()=>assertHostedConfig(cfg,{...env,EXPECTED_EMPLOYER_ADMIN:'0x1234'})).toThrow(/EXPECTED_EMPLOYER_ADMIN/);
  });
  it('refuses an implicit or unsupported settlement asset',()=>{
    expect(()=>assertHostedConfig(cfg,{...env,SETTLEMENT_ASSET:undefined})).toThrow(/SETTLEMENT_ASSET/);
    expect(()=>assertHostedConfig(cfg,{...env,SETTLEMENT_ASSET:'USD'})).toThrow(/SETTLEMENT_ASSET/);
  });
});
