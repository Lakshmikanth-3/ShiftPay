import {formatEther} from 'viem';

export function assertSetupFunding({balance,gas,maxFeePerGas,gasPrice,value=0n}){
  if(typeof balance!=='bigint'||balance<0n||typeof gas!=='bigint'||gas<=0n||typeof value!=='bigint'||value<0n)
    throw new Error('Company setup funding could not be verified.');
  const price=maxFeePerGas??gasPrice;
  if(typeof price!=='bigint'||price<=0n)throw new Error('Company setup fee estimate is unavailable.');
  const required=gas*price+value;
  if(balance<required)throw new Error(`Add test MON to your payroll passkey account before continuing. Balance: ${formatEther(balance)} MON. This transaction requires up to ${formatEther(required)} MON, including network fees.`);
  return required;
}

export async function prepareSetupTransaction({client,signer,account,...transaction}){
  const balance=await client.getBalance({address:account});
  if(balance===0n)throw new Error(`Add test MON to your payroll passkey account ${account} before registering your company. Your existing external-wallet funds do not move automatically.`);
  const request=await signer.prepareTransactionRequest({...transaction,account});
  assertSetupFunding({balance,gas:request.gas,maxFeePerGas:request.maxFeePerGas,gasPrice:request.gasPrice,value:request.value??0n});
  return request;
}
