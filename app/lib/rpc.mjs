// Monad testnet public RPCs. The official endpoint allows 25 requests/second, so reads fall back to other
// public providers when it rate-limits or fails, instead of surfacing an error to the user.
import {fallback,http} from 'viem';
export const monadRpcUrls=['https://testnet-rpc.monad.xyz/','https://rpc-testnet.monadinfra.com','https://rpc.ankr.com/monad_testnet','https://monad-testnet.drpc.org'];
export const monadTransport=()=>fallback(monadRpcUrls.map(url=>http(url,{retryCount:1,timeout:10_000})),{retryCount:2});
