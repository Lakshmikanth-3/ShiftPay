import {isAddress} from 'viem';
import type {Config} from './config.js';

/** Production entrypoint requirements; local integration fixtures stay explicit. */
export function assertHostedConfig(cfg: Config, env: NodeJS.ProcessEnv): void {
  if(cfg.chainId!==10143)throw new Error('The deployed payroll service requires Monad Testnet 10143');
  if(cfg.vaultDeployBlock===undefined)throw new Error('VAULT_DEPLOY_BLOCK is required from the confirmed vault deployment receipt');
  if(env.VAULT_DEPLOY_BLOCK?.trim()==='')throw new Error('VAULT_DEPLOY_BLOCK must not be blank');
  if(!isAddress(env.EXPECTED_EMPLOYER_ADMIN||''))throw new Error('EXPECTED_EMPLOYER_ADMIN must be the confirmed public company account');
  if(!['AUSD','USDC'].includes(env.SETTLEMENT_ASSET||''))throw new Error('SETTLEMENT_ASSET must explicitly select AUSD or USDC');
}
