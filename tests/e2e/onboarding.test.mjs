import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {createRequire} from 'node:module';
const {connectAsync}=createRequire(new URL('../../apps/connectivity/package.json',import.meta.url))('mqtt');
const envFile=process.env.RALLYX_ENV_FILE||'.tools/preview.env';
if(!envFile.includes('preview'))throw new Error('Run onboarding acceptance only against isolated preview');
const env=Object.fromEntries(readFileSync(envFile,'utf8').split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
const base=process.env.RALLYX_BROWSER_BASE_URL||'http://web:8080',pause=ms=>new Promise(r=>setTimeout(r,ms));
let onTimeout=async()=>'';
async function until(check,label){const end=Date.now()+45000;while(Date.now()<end){if(await check())return;await pause(200)}throw new Error('Timed out: '+label+' '+await onTimeout())}
let cookie='';
async function raw(path,method='GET',body,identity=cookie){const r=await fetch(base+'/api/v1'+path,{method,headers:{cookie:identity,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(40000)});return {status:r.status,value:await r.json(),headers:r.headers}}
async function api(path,method='GET',body){const r=await raw(path,method,body);assert.ok(r.status<300,path+': '+r.status+' '+JSON.stringify(r.value));return r.value}
test('three-screen Modbus onboarding, one-screen reuse, transient MQTT discovery and durable native dashboard',{timeout:240000},async t=>{
 const login=await raw('/auth/login','POST',{username:env.ADMIN_USERNAME,password:env.ADMIN_PASSWORD},'');assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
 const suffix=Date.now().toString(36),functions=[],sockets=new Set();
 const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer=Buffer.alloc(0);socket.on('data',bytes=>{buffer=Buffer.concat([buffer,bytes]);while(buffer.length>=6&&buffer.length>=6+buffer.readUInt16BE(4)){const size=6+buffer.readUInt16BE(4),frame=buffer.subarray(0,size);buffer=buffer.subarray(size);functions.push(frame[7]);assert.equal(frame[7],3,'field integration must remain read-only');const count=frame.readUInt16BE(10),reply=Buffer.alloc(9+count*2);frame.copy(reply,0,0,7);reply.writeUInt16BE(3+count*2,4);reply[7]=3;reply[8]=count*2;for(let i=0;i<count;i++)reply.writeUInt16BE(42+frame.readUInt16BE(8)+i,9+i*2);socket.write(reply)}})});
 await new Promise(resolve=>server.listen(8502,'0.0.0.0',resolve));t.after(()=>{for(const s of sockets)s.destroy();server.close()});
 const before={devices:(await api('/devices')).length,connections:(await api('/connections')).length,boards:await api('/dashboard/boards'),widgets:await api('/dashboard')};
 const child=spawn('chromium-browser',['--headless','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=9223','--user-data-dir=/tmp/rallyx-onboarding-'+suffix,'--window-size=1720,1160','about:blank'],{stdio:'ignore'});t.after(()=>child.kill());
 let targets;await until(async()=>{try{targets=await(await fetch('http://127.0.0.1:9223/json')).json();return targets.length}catch{return false}},'Chromium');
 const ws=new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});t.after(()=>ws.close());let seq=0;const pending=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 async function click(label){const match="Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==="+JSON.stringify(label)+"||b.querySelector('strong')?.textContent==="+JSON.stringify(label)+")";await until(()=>evaluate('!!('+match+')'),'button '+label);await evaluate('(()=>{const b='+match+";if(b.disabled)throw new Error('Disabled');b.click()})()");await pause(200)}
 async function field(label,value,tag='input'){await evaluate("(()=>{const e=Array.from(document.querySelectorAll('dialog label')).find(l=>l.textContent.startsWith("+JSON.stringify(label)+"))?.querySelector("+JSON.stringify(tag)+")||document.querySelector("+JSON.stringify('[aria-label="'+label+'"]')+");if(!e)throw new Error((document.querySelector('dialog')?.innerText||'NO DIALOG')+' Field missing: '+"+JSON.stringify(label)+");Object.getOwnPropertyDescriptor("+(tag==='select'?'HTMLSelectElement':'HTMLInputElement')+".prototype,'value').set.call(e,"+JSON.stringify(value)+");e.dispatchEvent(new Event('"+(tag==='select'?'change':'input')+"',{bubbles:true}))})()");await pause(150)}
 async function screenshot(name){mkdirSync('.tools/browser-evidence',{recursive:true});const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync('.tools/browser-evidence/'+name+'.png',Buffer.from(shot.data,'base64'))}
 onTimeout=async()=>{await screenshot('ux-failure');return evaluate('document.body.innerText')};
 await send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Ho_Chi_Minh'});
 await send('Network.enable');await send('Network.setCookie',{name:'rallyx_session',value:cookie.split('=')[1],url:base,path:'/',httpOnly:true,sameSite:'Strict'});await send('Page.navigate',{url:base+'/#dashboards'});await click('+ Thêm thiết bị');
 const started=Date.now();await field('Địa chỉ IP / tên máy','rallyx-ux-browser');await field('Cổng',8502);await click('Kiểm tra kết nối');await until(()=>evaluate("document.body.innerText.includes('Đã kết nối, phản hồi')"),'real connection preview');
 await click('Tiếp tục');await click('Không có mẫu phù hợp');await field('Đến thanh ghi',40003);await click('Quét dải thanh ghi');await until(()=>evaluate("document.querySelectorAll('.onboarding-signals tbody tr').length===3"),'bounded Modbus scan');
 await field('Tên tín hiệu 1','Công suất tác dụng');await field('Đơn vị tín hiệu 1',' kW ');await field('Lưu thành mẫu thiết bị','Đồng hồ kiểm chứng '+suffix);
 assert.equal((await api('/devices')).length,before.devices);assert.equal((await api('/connections')).length,before.connections,'preview leaves no connection drafts');await evaluate("document.querySelector('.onboarding-signals').scrollIntoView({block:'center'})");await screenshot('ux-onboarding-preview');
 await click('Tiếp tục');await field('Tên thiết bị','Đồng hồ A '+suffix);await screenshot('ux-onboarding-location');await click('Hoàn tất');
 await until(()=>evaluate("!document.querySelector('dialog') && document.querySelector('.native-context-heading h2')?.textContent==="+JSON.stringify('Đồng hồ A '+suffix)),'opens new native dashboard');
 const elapsed=Date.now()-started;assert.ok(elapsed<120000,'three-screen onboarding stays under two minutes');
 const created=(await api('/devices')).find(d=>d.name==='Đồng hồ A '+suffix);assert.ok(created);
 await until(async()=>{const r=await api('/entities/legacy:devices:'+created.id+'/dashboard-runtime','POST',{});return r.widgets.some(w=>w.value===42&&w.unit==='kW')},'real Modbus -> worker -> MQTT -> Core -> native runtime');
 assert.equal((await api('/entities/legacy:devices:'+created.id+'/bindings')).length,3);await until(()=>evaluate("document.querySelector('.native-canvas .native-number')?.textContent.includes('42')"),'native value rendered');await screenshot('ux-native-dashboard');
 await click('Chỉnh sửa');await click('Thêm thiết bị cùng loại');await until(()=>evaluate("document.querySelector('dialog [aria-current=step]')?.textContent.includes('Đặt vị trí')"),'one-screen same-kind reuse');await field('Tên thiết bị','Đồng hồ B '+suffix);await field('Mã thiết bị',2);await click('Hoàn tất');await until(()=>evaluate("!document.querySelector('dialog') && document.querySelector('.native-context-heading h2')?.textContent==="+JSON.stringify('Đồng hồ B '+suffix)),'second device directly opens native');
 await send('Page.reload');await until(()=>evaluate("document.querySelector('.native-context-heading h2')?.textContent==="+JSON.stringify('Đồng hồ B '+suffix)),'dashboard persists across reload');
 const site=(await api('/sites'))[0],publisher=await connectAsync('mqtt://broker:1883');t.after(()=>publisher.endAsync(true));const topic='ux/'+suffix+'/sensor';
 const mqttInput={connection:{name:'Transient MQTT',protocol:'mqtt',protocol_config:{broker_url:'mqtt://broker:1883',topic:'ux/'+suffix+'/#'},timeout_ms:1000},operation:'listen',listen_seconds:10};
 const listening=api('/onboarding/preview','POST',mqttInput),timer=setInterval(()=>void publisher.publishAsync(topic,JSON.stringify({device_id:'field-external',values:{temperature:0,running:false},units:{temperature:'°C'}})),200);
 let sample;try{sample=await listening}finally{clearInterval(timer)}assert.ok(sample.fields.some(f=>f.value===0&&f.path==='values.temperature'&&f.source_device_id==='field-external'));assert.ok(sample.fields.some(f=>f.value===false));
 assert.equal((await api('/connections')).length,before.connections+1,'MQTT listening creates no saved connection');
 const mqttDevice=await api('/onboarding/complete','POST',{...mqttInput,request_id:crypto.randomUUID(),device_name:'MQTT '+suffix,location:{site_id:site.id,area_name:'MQTT area '+suffix,asset_name:'MQTT machine '+suffix},signals:sample.fields.map((f,i)=>({key:'signal_'+i,name:f.name,data_type:f.data_type,unit:f.unit,mapping:{topic:f.topic,path:f.path,device_id:f.source_device_id},store_history:true}))});
 const mqttTimer=setInterval(()=>void publisher.publishAsync(topic,JSON.stringify({device_id:'field-external',values:{temperature:0,running:false},units:{temperature:'°C'}})),200);
 try{await until(async()=>{const r=await api('/entities/'+mqttDevice.entity_id+'/dashboard-runtime','POST',{});return r.widgets.some(w=>w.value===0)&&r.widgets.some(w=>w.value===false)},'discovered MQTT fields ingest into native dashboard')}finally{clearInterval(mqttTimer)}
 assert.deepEqual((await api('/dashboard/boards')).map(b=>b.id),before.boards.map(b=>b.id));assert.equal((await api('/dashboard')).length,before.widgets.length);assert.ok(functions.length>0&&functions.every(f=>f===3));
 const board=await api('/dashboard/boards','POST',{name:'Bảng chuyển đổi '+suffix});
 const tag=(await api('/tags')).find(v=>v.device_id===created.id);
 await api('/dashboard','POST',{tag_id:tag.id,type:'value',board_id:board.id});
 await click('Chỉnh sửa');await click('Chuyển bảng theo dõi cũ');await until(()=>evaluate("Array.from(document.querySelectorAll('dialog select option')).some(o=>o.value==="+JSON.stringify(board.id)+")"),'migration catalog');
 await field('Bảng đã lưu',board.id,'select');await evaluate("document.querySelector('dialog input[type=checkbox]').click()");await click('Tạo bản dashboard dùng chung');
 await until(()=>evaluate("!document.querySelector('dialog') && document.querySelector('.native-context-heading h2')?.textContent==="+JSON.stringify(board.name)),'shared native copy');
 const migrated=await api('/dashboard-boards/'+board.id+'/migrate-native','POST');
 assert.equal(migrated.entity_id,'legacy-dashboard:'+board.id);assert.equal((await api('/dashboard')).filter(w=>w.board_id===board.id).length,1,'migration retains legacy original');
 await click('+ Thêm thiết bị');await until(()=>evaluate("!!document.querySelector('dialog')"),'cancel wizard opened');await click('Hủy');
 const count=(await api('/devices')).length;await pause(250);assert.equal((await api('/devices')).length,count,'cancel creates no partial device');
 writeFileSync('.tools/ux-acceptance.json',JSON.stringify({elapsed_ms:elapsed,modbus_device:created.id,mqtt_device:mqttDevice.device_id,registers:3,old_widget_count:before.widgets.length}));
 console.log('Onboarding acceptance passed: '+elapsed+'ms, read-only Modbus scan, auto mapping, one-screen reuse, reload persistence, MQTT discovery/runtime, no preview drafts, old boards preserved.');
});
