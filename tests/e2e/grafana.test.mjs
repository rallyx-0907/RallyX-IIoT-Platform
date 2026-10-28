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
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value;};
  await send('Page.enable');await send('Network.enable');await send('Network.setCookie',{name:'rallyx_session',value:cookie.split('=')[1],url:base,path:'/',httpOnly:true,sameSite:'Strict'});
  await send('Page.navigate',{url:base+'/#dashboards'});
  await until(()=>evaluate(`!!document.querySelector('iframe')?.contentDocument?.body?.innerText.includes('Xu hướng nhiều tín hiệu')`),'authenticated embedded Grafana panel gallery');
  await until(()=>evaluate(`document.querySelector('iframe')?.contentDocument?.querySelectorAll('canvas').length > 0`),'rendered Grafana time series data');
  await pause(1500);
  const rendered=await evaluate(`document.querySelector('iframe').contentDocument.body.innerText`);
  assert.equal(/db query error|permission denied|Query error/i.test(rendered),false,'rendered panels have no SQL errors');
  mkdirSync('.tools',{recursive:true});writeFileSync('.tools/grafana-rendered-text.txt',rendered);
  assert.equal(await evaluate(`document.querySelector('iframe').contentDocument.querySelectorAll('input[type="password"]').length`),0,'no second login');
  const cookies=await send('Network.getAllCookies');assert.equal(cookies.cookies.some(c=>c.name==='grafana_session'),false,'no independent Grafana session');
  mkdirSync('.tools/browser-evidence',{recursive:true});const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync('.tools/browser-evidence/grafana-native.png',Buffer.from(shot.data,'base64'));
 }finally{socket?.close();child.kill('SIGTERM');}
}
