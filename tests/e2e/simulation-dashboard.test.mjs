import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawn} from 'node:child_process';

const envFile=process.env.RALLYX_ENV_FILE||'.tools/preview.env';
if(!envFile.includes('preview'))throw new Error('Simulation acceptance requires an isolated preview environment');
const env=Object.fromEntries(readFileSync(envFile,'utf8').split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
const base=process.env.RALLYX_BROWSER_BASE_URL||'http://web:8080';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){const end=Date.now()+60000;while(Date.now()<end){if(await check())return;await pause(250);}throw new Error('Timed out: '+label);}
let cookie='';
async function raw(path,method='GET',body){const response=await fetch(base+'/api/v1'+path,{method,headers:{cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const text=await response.text();return{status:response.status,headers:response.headers,value:text?JSON.parse(text):undefined};}
async function api(path,method='GET',body){const response=await raw(path,method,body);assert.ok(response.status<300,path+': '+response.status+' '+JSON.stringify(response.value));return response.value;}

test('Generic simulation dashboard: cabinet fixture, editor, shared preview, live data, durable reload and role boundaries',{timeout:360000},async()=>{
 const login=await raw('/auth/login','POST',{username:env.ADMIN_USERNAME,password:env.ADMIN_PASSWORD});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
 const baselineBoards=await api('/dashboard/boards'),baselineWidgets=await api('/dashboard');
 const suffix=Date.now().toString(36);let board;let tagIDs;
 if(process.env.SIMULATION_RELOAD_ONLY==='1'){
  const saved=JSON.parse(readFileSync('.tools/simulation-acceptance.json','utf8'));board=await api('/dashboards/'+saved.id);tagIDs=saved.tagIDs;assert.deepEqual(board.layout,saved.layout,'layout survives a service restart');
 }else{
  tagIDs=[];
  for(const [key,data_type,value,unit] of [['grid','bool',true,''],['generator','bool',false,''],['current','float64',125.5,'A'],['voltage','float64',382,'V']]){
   const tag=await api('/tags','POST',{device_id:'demo-motor-device',key:'sim_'+suffix+'_'+key,name:'Simulation acceptance '+key+' '+suffix,data_type,unit,store_history:true,stale_seconds:30,metadata:{simulator_value:value}});tagIDs.push(tag.id);
  }
  await until(async()=>{const tags=await api('/tags');return tagIDs.every(id=>tags.some(t=>t.id===id&&t.quality==='GOOD'));},'real connectivity simulator → MQTT → Core tag state');
  const controls=[];let serial=0;
  const control=(type,x,y,width,height,properties,binding,zIndex=1)=>({id:'fixture-'+(++serial),type,x,y,width,height,rotation:0,zIndex,properties,...(binding?{binding:{tagId:binding,operator:'direct'}}:{})});
  controls.push(control('rectangle',20,20,1060,860,{fill:'#f1f5f9',borderColor:'#94a3b8',borderWidth:2,borderRadius:12},undefined,0));
  for(const [group,x,y,tag] of [['GRID',130,60,tagIDs[0]],['GENERATOR',650,60,tagIDs[1]],['LOAD',390,250,tagIDs[0]]]){
   controls.push(control('text',x,y,280,40,{text:group,fontSize:24,fontWeight:'700',textAlign:'center'}));
   for(const [i,phase] of ['R','Y','B'].entries())controls.push(control('indicator-lamp',x+i*100,y+55,80,110,{label:phase,onColor:['#ef4444','#eab308','#2563eb'][i],offColor:'#94a3b8',borderStyle:'solid'},tag));
  }
  for(let i=0;i<3;i++)controls.push(control('analog-gauge',130+i*280,450,230,180,{label:'Current '+['R','Y','B'][i],min:0,max:200,unit:'A',precision:1},tagIDs[2]));
  controls.push(control('analog-gauge',410,650,230,180,{label:'Voltage',min:0,max:500,unit:'V',precision:0},tagIDs[3]));
  controls.push(control('numeric-value',710,700,200,80,{label:'Voltage reading',unit:'V',precision:0,prefix:'',suffix:''},tagIDs[3]));
  board=await api('/dashboards','POST',{name:'Acceptance cabinet '+suffix,type:'simulation',canvas:{width:1100,height:900,gridSize:10,snapToGrid:true,backgroundColor:'#ffffff'},layout:controls});
 }
 const child=spawn('chromium-browser',['--headless','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=9222','--user-data-dir=/tmp/rallyx-simulation-'+suffix,'--window-size=1800,1200','about:blank'],{stdio:'ignore'});
 let socket,evaluate,send;let counter=0;const pending=new Map();const writes=[];const sockets=[];
 try{
  let targets;await until(async()=>{try{targets=await(await fetch('http://127.0.0.1:9222/json')).json();return targets.some(x=>x.type==='page');}catch{return false;}},'Chromium startup');
  socket=new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const item=pending.get(message.id);pending.delete(message.id);message.error?item.reject(message.error):item.resolve(message.result);}else if(message.method==='Network.requestWillBeSent'&&message.params.request.method!=='GET')writes.push(message.params.request);else if(message.method==='Network.webSocketCreated')sockets.push(message.params.url);};
  send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++counter;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,sessionId}));});
  evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  const click=async label=>{await evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw new Error('Unavailable button '+${JSON.stringify(label)});b.click();})()`);await pause(150);};
  const input=async(label,value)=>{await evaluate(`(()=>{const el=Array.from(document.querySelectorAll('label')).find(x=>x.textContent.startsWith(${JSON.stringify(label)}))?.querySelector('input,select');if(!el)throw new Error('Missing field '+${JSON.stringify(label)});Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));el.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));})()`);await pause(150);};
  await send('Network.enable');await send('Network.setCookie',{name:cookie.split('=')[0],value:cookie.slice(cookie.indexOf('=')+1),url:base});
  const url=base+'/?simulation='+encodeURIComponent(board.id)+'#dashboards';await send('Page.navigate',{url});
  await until(()=>evaluate("document.querySelectorAll('.simulation-control').length>=17"),'saved generic control layout');
  await until(()=>evaluate("document.querySelectorAll('[data-state=on]').length===6&&document.querySelectorAll('[data-state=off]').length===3"),'live boolean sources');
  assert.ok(await evaluate("document.querySelector('.simulation-canvas').innerText.includes('125.5')"));
  assert.equal(sockets.filter(x=>x.endsWith('/api/v1/ws')).length,1,'all controls share one existing websocket');
  if(process.env.SIMULATION_RELOAD_ONLY!=='1'){
   await click('Thiết kế');assert.equal(await evaluate("getComputedStyle(document.querySelector('.simulation-palette')).position"),'static','palette not fixed by shell CSS');
   const before=board.layout.find(x=>x.type==='text');
   await evaluate(`document.querySelector('[data-control-id="${before.id}"]').click()`);
   await input('X (px)',90);await input('Y (px)',50);await click('Lưu dashboard');
   await until(async()=>{const current=await api('/dashboards/'+board.id);return current.layout.find(x=>x.id===before.id).x===90;},'numeric inspector explicit save');
   await click('Xem thử');const writeCount=writes.length;
   const tags=await api('/tags');const generator=tags.find(x=>x.id===tagIDs[1]);await input(generator.name,true);
   // Other bindings have no virtual value until the user explicitly supplies one.
   await until(()=>evaluate("document.querySelectorAll('[data-state=on]').length===3"),'shared local preview source across three controls');
   await pause(1200);assert.equal(writes.length,writeCount,'preview performs no mutation requests');assert.equal((await api('/tags')).find(x=>x.id===tagIDs[1]).value,false,'preview does not mutate Core tag state');
   await click('Trực tiếp');await until(()=>evaluate("document.querySelectorAll('[data-state=on]').length===6&&document.querySelectorAll('[data-state=off]').length===3"),'switch back to real data');
   // A real pointer sequence moves a control, and resize stays within its canvas.
   await click('Thiết kế');await evaluate(`document.querySelector('[data-control-id="${before.id}"]').scrollIntoView({block:'center',inline:'center'})`);await pause(250);const rect=await evaluate(`(()=>{const r=document.querySelector('[data-control-id="${before.id}"]').getBoundingClientRect();return {x:r.x+100,y:r.y+20};})()`);
   assert.equal(await evaluate(`document.elementFromPoint(${rect.x},${rect.y})?.closest('[data-control-id]')?.dataset.controlId`),before.id,'pointer begins on text control');
   await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x,y:rect.y});await send('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x,y:rect.y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x+40,y:rect.y+10,button:'left',buttons:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x+40,y:rect.y+10,button:'left',clickCount:1});
   assert.equal(await evaluate("document.querySelector('.simulation-selected').style.left"),'130px');
   const handle=await evaluate("(()=>{const r=document.querySelector('.simulation-resize-handle').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
   await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:handle.x,y:handle.y});await send('Input.dispatchMouseEvent',{type:'mousePressed',x:handle.x,y:handle.y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:handle.x+20,y:handle.y+10,button:'left',buttons:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:handle.x+20,y:handle.y+10,button:'left',clickCount:1});
   assert.equal(await evaluate("document.querySelector('.simulation-selected').style.width"),'300px');
   await click('Lưu dashboard');await until(async()=>{const saved=(await api('/dashboards/'+board.id)).layout.find(x=>x.id===before.id);return saved.x===130&&saved.width===300;},'pointer position and size saved');
   const count=await evaluate("document.querySelectorAll('.simulation-control').length");await click('Nhãn văn bản');assert.equal(await evaluate("document.querySelectorAll('.simulation-control').length"),count+1);await click('Xóa phần tử');await click('Trực tiếp');
  }
  await send('Page.reload');await until(()=>evaluate("document.querySelectorAll('[data-state=on]').length===6"),'reload reopens live persisted layout');
  await send('Network.setBlockedURLs',{urls:['*/api/v1/tags']});await send('Page.reload');await until(()=>evaluate("document.querySelectorAll('[data-state=unavailable]').length===9"),'unavailable telemetry never masquerades as OFF');assert.equal(await evaluate("document.querySelectorAll('[data-state=off]').length"),0);await send('Network.setBlockedURLs',{urls:[]});await send('Page.reload');await until(()=>evaluate("document.querySelectorAll('[data-state=on]').length===6"),'shared source recovers after network interruption');
  const newTab=await send('Target.createTarget',{url});const attached=await send('Target.attachToTarget',{targetId:newTab.targetId,flatten:true});await until(async()=>{const result=await send('Runtime.evaluate',{expression:"document.querySelectorAll('.simulation-control').length>=17",returnByValue:true},attached.sessionId);return result.result.value;},'new tab restores server-saved dashboard');await send('Target.closeTarget',{targetId:newTab.targetId});
  mkdirSync('.tools/browser-evidence',{recursive:true});const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync('.tools/browser-evidence/simulation-dashboard-live.png',Buffer.from(screenshot.data,'base64'));
  await send('Emulation.setDeviceMetricsOverride',{width:720,height:1100,deviceScaleFactor:1,mobile:false});await pause(200);assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'page remains within viewport; canvas scroll is internal');
  await click('Giám sát vận hành · Phân tích');await until(()=>evaluate("!!document.querySelector('.native-dashboard')"),'standard workspace still accessible');
  if(process.env.SIMULATION_RELOAD_ONLY!=='1'){
   await click('Tạo dashboard');await input('Tên dashboard','UI creation '+suffix);await click('Tạo sơ đồ');await until(()=>evaluate("document.querySelector('.simulation-canvas')&&document.querySelectorAll('.simulation-control').length===0"),'UI-created dashboard opens empty');
   await click('Thiết kế');await click('Đèn báo trạng thái');await input('Tín hiệu',tagIDs[0]);await click('Lưu dashboard');
   const createdID=await evaluate("new URLSearchParams(location.search).get('simulation')");await until(async()=>{const doc=await api('/dashboards/'+createdID);return doc.layout.length===1&&doc.layout[0].binding?.tagId===tagIDs[0];},'palette and binding configuration saved through UI');
   await click('Trực tiếp');await until(()=>evaluate("document.querySelectorAll('[data-state=on]').length===1"),'UI-bound point renders live');
   await click('Giám sát vận hành · Phân tích');await api('/dashboards/'+createdID,'DELETE');
  }
  assert.deepEqual((await api('/dashboard/boards')).map(x=>x.id),baselineBoards.map(x=>x.id));assert.equal((await api('/dashboard')).length,baselineWidgets.length,'legacy widgets preserved');
  const current=await api('/dashboards/'+board.id);writeFileSync('.tools/simulation-acceptance.json',JSON.stringify({id:board.id,tagIDs,layout:current.layout}));
 }catch(error){if(evaluate){console.log(await evaluate('JSON.stringify({url:location.href,text:document.body.innerText.slice(-5500)})').catch(()=>''));try{mkdirSync('.tools/browser-evidence',{recursive:true});const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync('.tools/browser-evidence/simulation-failure.png',Buffer.from(image.data,'base64'));}catch{}}throw error;}finally{socket?.close();child.kill('SIGTERM');}
});
