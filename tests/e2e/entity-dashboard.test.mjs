import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';

// Configuration mutations are deliberately restricted to an isolated preview stack.
const envFile=process.env.RALLYX_ENV_FILE||'.tools/preview.env';
if(!envFile.includes('preview'))throw new Error('Use the isolated preview environment for native acceptance');
const env=Object.fromEntries(readFileSync(envFile,'utf8').split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
const base=process.env.RALLYX_BROWSER_BASE_URL||'http://web:8080';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,label){const end=Date.now()+60000;while(Date.now()<end){if(await check())return;await pause(250)}throw new Error('Timed out: '+label)}
let cookie='';
async function raw(path,method='GET',body,identity=cookie){const r=await fetch(base+'/api/v1'+path,{method,headers:{cookie:identity,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const text=await r.text();let value;try{value=JSON.parse(text)}catch{value=text}return {status:r.status,value,headers:r.headers};}
async function api(path,method='GET',body){const r=await raw(path,method,body);assert.ok(r.status<300,`${path}: ${r.status} ${JSON.stringify(r.value).slice(0,700)}`);return r.value;}
const runtime=id=>api(`/entities/${encodeURIComponent(id)}/dashboard-runtime`,'POST',{});

test('Native entity/profile/template configuration, real ingestion, visual editing and durable context', {timeout:480000},async()=>{
 const signed=await raw('/auth/login','POST',{username:env.ADMIN_USERNAME,password:env.ADMIN_PASSWORD},'');assert.equal(signed.status,200);cookie=signed.headers.get('set-cookie').split(';')[0];
 assert.equal((await raw('/entities','GET',undefined,'')).status,401);
 const suffix=Date.now().toString(36),profileName='Điện năng '+suffix,templateName='Giám sát máy dùng chung '+suffix,typeKey='compressor-'+suffix;
 const baselineBoards=await api('/dashboard/boards');const baselineWidgets=await api('/dashboard');
 const root=await api('/entities','POST',{name:'Nhà máy kiểm chứng '+suffix,type_key:'group'});
 const area=await api('/entities','POST',{name:'Khu vực khí nén '+suffix,type_key:'group',parent_id:root.id});
 const tagIDs=[];
 for(const [i,value] of [12,27].entries()){
  const tag=await api('/tags','POST',{device_id:'demo-motor-device',key:`native_${suffix}_${i}`,name:`Công suất máy ${i+1} ${suffix}`,data_type:'float64',unit:'kW',store_history:true,stale_seconds:30,metadata:{simulator_value:value}});tagIDs.push(tag.id);
 }
 await until(async()=>{const tags=await api('/tags');return tagIDs.every((id,i)=>tags.some(t=>t.id===id&&t.quality==='GOOD'&&t.value===[12,27][i]));},'real simulator adapter ingestion through Core');
 const child=spawn('chromium-browser',['--headless','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=9222','--user-data-dir=/tmp/rallyx-entity-browser-'+suffix,'--window-size=1720,1160','about:blank'],{stdio:'ignore'});
 let socket;let next=0;const pending=new Map();let evaluate,send;
 try{
  let targets;await until(async()=>{try{targets=await(await fetch('http://127.0.0.1:9222/json')).json();return targets.length>0}catch{return false}},'Chromium');
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  socket.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}};
  send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,sessionId}))});
  evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const text=()=>evaluate('document.body.innerText');
  async function click(label,scope='document'){
   const match=`Array.from(${scope}.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.querySelector('strong')?.textContent===${JSON.stringify(label)})`;
   await until(()=>evaluate(`!!(${match})`),'button '+label);
   await evaluate(`(()=>{const b=${match};if(b.disabled)throw new Error('Disabled button '+${JSON.stringify(label)});b.click()})()`);await pause(180);
  }
  async function field(label,value,tag='input',scope="document.querySelector('dialog')"){
   await evaluate(`(()=>{const el=Array.from(${scope}.querySelectorAll('label')).find(l=>l.textContent.startsWith(${JSON.stringify(label)}))?.querySelector(${JSON.stringify(tag)});if(!el)throw new Error('Missing field '+${JSON.stringify(label)});Object.getOwnPropertyDescriptor(${tag==='select'?'HTMLSelectElement':'HTMLInputElement'}.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('${tag==='select'?'change':'input'}',{bubbles:true}));})()`);await pause(180);
  }
  async function close(){await click('Đóng',"document.querySelector('dialog')");await until(()=>evaluate("!document.querySelector('dialog')"),'configuration closed');}
  async function selected(id){await until(()=>evaluate(`new URLSearchParams(location.search).get('entity')===${JSON.stringify(id)} && !!document.querySelector('.native-context-heading')`),'entity context '+id);}
  async function navigate(id){await send('Page.navigate',{url:base+'/?entity='+encodeURIComponent(id)+'#dashboards'});await selected(id);}
  async function createEntity(name,parentID,profileID){
   await click('+ Thêm thực thể');await until(()=>evaluate("document.querySelector('dialog select')?.options.length>1"),'entity catalogs');
   await field('Tên thực thể',name);await field('Loại thực thể',typeKey,'select');await field('Profile',profileID,'select');
   await field('Tìm thực thể cha',area.name);await pause(500);await field('Thực thể cha',parentID,'select');await field('Công suất định mức',45);
   await click('Lưu thực thể');await until(()=>evaluate("!document.querySelector('dialog')"),'entity saved');
   const matches=await api('/entities?search='+encodeURIComponent(name));const e=matches.find(e=>e.name===name);assert.ok(e);await selected(e.id);return e;
  }
  async function bind(entity,tagID){
   await click('Map tín hiệu');await field('Tìm nguồn theo tín hiệu / thiết bị','native_'+suffix);await pause(700);
   await until(()=>evaluate(`Array.from(document.querySelector('dialog select')?.options||[]).some(o=>o.value===${JSON.stringify(tagID)})`),'scoped source search');
   await field('Nguồn dữ liệu cho Công suất tác dụng',tagID,'select');await click('Áp dụng mapping');await until(()=>evaluate("!document.querySelector('dialog')"),'mapping saved');
   assert.equal((await api(`/entities/${entity.id}/bindings`))[0].tag_id,tagID);
  }
  await send('Page.enable');await send('Network.enable');await send('Network.setCookie',{name:'rallyx_session',value:cookie.split('=')[1],url:base,path:'/',httpOnly:true,sameSite:'Strict'});await navigate(area.id);
  await click('Tạo profile');await field('Tên profile',profileName);await field('Metric key','active_power');await field('Tên hiển thị','Công suất tác dụng');await field('Đơn vị','kW');await click('Lưu profile');await until(()=>evaluate("!document.querySelector('dialog')"),'profile persisted');
  const profile=(await api('/entity-profiles')).find(p=>p.name===profileName);assert.ok(profile);
  await click('+ Thêm thực thể');await click('Thêm loại thực thể');await field('Khóa loại',typeKey);await field('Tên loại','Máy nén kiểm chứng');await click('Thêm trường');
  await evaluate(`(()=>{for(const [label,value] of [['Khóa trường 1','rated_power'],['Tên trường 1','Công suất định mức']]){const el=document.querySelector('[aria-label="'+label+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
  await evaluate(`(()=>{const el=document.querySelector('[aria-label="Kiểu trường 1"]');el.value='number';el.dispatchEvent(new Event('change',{bubbles:true}));})()`);await click('Lưu loại thực thể');
  await until(()=>evaluate("document.querySelector('dialog h2')?.textContent==='Thêm thực thể'"),'return to entity setup');await close();
  const a=await createEntity('Máy nén A '+suffix,area.id,profile.id);await bind(a,tagIDs[0]);
  const before=(await api('/entity-dashboard-templates')).length;await click('Thiết kế / kéo thả');await field('Tên template',templateName);
  await until(()=>evaluate("!!document.querySelector('.native-inspector') && !!document.querySelector('.native-palette')"),'native builder');
  await pause(400);for(const label of ['Chỉ số','Đồng hồ','Thanh mức','Xu hướng nhiều tín hiệu'])await click(label,"document.querySelector('.native-palette')");
  await click('Xem trước');await until(()=>evaluate("document.querySelector('.native-builder-visual .native-number')?.textContent.includes('12')"),'real data preview');
  assert.equal((await api('/entity-dashboard-templates')).length,before,'preview does not save template');
  // Exercise actual pointer resizing and movement, rather than setting layout JSON directly.
  async function drag(label,dx,dy){
   const selector=`[aria-label=${JSON.stringify(label)}]`;await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await pause(120);
   const r=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
   await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x,y:r.y});await send('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x,y:r.y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+dx,y:r.y+dy,buttons:1,button:'left'});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:r.x+dx,y:r.y+dy,button:'left',clickCount:1});await pause(150);
  }
  const handles=await evaluate("Array.from(document.querySelectorAll('.native-resize')).map(e=>e.getAttribute('aria-label'))");assert.equal(handles.length,4);
  const width=await evaluate("document.querySelector('.native-builder-canvas').getBoundingClientRect().width");await drag(handles[0],width/24,0);
  assert.equal(await evaluate("document.querySelector('.native-dialog-footer .primary').disabled"),true,'layout change requires new preview');
  await click('Hoàn tác');await click('Xem trước');await pause(400);
  mkdirSync('.tools/browser-evidence',{recursive:true});await evaluate("document.querySelector('.native-dialog-body').scrollTop=0");const preview=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync('.tools/browser-evidence/entity-builder-preview.png',Buffer.from(preview.data,'base64'));
  await click('Áp dụng');await until(()=>evaluate("!document.querySelector('dialog')"),'published and assigned atomically');
  const saved=(await api('/entity-dashboard-templates')).find(t=>t.name===templateName);assert.ok(saved);const template=await api('/entity-dashboard-templates/'+saved.id);assert.equal(template.document.pages[0].widgets.length,4);
  assert.deepEqual(template.document.pages[0].widgets.slice(0,3).map(w=>[w.layout.x,w.layout.y]),[[0,0],[8,0],[16,0]],'compact first row');
  assert.ok(!tagIDs.some(id=>JSON.stringify(template.document).includes(id)),'shared template has no physical IDs');assert.equal((await runtime(a.id)).widgets[0].value,12);
  const b=await createEntity('Máy nén B '+suffix,area.id,profile.id);await bind(b,tagIDs[1]);
  await click('Thư viện dashboard');await click(templateName);await click('Dùng cho mục đang chọn');await until(()=>evaluate("!document.querySelector('dialog')"),'same template assigned to second entity');
  const second=await runtime(b.id);assert.equal(second.assignment.template_id,saved.id);assert.equal(second.widgets[0].value,27);
  await navigate(a.id);await until(()=>evaluate("document.querySelector('.native-canvas .native-number')?.textContent.includes('12')"),'first entity has own mapped data');
  await navigate(b.id);await until(()=>evaluate("document.querySelector('.native-canvas .native-number')?.textContent.includes('27')"),'second entity context changes data');
  // The profile default produces a new immutable profile version. Existing pinned entities remain stable.
  await click('Thư viện dashboard');await click(templateName);await field('Profile mặc định',profile.id,'select');await click('Đặt làm dashboard mặc định của profile');await until(()=>text().then(v=>v.includes('Đã tạo phiên bản profile mới')),'profile default persisted');await close();
  const newer=(await api('/entity-profiles')).find(p=>p.id===profile.id);assert.equal(newer.revision,2);assert.equal((await api('/entities/'+a.id)).profile_version,1);
  const c=await createEntity('Máy nén C '+suffix,area.id,profile.id);assert.equal((await runtime(c.id)).assignment.template_id,saved.id,'new profile member inherits shared dashboard');
  await navigate(b.id);await click('Thư viện dashboard');await click(templateName);
  const downloadDir='/tmp/rallyx-native-export-'+suffix;await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDir});await click('Xuất JSON');
  await until(()=>existsSync(downloadDir+'/rallyx-dashboard-template.json'),'template export');
  const exported=JSON.parse(readFileSync(downloadDir+'/rallyx-dashboard-template.json','utf8'));assert.deepEqual(exported.document,template.document);
  const beforeClone=(await api('/entity-dashboard-templates')).length;await click('Nhân bản template');await until(()=>evaluate("document.querySelector('dialog h2')?.textContent.includes('template dashboard')"),'unsaved clone');
  await click('Đóng',"document.querySelector('dialog')");assert.equal((await api('/entity-dashboard-templates')).length,beforeClone,'cancel clone does not persist');
  await evaluate("document.querySelector('dialog details').open=true");
  await evaluate(`(()=>{const el=document.querySelector('[aria-label="JSON template"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(JSON.stringify(exported))});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('Mở bản nhập để xem trước');await click('Xem trước');await until(()=>evaluate("document.querySelector('.native-builder-visual .native-number')?.textContent.includes('27')"),'imported semantic template binds current entity');
  assert.equal((await api('/entity-dashboard-templates')).length,beforeClone,'import preview does not persist');await click('Đóng',"document.querySelector('dialog')");await close();
  const aggregate={schema_version:1,pages:[{id:'main',name:'Vận hành khu vực',widgets:[
   {id:'sum',type:'value-card',title:'Tổng công suất',binding:{scope:'descendants',metric:'active_power'},aggregation:'sum',layout:{x:0,y:0,w:8,h:5},presentation:{precision:1}},
   {id:'states',type:'distribution',title:'Trạng thái máy',binding:{scope:'children',metric:''},layout:{x:8,y:0,w:16,h:8}},
   {id:'children',type:'entity-table',title:'Máy trong khu vực',binding:{scope:'children',metric:''},layout:{x:0,y:8,w:24,h:9}},
   {id:'alarms',type:'alarm-table',title:'Vấn đề cần xử lý',binding:{scope:'descendants',metric:''},layout:{x:0,y:17,w:24,h:7}}
  ]}]};
  const areaTemplate=await api('/entity-dashboard-templates','POST',{name:'Vận hành khu vực '+suffix,document:aggregate,publish:true,entity_id:area.id,assignment_revision:0});
  const total=await runtime(area.id);assert.equal(total.widgets[0].value,39);assert.equal(total.widgets[0].quality,'PARTIAL');assert.equal(total.widgets[0].expected,3,'new unmapped child affects coverage without changing template');
  const rule=await api('/rules','POST',{tag_id:tagIDs[0],name:'Công suất vượt ngưỡng '+suffix,type:'high',threshold:11,hysteresis:0,severity:'warning',enabled:true});
  await until(async()=>(await api('/alarms')).some(alarm=>alarm.rule_id===rule.id),'real Core alarm from mapped data point');
  await navigate(area.id);await until(()=>evaluate("document.querySelector('.native-canvas .native-number')?.textContent.includes('39')"),'aggregate rendering');
  await until(()=>evaluate(`Array.from(document.querySelectorAll('.native-problems button')).some(b=>b.textContent.includes(${JSON.stringify(rule.name)}))`),'scoped active alarm');
  await evaluate(`Array.from(document.querySelectorAll('.native-problems button')).find(b=>b.textContent.includes(${JSON.stringify(rule.name)})).click()`);await selected('legacy:assets:demo-motor');
  await navigate(area.id);
  await evaluate(`Array.from(document.querySelectorAll('.native-link')).find(b=>b.textContent.startsWith(${JSON.stringify(a.name)})).click()`);await selected(a.id);await until(()=>evaluate("document.querySelector('.native-canvas .native-number')?.textContent.includes('12')"),'drill down resolves shared machine template');
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync('.tools/browser-evidence/entity-dashboard-desktop.png',Buffer.from(shot.data,'base64'));
  await send('Page.reload');await selected(a.id);await until(()=>evaluate("document.querySelectorAll('.native-canvas .native-widget').length===4"),'server-saved template survives reload');
  const newTab=await send('Target.createTarget',{url:base+'/#dashboards'});const attached=await send('Target.attachToTarget',{targetId:newTab.targetId,flatten:true});
  await until(async()=>{try{const r=await send('Runtime.evaluate',{expression:`document.querySelector('.native-context-heading h2')?.textContent===${JSON.stringify(a.name)} && document.querySelectorAll('.native-widget').length===4`,returnByValue:true},attached.sessionId);return r.result.value}catch{return false}},'new tab restores same entity and persisted template');await send('Target.closeTarget',{targetId:newTab.targetId});await send('Page.bringToFront');
  await send('Emulation.setDeviceMetricsOverride',{width:720,height:1100,deviceScaleFactor:1,mobile:false});await pause(300);assert.equal(await evaluate('document.documentElement.scrollWidth>window.innerWidth'),false,'narrow viewport does not overflow');const narrow=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync('.tools/browser-evidence/entity-dashboard-narrow.png',Buffer.from(narrow.data,'base64'));
  assert.deepEqual((await api('/dashboard/boards')).map(x=>x.id),baselineBoards.map(x=>x.id),'old boards preserved');assert.equal((await api('/dashboard')).length,baselineWidgets.length,'old widgets preserved');
  // Role boundaries include read-only runtime and admin-only draft evaluation/configuration.
  const viewerName='native-viewer-'+suffix,pass='Native-viewer-test-12345';await api('/users','POST',{username:viewerName,password:pass,role:'viewer'});const viewer=await raw('/auth/login','POST',{username:viewerName,password:pass},'');const viewerCookie=viewer.headers.get('set-cookie').split(';')[0];if(viewer.value.must_change_password)await raw('/auth/password','POST',{current_password:pass,new_password:pass+'changed'},viewerCookie);
  assert.equal((await raw(`/entities/${a.id}/dashboard-runtime`,'POST',{},viewerCookie)).status,200);assert.equal((await raw(`/entities/${a.id}/dashboard-runtime`,'POST',{document:aggregate},viewerCookie)).status,403);assert.equal((await raw('/entities','POST',{name:'Forbidden',type_key:'group'},viewerCookie)).status,403);
  writeFileSync('.tools/entity-acceptance.json',JSON.stringify({root:root.id,area:area.id,a:a.id,b:b.id,c:c.id,template:saved.id,areaTemplate:areaTemplate.id,tagIDs,baselineBoards:baselineBoards.map(x=>x.id),baselineWidgetCount:baselineWidgets.length}));
  console.log('Native acceptance passed: real ingestion; custom hierarchy/profile/mapping; semantic template; preview/apply; pointer resize/undo; two contexts; inherited profile default; partial aggregation; drill-down; reload/new tab; narrow layout; permissions; legacy boards.');
 }catch(error){if(evaluate)console.log('Browser state:',await evaluate('JSON.stringify({url:location.href,text:document.body.innerText.slice(-7000)})').catch(()=>''));throw error;}finally{socket?.close();child.kill('SIGTERM');}
});
