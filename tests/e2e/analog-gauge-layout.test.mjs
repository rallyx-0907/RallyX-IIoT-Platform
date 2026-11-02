import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawn} from 'node:child_process';

const envFile=process.env.RALLYX_ENV_FILE||'.tools/preview.env';
if(!envFile.includes('preview'))throw new Error('Gauge acceptance requires isolated preview');
const env=Object.fromEntries(readFileSync(envFile,'utf8').split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
const base=process.env.RALLYX_BROWSER_BASE_URL||'http://web:8080',pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){for(let i=0;i<240;i++){if(await check())return;await pause(250);}throw new Error('Timed out: '+label);}
let cookie='';
async function api(path,method='GET',body){const r=await fetch(base+'/api/v1'+path,{method,headers:{cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();assert.ok(r.ok,path+': '+JSON.stringify(data));if(path==='/auth/login')cookie=r.headers.get('set-cookie').split(';')[0];return data;}

test('Analog gauge has disjoint label/drawing/value regions across resize, modes and viewports',{timeout:240000},async()=>{
 await api('/auth/login','POST',{username:env.ADMIN_USERNAME,password:env.ADMIN_PASSWORD});
 // Self-contained fixture: no dependency on a previous browser run or saved dashboard.
 const source={tagIDs:[]};const suffix=Date.now().toString(36);
 for(const [key,data_type,value,unit] of [['grid','bool',true,''],['generator','bool',false,''],['current','float64',125.5,'A'],['voltage','float64',382,'V']]){
  const tag=await api('/tags','POST',{device_id:'demo-motor-device',key:'gauge_'+suffix+'_'+key,name:'Gauge review '+key+' '+suffix,data_type,unit,stale_seconds:30,metadata:{simulator_value:value}});source.tagIDs.push(tag.id);
 }
 await until(async()=>{const tags=await api('/tags');return source.tagIDs.every(id=>tags.some(t=>t.id===id&&t.quality==='GOOD'));},'fixture ingestion');
 let serial=0;
 const control=(type,properties,tagId,zIndex=1)=>({id:'gauge-review-'+(++serial),type,x:0,y:0,width:80,height:50,rotation:0,zIndex,properties,...(tagId?{binding:{tagId,operator:'direct'}}:{})});
 const layout=[control('rectangle',{fill:'#f1f5f9',borderColor:'#94a3b8',borderWidth:2,borderRadius:12},undefined,0)];
 for(const [index,name] of ['GRID','GENERATOR','LOAD'].entries()){
  layout.push(control('text',{text:name,fontSize:24,fontWeight:'700',textAlign:'center'}));
  for(const [phase,label] of ['R','Y','B'].entries())layout.push(control('indicator-lamp',{label,onColor:['#ef4444','#eab308','#2563eb'][phase],offColor:'#94a3b8',borderStyle:'solid'},source.tagIDs[index===1?1:0]));
 }
 for(const label of ['Current R','Current Y','Current B'])layout.push(control('analog-gauge',{label,min:0,max:200,precision:1,unit:'A'},source.tagIDs[2]));
 layout.push(control('analog-gauge',{label:'Voltage',min:0,max:500,precision:0,unit:'V'},source.tagIDs[3]));
 layout.push(control('numeric-value',{label:'Voltage reading',unit:'V',precision:0,prefix:'',suffix:''},source.tagIDs[3]));
 const gauges=layout.filter(c=>c.type==='analog-gauge');assert.equal(gauges.length,4);
 let labelIndex=0,lampIndex=0,gaugeIndex=0;
 for(const c of layout){
  if(c.type==='rectangle')Object.assign(c,{x:10,y:10,width:880,height:660});
  if(c.type==='text'){const p=[[60,25],[540,25],[300,185]][labelIndex++];Object.assign(c,{x:p[0],y:p[1],width:240,height:35});}
  if(c.type==='indicator-lamp'){const group=Math.floor(lampIndex/3),phase=lampIndex++%3;Object.assign(c,{x:[60,540,300][group]+phase*80,y:group===2?230:80,width:80,height:100});}
  if(c.type==='analog-gauge'){const index=gaugeIndex++;Object.assign(c,{x:index===3?340:80+index*240,y:index===3?510:350,width:200,height:150});}
  if(c.type==='numeric-value')Object.assign(c,{x:620,y:540,width:180,height:80});
 }
 let board=await api('/dashboards','POST',{name:'Analog Gauge visual review',type:'simulation',canvas:{width:900,height:680,gridSize:10,snapToGrid:true,backgroundColor:'#ffffff'},layout});
 const child=spawn('chromium-browser',['--headless','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=9222','--user-data-dir=/tmp/rallyx-gauge-'+Date.now(),'--window-size=1900,1450','about:blank'],{stdio:'ignore'});
 let socket,send,ev;let next=0;const pending=new Map();
 try{
  let targets;await until(async()=>{try{targets=await(await fetch('http://127.0.0.1:9222/json')).json();return targets.some(x=>x.type==='page');}catch{return false;}},'Chromium');
  socket=new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}};
  send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  await send('Network.enable');await send('Network.setCookie',{name:cookie.split('=')[0],value:cookie.slice(cookie.indexOf('=')+1),url:base});
  const open=async()=>{await send('Page.navigate',{url:base+'/?simulation='+board.id+'#dashboards'});await until(()=>ev("document.querySelectorAll('.simulation-gauge').length===4"),'four gauges');};
  const click=async label=>{await ev(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()===${JSON.stringify(label)}).click()`);await pause(150);};
  const regions=async()=>{
   const result=await ev(`Array.from(document.querySelectorAll('.simulation-gauge')).map(root=>{const [label,drawing,value]=Array.from(root.children).map(x=>x.getBoundingClientRect());const box=root.getBoundingClientRect(),svg=root.querySelector('svg').getBoundingClientRect();const content=Array.from(root.querySelector('.simulation-gauge-value').children).filter(x=>getComputedStyle(x).display!=='none').map(x=>x.getBoundingClientRect());return {label:root.querySelector('.simulation-gauge-label').textContent,density:root.dataset.density,rows:[label.height,drawing.height,value.height],clear:label.bottom<=drawing.top+0.1&&drawing.bottom<=value.top+0.1,contained:label.top>=box.top&&value.bottom<=box.bottom+0.1,contentContained:content.every(x=>x.top>=value.top-0.1&&x.bottom<=value.bottom+0.1),svgContained:svg.top>=drawing.top&&svg.bottom<=drawing.bottom+0.1};})`);
   assert.ok(result.every(x=>x.clear&&x.contained&&x.contentContained&&(x.density!=='normal'||x.svgContained)),JSON.stringify(result));return result;
  };
  await open();await until(()=>ev("document.querySelector('.simulation-gauge-value').innerText.includes('125.5')"),'live current');await regions();
  const target=gauges[0].id;
  for(const [width,height] of [[50,40],[120,90],[150,120],[220,170],[400,200],[180,360],[320,80]]){
   board=await api('/dashboards/'+board.id,'PATCH',{revision:board.revision,layout:layout.map(c=>c.id===target?{...c,x:0,y:0,width,height}:c)});await open();await regions();
  }
  board=await api('/dashboards/'+board.id,'PATCH',{revision:board.revision,layout});await open();const liveRegions=await regions();
  await click('Xem thử');assert.deepEqual((await regions()).map(x=>x.rows),liveRegions.map(x=>x.rows),'Preview and Live use identical region geometry');assert.equal(await ev("document.querySelectorAll('.simulation-gauge circle').length"),0,'unavailable preview has no needle');
  const tags=await api('/tags');
  for(const id of source.tagIDs){const tag=tags.find(t=>t.id===id);const value=tag.datatype==='boolean'?'true':String(tag.value);await ev(`(()=>{const input=Array.from(document.querySelectorAll('.simulation-inspector label')).find(x=>x.textContent.startsWith(${JSON.stringify(tag.name)}))?.querySelector('input,select');Object.getOwnPropertyDescriptor(input.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));input.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));})()`);}
  await until(()=>ev("document.querySelectorAll('.simulation-gauge circle').length===4"),'preview needles');await regions();
  const directory='docs/review-assets/analog-gauge';mkdirSync(directory,{recursive:true});
  const shot=async name=>{await ev('scrollTo(0,0)');const clip=await ev("(()=>{const toolbar=document.querySelector('.simulation-toolbar').getBoundingClientRect(),canvas=document.querySelector('.simulation-scroll').getBoundingClientRect(),main=document.querySelector('main').getBoundingClientRect();return {x:main.left,y:toolbar.top,width:innerWidth-main.left-16,height:canvas.bottom-toolbar.top+16,scale:1};})()");const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});writeFileSync(directory+'/'+name+'.png',Buffer.from(image.data,'base64'));};
  await click('Trực tiếp');await until(()=>ev("document.querySelector('.simulation-gauge-value').innerText.includes('125.5')"),'live again');await regions();await shot('live-desktop');
  await click('Thiết kế');await ev(`document.querySelector('[data-control-id="${gauges[3].id}"]').click()`);await regions();await shot('design-desktop');
  await send('Emulation.setDeviceMetricsOverride',{width:720,height:1250,deviceScaleFactor:1,mobile:false});await pause(200);await regions();assert.equal(await ev('document.documentElement.scrollWidth>innerWidth'),false);await ev('document.querySelector(".simulation-scroll").scrollLeft=240');await shot('design-narrow');
  await click('Trực tiếp');await regions();assert.equal(await ev('document.documentElement.scrollWidth>innerWidth'),false);await shot('live-narrow');
  writeFileSync('.tools/gauge-layout-acceptance.json',JSON.stringify({dashboard:board.id,sizes:7,viewports:[1900,720],screenshots:directory}));
 }finally{socket?.close();child.kill('SIGTERM');}
});
