// Automated end-to-end agent for the live deployments.
// Drives headless Chrome over the DevTools protocol with a virtual WebAuthn authenticator (PRF enabled), so a real
// Mera passkey is created and used without a human. Every on-chain step is a real Monad testnet transaction and is
// verified from its receipt. Usage: node tests/agent-e2e.cjs [--employee-url URL] [--business-url URL]
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:fallback;};
const EMPLOYEE=arg('--employee-url','https://shiftpay-employee.vercel.app');
const BUSINESS=arg('--business-url','https://shiftpay-business.vercel.app');
const RECIPIENT='0x4e3f8497F732326CFB8cC4d17Ad0688b74582776';
const RPC='https://testnet-rpc.monad.xyz/';
const out=path.resolve(__dirname,'../../data/agent-e2e');fs.mkdirSync(out,{recursive:true});
const chromePath=process.env.CHROME_PATH||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'google-chrome');
const port=9241,pause=ms=>new Promise(r=>setTimeout(r,ms));
const results=[],txs=[];
function record(name,ok,detail=''){results.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'}  ${name}${detail?'  '+detail:''}`);}

async function rpc(method,params){const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});return (await r.json()).result;}
async function receiptOk(hash){for(let i=0;i<30;i++){const r=await rpc('eth_getTransactionReceipt',[hash]);if(r)return r.status==='0x1';await pause(1000);}return false;}

async function connect(){
  for(let i=0;i<60;i++){try{return await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();}catch{await pause(500);}}
  throw new Error('Chrome did not start');
}
function session(wsUrl){
  const ws=new WebSocket(wsUrl);let id=0;const pending=new Map(),listeners=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const {resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result);}else listeners.forEach(f=>f(m));};
  const ready=new Promise(r=>ws.onopen=r);
  const send=(method,params={},sessionId)=>ready.then(()=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));}));
  return {send,on:f=>listeners.push(f),close:()=>ws.close()};
}

