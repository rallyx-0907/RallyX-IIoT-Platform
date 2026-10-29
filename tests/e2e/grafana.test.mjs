import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
const envPath=process.env.RALLYX_ENV_FILE||'.env';
const env=Object.fromEntries(readFileSync(envPath,'utf8').split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
const base=process.env.RALLYX_BROWSER_BASE_URL||'http://web:8080';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,label){const end=Date.now()+60000;while(Date.now()<end){if(await check())return;await pause(250)}throw new Error('Timed out: '+label)}
let cookie='';
async function raw(path,method='GET',body,identity=cookie){const r=await fetch(base+path,{method,headers:{cookie:identity,'content-type':'application/json','X-WEBAUTH-USER':'admin','X-WEBAUTH-ROLE':'Admin'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const text=await r.text();let value;try{value=JSON.parse(text)}catch{value=text}return{status:r.status,value,headers:r.headers};}
async function api(path,method='GET',body){const r=await raw(path,method,body);assert.ok(r.status<300,`${path}: ${r.status} ${JSON.stringify(r.value).slice(0,400)}`);return r.value;}
async function login(username,password){const r=await raw('/api/v1/auth/login','POST',{username,password},'');assert.equal(r.status,200);return{user:r.value,cookie:r.headers.get('set-cookie').split(';')[0]};}
const ds={type:'grafana-postgresql-datasource',uid:'rallyx-reporting'};
async function query(sql,format='table'){return raw('/grafana/api/ds/query','POST',{from:String(Date.now()-3600000),to:String(Date.now()),queries:[{refId:'A',datasource:ds,rawSql:sql,format,intervalMs:10000,maxDataPoints:300}]});}
function rows(result){const f=result.value.results?.A?.frames?.[0];if(!f)return[];return Array.from({length:f.data.values[0]?.length||0},(_,i)=>Object.fromEntries(f.schema.fields.map((field,j)=>[field.name,f.data.values[j][i]])));}
function noQueryError(r){assert.equal(r.status,200,JSON.stringify(r.value).slice(0,500));assert.equal(r.value.results?.A?.error,undefined,JSON.stringify(r.value).slice(0,500));}
test('Grafana shares RallyX identity, queries read-only reporting and preserves dashboard editing', {timeout:180000},async()=>{
 assert.equal((await raw('/grafana/api/user','GET',undefined,'')).status,401,'forged headers cannot replace session');
 const signed=await login(env.ADMIN_USERNAME,env.ADMIN_PASSWORD);cookie=signed.cookie;assert.equal(signed.user.must_change_password,false);
 const user=await api('/grafana/api/user');assert.equal((await api('/grafana/api/user/orgs')).find(o=>o.orgId===user.orgId)?.role,'Editor');assert.equal(user.isGrafanaAdmin,false);
 const status=await api('/api/v1/grafana/status');assert.equal(status.available,true);
 const meta=await query('SELECT tag_id,asset_id FROM rallyx_reporting.tag_catalog WHERE NOT archived ORDER BY tag_id LIMIT 30');noQueryError(meta);const tags=rows(meta);assert.ok(tags.length);
 const quote=values=>[...new Set(values)].map(v=>"'"+v.replaceAll("'","''")+"'").join(',');
 const dashboard=await api('/grafana/api/dashboards/uid/rallyx-overview');assert.ok(dashboard.dashboard.panels.length>=8);
 if(process.env.RALLYX_GRAFANA_RESTORE_CHECK==='true'){const saved=JSON.parse(readFileSync('.tools/grafana-acceptance.json','utf8'));assert.equal((await api('/grafana/api/dashboards/uid/'+saved.uid)).dashboard.uid,saved.uid,'user-created dashboard survived restore');}
 for(const panel of dashboard.dashboard.panels){
  const target=panel.targets[0];const sql=target.rawSql.replaceAll('${tag:sqlstring}',quote(tags.map(t=>t.tag_id))).replaceAll('${asset:sqlstring}',quote(tags.map(t=>t.asset_id))).replaceAll('$__interval',"'10s'");
  const response=await query(sql,target.format);noQueryError(response);console.log('Panel query OK:',panel.type,panel.title);
 }
 const forbidden=await query('SELECT password_hash FROM public.users');assert.ok(forbidden.status>=400||forbidden.value.results?.A?.error,'credential reads must fail');
 const write=await query('DELETE FROM public.telemetry_samples');assert.ok(write.status>=400||write.value.results?.A?.error,'business writes must fail');
 const before=await api('/api/v1/tags');await pause(2200);await query('SELECT count(*) FROM rallyx_reporting.current_values');const after=await api('/api/v1/tags');assert.ok(after.some(tag=>tag.quality==='GOOD'&&Date.parse(tag.ts)>Date.parse(before.find(t=>t.id===tag.id)?.ts)),'ingestion continues while panels query');
 if(process.env.RALLYX_GRAFANA_WRITE_TEST==='true'){
  const uid='rallyx-test-'+Date.now();await api('/grafana/api/dashboards/db','POST',{dashboard:{uid,title:'RallyX persisted acceptance '+uid,schemaVersion:39,panels:[]},overwrite:false});
  assert.equal((await api('/grafana/api/dashboards/uid/'+uid)).dashboard.uid,uid);
  const name='grafana-viewer-'+Date.now();await api('/api/v1/users','POST',{username:name,password:'grafana-viewer-fixture-12345',role:'viewer'});const viewer=await login(name,'grafana-viewer-fixture-12345');const adminCookie=cookie;cookie=viewer.cookie;
  if(viewer.user.must_change_password)await api('/api/v1/auth/password','POST',{current_password:'grafana-viewer-fixture-12345',new_password:'grafana-viewer-changed-12345'});
  assert.equal((await api('/grafana/api/user/orgs'))[0].role,'Viewer');
  assert.equal((await raw('/grafana/api/dashboards/db','POST',{dashboard:{title:'Forbidden',panels:[]},overwrite:false})).status,403);
  cookie=adminCookie;mkdirSync('.tools',{recursive:true});writeFileSync('.tools/grafana-acceptance.json',JSON.stringify({uid}));
 }
 if(process.env.RALLYX_GRAFANA_BROWSER==='true')await checkBrowser();
 await api('/api/v1/auth/logout','POST',{});assert.equal((await raw('/grafana/api/user')).status,401,'logout immediately blocks Grafana');
});

async function checkBrowser(){
 const child=spawn('chromium-browser',['--headless','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=9222','--user-data-dir=/tmp/rallyx-grafana-browser','--window-size=1600,1100','about:blank'],{stdio:'ignore'});
 let socket;let next=0;const pending=new Map();
 try{
  let targets;await until(async()=>{try{targets=await(await fetch('http://127.0.0.1:9222/json')).json();return targets.length>0}catch{return false}},'Chromium');
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  socket.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}};
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,sessionId}))});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value;};
  async function verifyNewTab(uid){
   const target=await send('Target.createTarget',{url:base+'/#legacy-dashboards'});
   try{
    const attached=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
    const tabEval=async expression=>{try{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},attached.sessionId);if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value;}catch(error){if(error.code===-32000)return undefined;throw error;}};
    async function reloadTab(){const before=await tabEval('performance.timeOrigin');await send('Page.reload',{},attached.sessionId);await until(async()=>{const current=await tabEval('performance.timeOrigin');return current&&current!==before;},'new document after reload');}
    try{await until(async()=>String(await tabEval(`document.querySelector('iframe')?.getAttribute('src')`)).includes('/'+uid+'?kiosk'),'same saved dashboard in genuinely new tab');}catch(error){console.log('Expected UID',uid,'final tab state',await tabEval(`JSON.stringify({url:location.href,frame:document.querySelector('iframe')?.getAttribute('src'),text:document.body.innerText.slice(-2000)})`));throw error;}
    assert.equal(await tabEval(`!!document.querySelector('nav a[href="#widgets"]')`),false,'one dashboard navigation entry');
    await reloadTab();
    await until(async()=>String(await tabEval(`document.querySelector('iframe')?.getAttribute('src')`)).includes('/'+uid+'?kiosk'),'same dashboard after new-tab reload');
    const simple=await api('/api/v1/dashboard/boards');
    if(simple.length){
     const board=simple[0];
     await tabEval(`Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')===${JSON.stringify(board.name+' · Bảng theo dõi đơn giản')}).click()`);
     await until(()=>tabEval(`document.querySelector('.dashboard-board-bar select')?.value===${JSON.stringify(board.id)}`),'existing simple board recovered through main dashboard page');
     await reloadTab();
     await until(()=>tabEval(`document.querySelector('.dashboard-board-bar select')?.value===${JSON.stringify(board.id)}`),'existing simple board survives new-tab reload');
     const stored=await api('/api/v1/dashboard');const expected=stored.filter(widget=>widget.board_id===board.id).length;
     await until(()=>tabEval(`document.querySelectorAll('.dashboard-widget').length===${expected}`),'all server-saved simple board widgets still present');
     console.log('Existing simple dashboard retained:',board.name,'widgets:',expected);
    }
    console.log('New tab, reload and unified saved dashboard discovery passed');
   }finally{await send('Target.closeTarget',{targetId:target.targetId});await send('Page.bringToFront');await pause(500);}
  }
  await send('Page.enable');await send('Network.enable');await send('Network.setCookie',{name:'rallyx_session',value:cookie.split('=')[1],url:base,path:'/',httpOnly:true,sameSite:'Strict'});
  await send('Page.navigate',{url:base+'/#dashboards'});
  if(process.env.RALLYX_GRAFANA_REOPEN_ONLY==='true'){
   const existing=(await api('/grafana/api/search?type=dash-db')).find(board=>board.uid!=='rallyx-overview');assert.ok(existing);
   await send('Page.navigate',{url:base+'/?dashboard='+encodeURIComponent(existing.uid)+'#dashboards'});
   await until(async()=>String(await evaluate(`document.querySelector('iframe')?.getAttribute('src')`)).includes('/'+existing.uid+'?kiosk'),'explicit saved dashboard link');
   await verifyNewTab(existing.uid);return;
  }
  await until(()=>evaluate(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Tạo dashboard')`),'point dashboard creation entry');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Tạo dashboard').click()`);
  const available=await api('/api/v1/tags');
  const chosen=available.find(p=>p.quality==='GOOD'&&!['bool','string'].includes(p.data_type)&&p.store_history!==false&&(!process.env.RALLYX_GRAFANA_POINT_KEY||p.key===process.env.RALLYX_GRAFANA_POINT_KEY));assert.ok(chosen,'numeric point for wizard');
  async function select(label,value){await evaluate(`(()=>{const el=Array.from(document.querySelectorAll('label')).find(l=>l.textContent.startsWith(${JSON.stringify(label)})).querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(200);}
  await until(()=>evaluate(`document.querySelectorAll('.point-option').length>0`),'loaded hierarchy and points');
  const chosenGroup=[chosen,...available.filter(p=>p.id!==chosen.id&&p.quality==='GOOD'&&!['bool','boolean','string'].includes(p.data_type)&&p.store_history!==false)].slice(0,4);
  for(const p of chosenGroup){await select('Thiết bị',p.device_id);await evaluate(`document.querySelector('input[type="checkbox"][value="'+${JSON.stringify(p.id)}+'"]').click()`);}
  await evaluate(`(()=>{const input=Array.from(document.querySelectorAll('label')).find(l=>l.textContent.startsWith('Tên dashboard')).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(process.env.RALLYX_GRAFANA_DASHBOARD_TITLE||'Giám sát nhà máy · Nhiều thiết bị')});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  for(let i=1;i<chosenGroup.length;i++)await evaluate(`(()=>{const el=document.querySelectorAll('.chart-setting select')[${i}];Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(['timeseries','gauge','bargauge','stat'][i])});el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const beforeBoards=(await api('/grafana/api/search?type=dash-db')).length;
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Xem trước').click()`);
  await until(()=>evaluate(`document.querySelectorAll('.visual-card .quality-good').length>0`),'real current data in preview');
  assert.equal((await api('/grafana/api/search?type=dash-db')).length,beforeBoards,'preview does not save a dashboard');
  mkdirSync('.tools/browser-evidence',{recursive:true});const previewShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync('.tools/browser-evidence/dashboard-preview.png',Buffer.from(previewShot.data,'base64'));  const previousFrame=await evaluate(`document.querySelector('iframe')?.getAttribute('src')`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Áp dụng').click()`);
  await until(async()=>{const src=await evaluate(`document.querySelector('iframe')?.getAttribute('src')`);return !!src&&src!==previousFrame;},'newly saved point dashboard iframe');
  await evaluate(`document.querySelector('iframe').scrollIntoView({block:'start'})`);
  const frameURL=await evaluate(`document.querySelector('iframe').getAttribute('src')`);const uid=frameURL.split('/')[3].split('?')[0];
  const created=await api('/grafana/api/dashboards/uid/'+uid);assert.ok(created.dashboard.tags.includes('rallyx-workspace'));
  for(const panel of created.dashboard.panels){assert.ok(chosenGroup.some(p=>panel.targets[0].rawSql.includes("tag_id = '"+p.id+"'")));const result=await query(panel.targets[0].rawSql.replaceAll('$__interval',"'10s'"),panel.targets[0].format);noQueryError(result);}
  await until(()=>evaluate(`document.querySelector('iframe')?.contentDocument?.querySelectorAll('canvas').length > 0`),'rendered point time series');

  await pause(5500);
  const rendered=await evaluate(`document.querySelector('iframe').contentDocument.body.innerText`);
  assert.equal(/db query error|permission denied|Query error/i.test(rendered),false,'rendered panels have no SQL errors');
  mkdirSync('.tools',{recursive:true});writeFileSync('.tools/grafana-rendered-text.txt',rendered);
  assert.equal(await evaluate(`document.querySelector('iframe').contentDocument.querySelectorAll('input[type="password"]').length`),0,'no second login');
  const cookies=await send('Network.getAllCookies');assert.equal(cookies.cookies.some(c=>c.name==='grafana_session'),false,'no independent Grafana session');
  mkdirSync('.tools/browser-evidence',{recursive:true});const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync('.tools/browser-evidence/grafana-native.png',Buffer.from(shot.data,'base64'));
  if(process.env.RALLYX_GRAFANA_REOPEN==='true')await verifyNewTab(uid);
  if(process.env.RALLYX_GRAFANA_LAYOUT==='true'){
   await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Tùy chỉnh / kéo thả').click()`);
   await until(()=>evaluate(`!!document.querySelector('[aria-label="Di chuyển ô 1"]')`),'layout editor loaded');
   async function drag(label,dx,dy){
    await evaluate(`document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"').scrollIntoView({block:'center'})`);await pause(150);
    const r=await evaluate(`(()=>{const r=document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x,y:r.y});await send('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x,y:r.y,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+dx,y:r.y+dy,button:'left',buttons:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:r.x+dx,y:r.y+dy,button:'left',clickCount:1});await pause(200);
   }
   const width=await evaluate(`document.querySelector('.editor-canvas').getBoundingClientRect().width`);
   await drag('Đổi kích thước ô 1',-width/4,0);await drag('Di chuyển ô 1',width/4,64);
   await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Thêm ô dữ liệu')).click()`);
   const other=available.find(p=>p.id!==chosen.id&&p.quality==='GOOD'&&!['bool','string'].includes(p.data_type))||chosen;
   await select('Thiết bị',other.device_id);await select('Điểm dữ liệu',other.id);await select('Kiểu hiển thị','gauge');
   await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Thêm vào dashboard').click()`);
   await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Lưu dashboard').click()`);
   await until(()=>evaluate(`document.body.innerText.includes('Đã lưu bố cục dashboard.')`),'layout save');
   const saved=(await api('/grafana/api/dashboards/uid/'+uid)).dashboard;assert.equal(saved.panels.length,chosenGroup.length*2+1);assert.equal(saved.panels[0].gridPos.w,6);assert.equal(saved.panels[0].gridPos.x,6);assert.equal(saved.panels[0].gridPos.y,2);assert.equal(saved.panels.at(-1).type,'gauge');assert.ok(saved.panels.at(-1).targets[0].rawSql.includes("tag_id = '"+other.id+"'"));
   await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Đóng trình chỉnh sửa').click()`);
   await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Tùy chỉnh / kéo thả').click()`);
   await until(()=>evaluate(`document.querySelectorAll('.editor-tile').length===${chosenGroup.length*2+1}`),'saved layout reopened');
   assert.equal(await evaluate(`document.querySelector('.editor-tile').style.left`),'25%');
   await evaluate(`document.querySelector('.dashboard-editor').scrollIntoView({block:'start'})`);
   const layoutShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync('.tools/browser-evidence/flexible-editor.png',Buffer.from(layoutShot.data,'base64'));
   console.log('Pointer drag, resize, add gauge, versioned save and reopen passed');
  }
 }finally{socket?.close();child.kill('SIGTERM');}
}
