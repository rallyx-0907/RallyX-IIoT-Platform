import {useEffect,useRef,useState} from 'react';
import {errorMessage,request} from '../api/client';
import {NativeDialog} from './entities/NativeDialog';
import type {Site} from '../types/platform';
import './quickDeviceWizard.css';

type Signal={key:string;name:string;data_type:string;unit:string;address?:string;function_code?:number;store_history?:boolean;metadata?:Record<string,unknown>;mapping?:Record<string,unknown>};
type Connection={id:string;name:string;site_id:string;protocol:string;protocol_config:Record<string,unknown>};
type DeviceTemplate={id:string;name:string;protocol:string;manufacturer?:string;model?:string;tag_definitions:Signal[]};
type Reading={key:string;raw?:unknown;decoded?:unknown;scaled?:unknown;quality:string;error?:string;definition?:Signal};
type Diagnostic={connected:boolean;elapsed_ms:number;readings?:Reading[];fields?:{topic:string;path:string;name:string;unit:string;data_type:string;value:unknown;source_device_id?:string}[]};
export type CloneDevice={name:string;connection_id:string;template_id?:string;asset_id:string;protocol_device_address?:string;signals?:Signal[]};
const protocols:Record<string,string>={'modbus-tcp':'Modbus TCP','modbus-rtu':'Modbus RTU',mqtt:'MQTT',simulator:'Mô phỏng'};
// getRandomValues is available on offline HTTP installations as well as HTTPS.
function requestToken(){return Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');}

export function QuickDeviceWizard({onClose,onCreated,initialDevice}:{onClose:()=>void;onCreated:(id:string,summary?:{mapped:number;total:number})=>void;initialDevice?:CloneDevice}){
 const [step,setStep]=useState(initialDevice?2:0),[protocol,setProtocol]=useState('modbus-tcp'),[connectionID,setConnectionID]=useState(initialDevice?.connection_id||''),[connections,setConnections]=useState<Connection[]>([]),[templates,setTemplates]=useState<DeviceTemplate[]>([]),[tree,setTree]=useState<Site[]>([]);
 const [config,setConfig]=useState<Record<string,unknown>>({host:'',port:502}),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[poll,setPoll]=useState(1000),[timeout,setTimeoutMS]=useState(2000),[address,setAddress]=useState(initialDevice?.protocol_device_address||'1');
 const [templateID,setTemplateID]=useState(initialDevice?.template_id||''),[signals,setSignals]=useState<Signal[]>(initialDevice?.signals||[]),[selected,setSelected]=useState<Record<string,boolean>>({}),[diagnostic,setDiagnostic]=useState<Diagnostic>(),[busy,setBusy]=useState(false),[finishing,setFinishing]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[noTemplate,setNoTemplate]=useState(false);
 const [name,setName]=useState(initialDevice?initialDevice.name+' (mới)':''),[templateName,setTemplateName]=useState(''),[siteID,setSiteID]=useState(''),[areaID,setAreaID]=useState(''),[assetID,setAssetID]=useState(initialDevice?.asset_id||''),[siteName,setSiteName]=useState(''),[areaName,setAreaName]=useState(''),[assetName,setAssetName]=useState('');
 const [scanFrom,setScanFrom]=useState(40001),[scanTo,setScanTo]=useState(40010),[listenSeconds,setListenSeconds]=useState(10);
 const [templateSearch,setTemplateSearch]=useState('');
 const requestID=useRef(requestToken()),controller=useRef<AbortController|undefined>(undefined),alive=useRef(true);
 useEffect(()=>{requestID.current=requestToken();},[name,templateName,siteID,areaID,assetID,siteName,areaName,assetName,connectionID,templateID,signals,selected,config,username,password,poll,timeout,address]);
 useEffect(()=>{
  alive.current=true;
  void Promise.all([request<Connection[]>('/connections'),request<DeviceTemplate[]>('/templates'),request<Site[]>('/assets/tree')]).then(([c,t,h])=>{
   if(!alive.current)return;setConnections(c);setTemplates(t);setTree(h);
   if(initialDevice){const conn=c.find(v=>v.id===initialDevice.connection_id);if(conn)setProtocol(conn.protocol);const source=t.find(v=>v.id===initialDevice.template_id);if(source&&!initialDevice.signals?.length)setSignals(source.tag_definitions);}
  }).catch(e=>setError(errorMessage(e)));
  return()=>{alive.current=false;controller.current?.abort();};
 },[]);
 const connection=connections.find(c=>c.id===connectionID),sourceProtocol=connection?.protocol||protocol;
 useEffect(()=>{
  const first=tree.find(s=>s.id===connection?.site_id)||tree[0];
  if(initialDevice){for(const s of tree)for(const a of s.areas)if(a.assets.some(m=>m.id===initialDevice.asset_id)){setSiteID(s.id);setAreaID(a.id);setAssetID(initialDevice.asset_id);return;}}
  setSiteID(first?.id||'new');setAreaID(first?.areas[0]?.id||'new');setAssetID(first?.areas[0]?.assets[0]?.id||'new');
 },[connection?.site_id,tree]);
 const site=tree.find(s=>s.id===siteID),area=site?.areas.find(a=>a.id===areaID);
 function changeProtocol(value:string){changed();setProtocol(value);setConnectionID('');setTemplateID('');setSignals([]);setDiagnostic(undefined);setNoTemplate(false);setConfig(value==='mqtt'?{broker_url:'mqtt://',topic:'#'}:value==='modbus-rtu'?{serial_port:'/dev/ttyUSB0'}:value==='simulator'?{}:{host:'',port:502});}
 function connectionBody(){return {protocol:sourceProtocol,protocol_config:config,polling_interval_ms:poll,timeout_ms:timeout,...(username||password?{credentials:{username,password}}:{})};}
 function body(){return {connection_id:connectionID,connection:connectionID?undefined:connectionBody(),template_id:templateID,signals:templateID?undefined:signals.filter(s=>selected[s.key]!==false),device_address:address};}
 function changed(){controller.current?.abort();setBusy(false);requestID.current=requestToken();setError('');setDiagnostic(undefined);}
 async function diagnose(operation:string,selectedTemplate=templateID){
  controller.current?.abort();const current=new AbortController();controller.current=current;setBusy(true);setError('');setNotice('');
  try{
   const result=await request<Diagnostic>('/onboarding/preview',{method:'POST',signal:current.signal,body:JSON.stringify({...body(),template_id:selectedTemplate,operation,scan_start:scanFrom-40001,scan_count:scanTo-scanFrom+1,listen_seconds:listenSeconds})});
   if(!alive.current||current.signal.aborted||controller.current!==current)return;setDiagnostic(result);
   if(operation==='scan'){const next=(result.readings||[]).filter(r=>r.definition).map(r=>r.definition!);setSignals(next);setSelected(Object.fromEntries((result.readings||[]).map(r=>[r.key,r.quality==='GOOD'])));}
   if(operation==='listen'){const next=(result.fields||[]).map((f,i)=>({key:'signal_'+(i+1),name:f.name,unit:f.unit,data_type:f.data_type,store_history:true,mapping:{path:f.path,topic:f.topic,...(f.source_device_id?{device_id:f.source_device_id}:{})}}));setSignals(next);setSelected(Object.fromEntries(next.map(s=>[s.key,true])));}
   if(operation==='connection')setNotice(result.connected?'Đã kết nối, phản hồi '+result.elapsed_ms+' ms':'Thiết bị chưa phản hồi');
  }catch(e){if(alive.current&&!current.signal.aborted)setError(errorMessage(e));}finally{if(alive.current&&controller.current===current){setBusy(false);setFinishing(false);}}
 }
 async function finish(){
  setFinishing(true);setBusy(true);setError('');
  try{
   const result=await request<{entity_id:string;mapped:number;total:number}>('/onboarding/complete',{method:'POST',body:JSON.stringify({...body(),request_id:requestID.current,device_name:name,template_name:templateName,location:{site_id:siteID==='new'?'':siteID,area_id:areaID==='new'?'':areaID,asset_id:assetID==='new'?'':assetID,site_name:siteName,area_name:areaName,asset_name:assetName}})});
   if(alive.current){onCreated(result.entity_id,{mapped:result.mapped,total:result.total});onClose();}
  }catch(e){if(alive.current)setError(errorMessage(e));}finally{if(alive.current){setBusy(false);setFinishing(false);}}
 }
 const chosen=signals.filter(s=>selected[s.key]!==false);
 const validConnection=!!connectionID||sourceProtocol==='simulator'||(sourceProtocol==='mqtt'?!!config.broker_url&&!!config.topic:sourceProtocol==='modbus-rtu'?!!config.serial_port:!!config.host);
 const validLocation=(siteID!=='new'||!!siteName.trim())&&(areaID!=='new'||!!areaName.trim())&&(assetID!=='new'||!!assetName.trim());
 const editSignal=(index:number,patch:Partial<Signal>)=>{if(patch.data_type){changed();}setSignals(old=>old.map((s,i)=>i===index?{...s,...patch}:s));requestID.current=requestToken();};
 return <NativeDialog title={initialDevice?'Thêm thiết bị cùng loại':'Thêm thiết bị nhanh'} onClose={onClose} busy={busy} footer={<>
  <span>Chưa lưu cấu hình cho đến khi bấm Hoàn tất.</span>
  {busy?finishing?<span role="status">Đang lưu cấu hình…</span>:<button onClick={()=>{controller.current?.abort();setBusy(false);}}>Dừng kiểm tra</button>:<>
   {step>0&&<button onClick={()=>setStep(n=>n-1)}>Quay lại</button>}<button onClick={onClose}>Hủy</button>
   {step<2?<button className="primary" disabled={step===0?!validConnection:!templateID&&!chosen.length} onClick={()=>{setStep(n=>n+1);setError('');}}>Tiếp tục</button>:<button className="primary" disabled={!name.trim()||!validLocation||(!templateID&&!chosen.length)} onClick={()=>void finish()}>Hoàn tất</button>}
  </>}
 </>}>
  <fieldset disabled={finishing}><ol className="onboarding-steps">{['Kết nối','Chọn tín hiệu','Đặt vị trí và tên'].map((label,i)=><li key={label} aria-current={step===i?'step':undefined}><b>{i+1}</b>{label}</li>)}</ol>
  {error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status" className="onboarding-success">{notice}</p>}
  {step===0&&<>
   <h3>Thiết bị gửi dữ liệu bằng cách nào?</h3><div className="native-form-grid">
   <label>Giao thức<select value={sourceProtocol} onChange={e=>changeProtocol(e.target.value)}>{Object.entries(protocols).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   <label>Kết nối<select value={connectionID} onChange={e=>{setConnectionID(e.target.value);setTemplateID('');setSignals([]);changed();}}><option value="">+ Tạo kết nối mới</option>{connections.filter(c=>c.protocol===protocol).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   {!connectionID&&sourceProtocol==='modbus-tcp'&&<><label>Địa chỉ IP / tên máy<input value={String(config.host||'')} placeholder="192.168.1.10" onChange={e=>{setConfig(c=>({...c,host:e.target.value}));changed();}}/></label><label>Cổng<input type="number" value={Number(config.port)||502} onChange={e=>{setConfig(c=>({...c,port:Number(e.target.value)}));changed();}}/></label></>}
   {!connectionID&&sourceProtocol==='modbus-rtu'&&<label>Cổng nối tiếp<input value={String(config.serial_port||'')} onChange={e=>{setConfig(c=>({...c,serial_port:e.target.value}));changed();}}/></label>}
   {!connectionID&&sourceProtocol==='mqtt'&&<><label>Địa chỉ máy chủ MQTT<input value={String(config.broker_url||'')} placeholder="mqtt://192.168.1.10:1883" onChange={e=>{setConfig(c=>({...c,broker_url:e.target.value}));changed();}}/></label><label>Nhánh dữ liệu (topic)<input value={String(config.topic||'')} onChange={e=>{setConfig(c=>({...c,topic:e.target.value}));changed();}}/></label><label>Tài khoản (nếu có)<input autoComplete="off" value={username} onChange={e=>setUsername(e.target.value)}/></label><label>Mật khẩu<input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label></>}
   {sourceProtocol.startsWith('modbus-')&&<label>Mã thiết bị (Slave ID)<input type="number" min={sourceProtocol==='modbus-rtu'?1:0} max={255} value={address} onChange={e=>{setAddress(e.target.value);changed();}}/></label>}
   </div>
   {!connectionID&&<details><summary>Nâng cao</summary><div className="native-form-grid">
    <label>Chu kỳ đọc (ms)<input type="number" min={100} value={poll} onChange={e=>setPoll(Number(e.target.value))}/></label><label>Thời gian chờ (ms)<input type="number" min={100} max={60000} value={timeout} onChange={e=>setTimeoutMS(Number(e.target.value))}/></label>
    {sourceProtocol==='modbus-rtu'&&<><label>Tốc độ truyền<select value={Number(config.baudrate)||9600} onChange={e=>setConfig(c=>({...c,baudrate:Number(e.target.value)}))}>{[9600,19200,38400,57600,115200].map(n=><option key={n} value={n}>{n}</option>)}</select></label><label>Parity<select value={String(config.parity||'none')} onChange={e=>setConfig(c=>({...c,parity:e.target.value}))}><option value="none">None</option><option value="even">Even</option><option value="odd">Odd</option></select></label></>}
   </div></details>}
   <button disabled={busy||!validConnection} onClick={()=>void diagnose('connection')}>Kiểm tra kết nối</button>
  </>}
  {step===1&&<>
   <h3>Chọn mẫu phù hợp với thiết bị</h3>
   <label>Tìm mẫu theo tên / hãng / model<input value={templateSearch} onChange={e=>setTemplateSearch(e.target.value)}/></label>
    <button className={noTemplate?'active':''} onClick={()=>{changed();setTemplateID('');setSignals([]);setSelected({});setNoTemplate(true);}}><strong>Không có mẫu phù hợp</strong><small>Dò tín hiệu hoặc tự thêm cho mô phỏng</small></button>
   <div className="onboarding-template-list">{templates.filter(t=>t.protocol===sourceProtocol&&[t.name,t.manufacturer,t.model].join(' ').toLocaleLowerCase().includes(templateSearch.toLocaleLowerCase())).map(t=><button className={templateID===t.id?'active':''} key={t.id} onClick={()=>{changed();setTemplateID(t.id);setSignals(t.tag_definitions);setSelected({});setNoTemplate(false);void diagnose('read',t.id);}}><svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="3" width="20" height="22" rx="3"/><path d="M8 8h12v6H8zM8 19h3m6 0h3"/></svg><strong>{t.name}</strong><small>{[t.manufacturer,t.model].filter(Boolean).join(' · ')||protocols[t.protocol]} · {t.tag_definitions.length} tín hiệu</small></button>)}
   </div>
   {noTemplate&&<div className="onboarding-discovery">
    {sourceProtocol.startsWith('modbus-')?<><p>Quét thanh ghi giữ (Holding Register). Chỉ đọc, không ghi xuống thiết bị.</p><div className="native-form-grid"><label>Từ thanh ghi<input type="number" min={40001} value={scanFrom} onChange={e=>setScanFrom(Number(e.target.value))}/></label><label>Đến thanh ghi<input type="number" max={scanFrom+49} value={scanTo} onChange={e=>setScanTo(Number(e.target.value))}/></label></div><button disabled={busy||scanTo<scanFrom||scanTo-scanFrom>=50} onClick={()=>void diagnose('scan','')}>Quét dải thanh ghi</button></>:sourceProtocol==='mqtt'?<><label>Thời gian nghe<select value={listenSeconds} onChange={e=>setListenSeconds(Number(e.target.value))}>{[10,20,30].map(n=><option key={n} value={n}>{n} giây</option>)}</select></label><button disabled={busy} onClick={()=>void diagnose('listen','')}>Nghe thử {listenSeconds} giây</button><p>Chọn trường nhận được; có thể sửa kiểu và đơn vị trước khi lưu.</p></>:<button onClick={()=>setSignals(old=>[...old,{key:'signal_'+(old.length+1),name:'Giá trị '+(old.length+1),data_type:'float64',unit:'',store_history:true,metadata:{simulator_value:0}}])}>+ Thêm tín hiệu mô phỏng</button>}
   </div>}
   {busy&&<p role="status">Đang đọc dữ liệu từ thiết bị…</p>}
   {signals.length>0&&<>
    <div className="onboarding-signals"><table><thead><tr><th>Chọn</th><th>Đại lượng</th><th>Kiểu</th><th>Đơn vị</th><th>Giá trị</th><th>Chất lượng</th></tr></thead><tbody>{signals.map((s,i)=>{
     const row=diagnostic?.readings?.find(r=>r.key===s.key),field=diagnostic?.fields?.[i],value=row?.scaled??row?.decoded??field?.value;
     return <tr key={s.key}><td><input aria-label={'Chọn '+s.name} type="checkbox" disabled={!!templateID} checked={selected[s.key]!==false} onChange={e=>{setSelected(old=>({...old,[s.key]:e.target.checked}));requestID.current=requestToken();}}/></td>
      <td>{templateID?s.name:<input aria-label={'Tên tín hiệu '+(i+1)} value={s.name} onChange={e=>editSignal(i,{name:e.target.value})}/>}<small>{field?.topic}{field&&' · '+field.path}{s.address&&<span title={'Địa chỉ: '+s.address}> · HR {Number(s.address)+40001}</span>}</small></td>
      <td>{templateID?s.data_type:<select aria-label={'Kiểu tín hiệu '+(i+1)} value={s.data_type} onChange={e=>editSignal(i,{data_type:e.target.value})}>{['uint16','int16','float32','float64','bool','string'].map(kind=><option key={kind} value={kind}>{kind}</option>)}</select>}</td>
      <td>{templateID?s.unit:<input aria-label={'Đơn vị tín hiệu '+(i+1)} value={s.unit} onChange={e=>editSignal(i,{unit:e.target.value})}/>}</td>
      <td>{sourceProtocol==='simulator'&&!templateID?<input aria-label={'Giá trị mô phỏng '+(i+1)} type={s.data_type==='string'?'text':s.data_type==='bool'?'checkbox':'number'} checked={s.metadata?.simulator_value===true} value={String(s.metadata?.simulator_value??0)} onChange={e=>editSignal(i,{metadata:{simulator_value:s.data_type==='bool'?e.target.checked:s.data_type==='string'?e.target.value:Number(e.target.value)}})}/>:<><span>{value===undefined?'—':String(value)}</span>{row?.raw!==undefined&&<small>Gốc: {JSON.stringify(row.raw)} · Giải mã: {String(row.decoded??'—')}</small>}</>}</td>
      <td>{row?.quality==='GOOD'?'Tốt':row?.quality==='BAD'?row.error:field?'Giá trị mẫu':sourceProtocol==='simulator'?'Giá trị cấu hình':'Chưa đọc thử'}</td></tr>;
    })}</tbody></table></div>
    {noTemplate&&<><label>Lưu thành mẫu thiết bị<input value={templateName} onChange={e=>setTemplateName(e.target.value)} placeholder="Đặt tên để dùng lại cho thiết bị tiếp theo"/></label><button disabled={busy||!chosen.length} onClick={()=>void diagnose('read','')}>Đọc thử các tín hiệu đã chọn</button></>}
   </>}
  </>}
  {step===2&&<>
   <h3>Thiết bị nằm ở đâu?</h3><div className="native-form-grid">
    <label>Nhà máy<select disabled={!!connection} value={siteID} onChange={e=>{setSiteID(e.target.value);setAreaID('new');setAssetID('new');}}>{tree.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}<option value="new">+ Tạo nhà máy mới</option></select></label>{siteID==='new'&&<label>Tên nhà máy<input value={siteName} onChange={e=>setSiteName(e.target.value)}/></label>}
    <label>Khu vực<select value={areaID} onChange={e=>{setAreaID(e.target.value);setAssetID('new');}}>{site?.areas.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}<option value="new">+ Tạo khu vực mới</option></select></label>{areaID==='new'&&<label>Tên khu vực<input value={areaName} onChange={e=>setAreaName(e.target.value)}/></label>}
    <label>Máy<select value={assetID} onChange={e=>setAssetID(e.target.value)}>{area?.assets.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}<option value="new">+ Tạo máy mới</option></select></label>{assetID==='new'&&<label>Tên máy<input value={assetName} onChange={e=>setAssetName(e.target.value)}/></label>}
    <label>Tên thiết bị<input value={name} onChange={e=>setName(e.target.value)} placeholder="Ví dụ: Đồng hồ điện tủ tổng"/></label>
    {initialDevice&&sourceProtocol.startsWith('modbus-')&&<label>Mã thiết bị (Slave ID)<input value={address} onChange={e=>setAddress(e.target.value)}/></label>}
   </div><p className="onboarding-success">{chosen.length} đại lượng sẽ được tự gán nguồn dữ liệu và có dashboard ngay sau khi hoàn tất.</p><p>Kết nối: {connection?.name||protocols[sourceProtocol]} · Mẫu: {templates.find(t=>t.id===templateID)?.name||templateName||'Tạo từ tín hiệu đã chọn'}</p>
  </>}
 </fieldset></NativeDialog>;
}
