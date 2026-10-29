import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const envFile=process.env.RALLYX_ENV_FILE||'.tools/preview.env';
if(!envFile.includes('preview'))throw new Error('Use isolated preview');
const env=Object.fromEntries(readFileSync(envFile,'utf8').split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
const saved=JSON.parse(readFileSync('.tools/entity-acceptance.json','utf8'));
const base=process.env.RALLYX_BROWSER_BASE_URL||'http://web:8080';let cookie='';
async function api(path,method='GET',body){const r=await fetch(base+'/api/v1'+path,{method,headers:{cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,path);if(path==='/auth/login')cookie=r.headers.get('set-cookie').split(';')[0];return r.json();}
test('Native configuration survives service restart and operates without Grafana',{timeout:60000},async()=>{
 await api('/auth/login','POST',{username:env.ADMIN_USERNAME,password:env.ADMIN_PASSWORD});
 const a=await api(`/entities/${saved.a}/dashboard-runtime`,'POST',{}),b=await api(`/entities/${saved.b}/dashboard-runtime`,'POST',{}),area=await api(`/entities/${saved.area}/dashboard-runtime`,'POST',{});
 assert.equal(a.assignment.template_id,saved.template);assert.equal(b.assignment.template_id,saved.template);assert.equal(a.widgets[0].value,12);assert.equal(b.widgets[0].value,27);assert.equal(area.widgets[0].value,39);assert.equal(area.widgets[0].quality,'PARTIAL');
 assert.equal(a.document.pages[0].widgets.length,4);assert.ok(a.widgets.find(w=>w.type==='timeseries').series[0].points.length>0,'history survives');
 assert.deepEqual((await api('/dashboard/boards')).map(x=>x.id),saved.baselineBoards);assert.equal((await api('/dashboard')).length,saved.baselineWidgetCount);
 const before=(await api('/tags')).find(t=>t.id===saved.tagIDs[0]);await new Promise(r=>setTimeout(r,2500));const after=(await api('/tags')).find(t=>t.id===saved.tagIDs[0]);assert.ok(Date.parse(after.ts)>Date.parse(before.ts),'ingestion continues with Grafana stopped');
 console.log('Restart/independence passed: shared versions, mappings, history, ingestion and old boards retained.');
});