async function openPage(cdp,url,{width=390,height=844,mobile=true,context}={}){
  const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank',browserContextId:context});
  const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
  const s=(m,p)=>cdp.send(m,p,sessionId);
  await s('Page.enable');await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
  const errors=[];cdp.on(m=>{if(m.sessionId===sessionId&&m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);});
  await s('Page.navigate',{url});
  const page={s,sessionId,errors,
    eval:async expr=>{const r=await s('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;},
    async waitFor(expr,timeout=60000,label=expr){const end=Date.now()+timeout;while(Date.now()<end){try{if(await page.eval(`!!(${expr})`))return true;}catch{}await pause(500);}throw new Error('Timed out waiting for '+label);},
    text:()=>page.eval('document.body.innerText'),
    async click(text){const ok=await page.eval(`(()=>{const t=${JSON.stringify(text)};const el=[...document.querySelectorAll('button,a')].find(e=>e.innerText.trim().includes(t)&&!e.disabled);if(!el)return false;el.click();return true})()`);if(!ok)throw new Error('No enabled control: '+text);},
    async fill(selector,value){const ok=await page.eval(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);if(!ok)throw new Error('No input: '+selector);},
    async shot(name){const r=await s('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));},
    goto:url=>s('Page.navigate',{url}),
    tab:label=>page.eval(`(()=>{const a=[...document.querySelectorAll('.m-tabs a')].find(x=>x.innerText.trim().endsWith(${JSON.stringify(label)}));if(!a)return false;a.click();return true})()`),
  };
  return page;
}
async function addAuthenticator(page){
  await page.s('WebAuthn.enable',{enableUI:false});
  const {authenticatorId}=await page.s('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,hasPrf:true,automaticPresenceSimulation:true}});
  return authenticatorId;
}
let current=null;
async function step(name,fn){try{const detail=await fn();record(name,true,detail||'');return true;}
  catch(e){let seen='';if(current){try{seen=await current.eval(`[...document.querySelectorAll('.m-alert,.b-alert,[role=alert]')].map(x=>x.innerText).join(' | ')`);await current.shot('fail-'+name.replace(/[^a-z0-9]+/gi,'-'));}catch{}}
    record(name,false,e.message+(seen?'  [screen: '+seen.slice(0,300)+']':''));return false;}}

async function main(){
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'shiftpay-agent-'));
  const chrome=spawn(chromePath,['--headless=new','--disable-gpu','--no-first-run',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
  let cdp;
  try{
    const version=await connect();cdp=session(version.webSocketDebuggerUrl);
    // ---------- Employee mobile wallet ----------
    const e=await openPage(cdp,EMPLOYEE+'/employee');current=e;
    let auth,address;
    await step('employee: app loads to passkey sign-in',async()=>{await e.waitFor(`document.body.innerText.includes('Create payroll passkey')`,60000,'sign-in');auth=await addAuthenticator(e);});
    await step('employee: one-prompt passkey onboarding (Mera PRF)',async()=>{const t0=Date.now();await e.fill('.passkey-access input','Agent Tester');await e.click('Create payroll passkey');await e.waitFor(`document.body.innerText.includes('Digital dollars')`,60000,'home');return `${((Date.now()-t0)/1000).toFixed(1)}s`;});
    await step('employee: no crypto wording on home',async()=>{const t=await e.text();for(const bad of [' MON','0x','Testnet','Wallet balance','AUSD','CTK'])if(t.includes(bad))throw new Error('found '+bad);});
    await step('employee: receive shows address and QR',async()=>{await e.click('Receive');await e.waitFor(`document.querySelector('.m-qr')`,30000,'qr');
      address=await e.eval(`document.querySelector('.m-mono')?.textContent.trim()||''`);if(!/^0x[0-9a-fA-F]{40}$/.test(address))throw new Error('no address');return address;});
    const unlock=async()=>{if(await e.eval(`document.body.innerText.includes('Unlock payroll passkey')`)){await e.click('Unlock payroll passkey');await e.waitFor(`!document.body.innerText.includes('Unlock payroll passkey')`,60000,'unlock');}};
    await step('employee: automatic fee credit for a new account',async()=>{await e.tab('Home');await e.waitFor(`document.body.innerText.includes('Fee credit ready')`,90000,'fee credit');});
    await step('employee: add test dollars (Agora faucet)',async()=>{await e.click('Add test $');await e.waitFor(`document.body.innerText.includes('10,000 test dollars added')`,90000,'faucet');});
    const lastTx=()=>e.eval(`[...document.querySelectorAll('.m-success a')].map(a=>a.href.split('/tx/')[1]).filter(Boolean).pop()||''`);
    await step('employee: send abroad through Agora Instant Settlement',async()=>{await e.click('Send');await e.waitFor(`document.body.innerText.includes('Send abroad · instant')`);
      await e.fill('.m-form input[placeholder="0x…"]',RECIPIENT);await e.fill('.m-form input[placeholder="0.00"]','1');await e.click('Send money');
      await e.waitFor(`document.querySelector('.m-success')`,120000,'settlement');const h=await lastTx();if(!h||!await receiptOk(h))throw new Error('receipt failed '+h);txs.push({step:'send-abroad',hash:h});return h;});
    await step('employee: send digital dollars directly',async()=>{await e.click('Send dollars');await e.fill('.m-form input[placeholder="0x…"]',RECIPIENT);await e.fill('.m-form input[placeholder="0.00"]','1');await e.click('Send money');
      await e.waitFor(`document.querySelectorAll('.m-success').length&&document.querySelector('.m-success').innerText.includes('they received $1')`,90000,'transfer');const h=await lastTx();if(!await receiptOk(h))throw new Error('receipt failed');txs.push({step:'send-direct',hash:h});return h;});
    await step('employee: cash out with Instant Settlement',async()=>{await e.click('Cash out');await e.waitFor(`document.body.innerText.includes('Settle instantly')`);await e.fill('.m-form input[placeholder="0.00"]','1');await e.waitFor(`document.querySelector('.m-quote b')?.innerText.includes('local')`);await e.click('Settle instantly');
      await e.waitFor(`document.querySelector('.m-success')`,120000,'cash out');const h=await lastTx();if(!await receiptOk(h))throw new Error('receipt failed');txs.push({step:'cash-out',hash:h});return h;});
    await step('employee: Agora public API data shown',async()=>{await e.waitFor(`document.body.innerText.includes('live from Agora')`,30000,'agora metrics');});
    await step('employee: save an encrypted private payslip',async()=>{await e.click('Profile');await e.waitFor(`document.body.innerText.includes('Private payslips')`);await e.click("Save today's payslip");await e.waitFor(`document.querySelector('.m-list li')||document.body.innerText.includes('Link your payroll first')`,60000,'payslip');
      if(await e.eval(`document.body.innerText.includes('Link your payroll first')`))return 'skipped save: account not registered by an employer; opening vault only';});
    await step('employee: open private payslips',async()=>{await e.click('Open payslips');await e.waitFor(`document.body.innerText.includes('No payslips saved yet')||document.querySelector('.m-list li')`,60000,'open');});
    await step('employee: stateless test (clear storage, same passkey)',async()=>{await e.eval('localStorage.clear(),sessionStorage.clear(),true');await e.goto(EMPLOYEE+'/employee');await e.waitFor(`document.body.innerText.includes('Unlock payroll passkey')||document.body.innerText.includes('Create payroll passkey')`);
      await e.click('Unlock payroll passkey');await e.waitFor(`document.body.innerText.includes('Digital dollars')`,60000,'home');await e.click('Receive');await e.waitFor(`document.querySelector('.m-mono')`);
      const again=await e.eval(`document.querySelector('.m-mono').textContent.trim()`);if(again!==address)throw new Error('address changed '+again);return 'same address '+again;});
    // Chrome's virtual authenticator cannot export a credential's PRF secret, so a true second device is not
    // simulated here; synced platform passkeys carry it. The stateless test above proves re-derivation.
    await step('employee: payroll lookup from address (stateless recovery API)',async()=>{const r=await fetch(EMPLOYEE+'/api/bridge/workers/by-address/'+address+'?asset=USDC');const j=await r.json();if(!r.ok||!Array.isArray(j.workerIds))throw new Error(JSON.stringify(j));return 'registered ids: '+(j.workerIds.join(',')||'none (not yet registered by an employer)');});
    await step('employee: mobile layout has no sideways scroll on every tab',async()=>{for(const tab of ['Home','Send','Cash out','History','Profile']){await e.tab(tab);await pause(1200);
      const [sw,cw,tabs]=await e.eval(`[document.documentElement.scrollWidth,document.documentElement.clientWidth,document.querySelector('.m-tabs')?.getBoundingClientRect().width||0]`);if(sw>cw)throw new Error(`/${tab} overflows ${sw}>${cw}`);if(tabs>441)throw new Error('tab bar too wide '+tabs);await e.shot('employee-'+tab.toLowerCase().replace(' ','-'));}});
    record('employee: no uncaught page errors',e.errors.length===0,e.errors.slice(0,3).join(' | '));
    // ---------- Business website ----------
    const b=await openPage(cdp,BUSINESS+'/employer',{width:1366,height:900,mobile:false});current=b;
    await step('business: passkey sign-in screen',async()=>{await b.waitFor(`document.body.innerText.includes('Unlock company passkey')`,60000,'sign-in');await b.shot('business-signin');});
    await step('business: pitch link and unlock explanation',async()=>{const t=await b.text();if(!t.includes('Pitch')||!t.includes('What happens when I unlock?'))throw new Error('missing');});
    await step('business: company setup page loads',async()=>{await b.goto(BUSINESS+'/deploy');await b.waitFor(`document.body.innerText.includes('Company registration')`,60000,'setup');await b.shot('business-setup');});
    for(const w of [390,1366]){await step(`business: no sideways scroll at ${w}px`,async()=>{await b.s('Emulation.setDeviceMetricsOverride',{width:w,height:900,deviceScaleFactor:1,mobile:w<600});await b.goto(BUSINESS+'/employer');await b.waitFor(`document.body.innerText.includes('Unlock company passkey')`);const [sw,cw]=await b.eval(`[document.documentElement.scrollWidth,document.documentElement.clientWidth]`);if(sw>cw)throw new Error(`${sw}>${cw}`);});}
    record('business: no uncaught page errors',b.errors.length===0,b.errors.slice(0,3).join(' | '));
    // ---------- Business self-serve: a judge creates their own company with a new passkey ----------
    const j=await openPage(cdp,BUSINESS+'/employer',{width:1366,height:900,mobile:false});current=j;
    await step('business: judge creates a company passkey',async()=>{await j.waitFor(`document.body.innerText.includes('Create company passkey')`,60000,'sign-in');await addAuthenticator(j);
      await j.fill('.b-newco input','Agent Café');await j.click('Create company passkey');await j.waitFor(`document.body.innerText.includes('Create your company')||document.body.innerText.includes('Overview')`,90000,'setup');});
    await step('business: judge creates a company on chain (fee credit sponsored)',async()=>{await pause(8000);await j.fill('.b-form input','Agent Café');await j.click('Create my company');
      await j.waitFor(`document.body.innerText.includes('Company created')`,120000,'company');const h=await j.eval(`(document.body.innerText.match(/Company created · (0x[0-9a-f]{64})/)||[])[1]||''`);if(!h||!await receiptOk(h))throw new Error('no receipt '+h);txs.push({step:'create-company',hash:h});return h;});
    await step('business: new company dashboard opens',async()=>{await j.waitFor(`document.body.innerText.includes('Funded payroll')||document.body.innerText.includes('No employees yet')`,90000,'dashboard');await j.shot('business-new-company');});
    record('business: no uncaught page errors (self-serve)',j.errors.length===0,j.errors.slice(0,3).join(' | '));
  }finally{
    cdp?.close();chrome.kill();
    const failed=results.filter(r=>!r.ok).length;
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({ranAt:new Date().toISOString(),employee:EMPLOYEE,business:BUSINESS,passed:results.length-failed,failed,results,transactions:txs},null,2));
    console.log(`\n${results.length-failed}/${results.length} passed · report: ${path.join(out,'report.json')}`);
    try{fs.rmSync(profile,{recursive:true,force:true});}catch{}
    process.exitCode=failed?1:0;
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
