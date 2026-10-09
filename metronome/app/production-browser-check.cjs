const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const dir=path.resolve(__dirname,'../../data/production-qa');fs.mkdirSync(dir,{recursive:true});
const chrome=process.env.CHROME_PATH||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'google-chrome');
const child=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9235','--user-data-dir='+path.join(dir,'browser-profile'),'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));let socket;
(async()=>{
 let targets;for(let i=0;i<60;i++){try{targets=await(await fetch('http://127.0.0.1:9235/json/list')).json();break;}catch{await pause(250);}}
 assert.ok(targets,'Chrome did not start');socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let id=0;const requests=new Map(),exceptions=[],checks=[];
 socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const request=requests.get(data.id);requests.delete(data.id);data.error?request.reject(data.error):request.resolve(data.result);}else if(data.method==='Runtime.exceptionThrown')exceptions.push(data.params.exceptionDetails);});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const request=++id;requests.set(request,{resolve,reject});socket.send(JSON.stringify({id:request,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const until=async expression=>{for(let i=0;i<120;i++){if(await evaluate('document.body && ('+expression+')'))return;await pause(500);}throw Error('Timed out: '+expression);};
 const screenshot=async name=>{const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from(shot.data,'base64'));};
 await send('Runtime.enable');await send('Page.enable');
 for(const [role,host,sections] of [
  ['employer','https://shiftpay-business.vercel.app',['','employees','payroll','funding','payments','shifts','reports','settings']],
  ['employee','https://shiftpay-employee.vercel.app',['','earnings','shifts','payments','profile']],
 ]){
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:host});await until("!!document.querySelector('.product.'+"+JSON.stringify(role)+")");
  assert.equal(await evaluate('location.pathname'),'/'+role);checks.push(role+' root routes to its dedicated product');
  for(const section of sections){const route='/'+role+(section?'/'+section:'');
   assert.equal(await evaluate('fetch('+JSON.stringify(route)+').then(r=>r.status)'),200,route);
   await send('Page.navigate',{url:host+route});await until("document.body.textContent.includes('payroll setup pending')");
   assert.equal(await evaluate("document.querySelectorAll('.product-nav a').length"),sections.length);
   assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true);checks.push(role+' '+(section||'home')+' real setup state');
  }
  for(const route of ['/demo','/preview/index.html',role==='employer'?'/employee':'/employer',...(role==='employee'?['/deploy']:[])]){
   assert.equal(await evaluate('fetch('+JSON.stringify(route)+').then(r=>r.status)'),404,host+route);
  }checks.push(role+' rejects simulation and other-product routes');
  await send('Page.navigate',{url:host+'/'+role});await until("document.body.textContent.includes('payroll setup pending')");
  for(const width of [390,320]){await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);await screenshot(role+'-'+width);}
  checks.push(role+' responsive at 390 and 320 pixels');
  await until("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Log in'&&!b.disabled)");
  await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Log in').click()");
  await until("!!document.querySelector('input[type=email]')||document.body.textContent.includes('Continue with email')");checks.push(role+' email login opens; no email submitted');
  if(role==='employer'){
   await send('Page.navigate',{url:host+'/deploy'});await until("document.body.textContent.includes('Create payroll passkey')");
   assert.equal(await evaluate("document.querySelector('.setup-actions .primary').disabled"),true);
   assert.equal(await evaluate("document.body.textContent.toLowerCase().includes('metamask')"),false);
   checks.push('Company registration requires owner passkey, with no external-wallet connector');await screenshot('company-registration');
  }
 }
 assert.equal(exceptions.length,0,'Uncaught browser exception');
 fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,scope:'Public unauthenticated routes, responsive layout and login entry. Does not prove real payroll settlement.'},null,2));
 console.log('PASS: '+checks.length+' public production browser checks. Real payroll acceptance remains separate.');
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>{socket?.close();child.kill();});
