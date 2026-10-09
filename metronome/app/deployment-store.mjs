export function loadSetupRecord(storage,company,asset,token){
  if(!company)return null;
  const raw=storage.getItem(`shiftpay:deployment:10143:${company}:${asset}`);
  if(!raw)return null;
  const value=JSON.parse(raw);
  if(value.chainId!==10143||value.company?.toLowerCase()!==company.toLowerCase()||value.token?.toLowerCase()!==token.toLowerCase())
    throw new Error('Saved deployment record does not match this company and token');
  return value;
}
