import {describe,it,expect} from 'vitest';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {buildApp} from '../src/app.js';
import type {Ctx} from '../src/context.js';
const admin=privateKeyToAccount(generatePrivateKey());
const stranger=privateKeyToAccount(generatePrivateKey());
const vault='0x00000000000000000000000000000000000000aa' as const;
const types={Clock:[{name:'workerId',type:'uint256'},{name:'action',type:'uint8'},{name:'nonce',type:'bytes32'},{name:'deadline',type:'uint64'}]} as const;
const nonce=('0x'+'ab'.repeat(32)) as `0x${string}`;
const domain={name:'ShiftPayClock',version:'1',chainId:10143,verifyingContract:vault};
function app(employerId=1n){return buildApp({cfg:{employerId:1n,chainId:10143,adminToken:'x'.repeat(32)},now:()=>100n,chain:{vault,readWorker:async()=>({flags:1,employerId}),publicClient:{readContract:async()=>[admin.address,stranger.address,stranger.address]}},prisma:{clockEvent:{findUnique:async()=>({shiftId:'9'})}},log:{error:()=>{}}} as unknown as Ctx);}
async function body(signer=admin,deadline=200n,chainId=10143){return {workerId:'7',type:'clock_in',nonce,deadline:deadline.toString(),signature:await signer.signTypedData({domain:{...domain,chainId},types,primaryType:'Clock',message:{workerId:7n,action:0,nonce,deadline}})};}
describe('browser clock authorization',()=>{
  it('accepts the registered admin and handles repeat events idempotently',async()=>{const server=app();try{const response=await server.inject({method:'POST',url:'/clock-intents',payload:await body()});expect(response.statusCode).toBe(200);expect(response.json()).toEqual({duplicate:true,shiftId:'9'});}finally{await server.close();}});
  it.each(['stranger','expired','future','chain','worker'] as const)('rejects %s authorization',async(mode)=>{const server=app(mode==='worker'?2n:1n);try{const response=await server.inject({method:'POST',url:'/clock-intents',payload:await body(mode==='stranger'?stranger:admin,mode==='expired'?99n:mode==='future'?999n:200n,mode==='chain'?1:10143)});expect(response.statusCode).toBeGreaterThanOrEqual(400);}finally{await server.close();}});
  it('rejects changing a signed clock-in into a clock-out',async()=>{const server=app();try{const response=await server.inject({method:'POST',url:'/clock-intents',payload:{...await body(),type:'clock_out'}});expect(response.statusCode).toBe(401);}finally{await server.close();}});
});
