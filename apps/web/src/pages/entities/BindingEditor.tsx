import {useEffect,useState} from 'react';
import {errorMessage,request} from '../../api/client';
import {NativeDialog} from './NativeDialog';
import {sourceIssue,suggestSources} from './sourceCompatibility';
import type {Entity,Metric,Source,Binding} from './model';

export function BindingEditor({entity,onClose,onSaved}:{entity:Entity;onClose:()=>void;onSaved:(id?:string)=>void}){
 async function suggest(){
  setBusy(true);setError('');
  try{
   const all:Source[]=[];
   for(let page=0;page<50;page++){
    const batch=await request<Source[]>('/entity-sources?device_id='+encodeURIComponent(device)+'&search='+encodeURIComponent(search)+'&limit=200&offset='+(page*200));all.push(...batch);
    if(batch.length<200){const result=suggestSources(metrics,all,bindings);if(!Object.keys(result).length)setError('Chưa có gợi ý duy nhất phù hợp. Kiểm tra thiết bị, tên, đơn vị và lịch sử của tín hiệu.');setSuggested(result);setBindings(old=>({...old,...result}));setKnown(old=>[...old,...Object.entries(result).map(([metric_key,tag_id])=>{const s=all.find(s=>s.id===tag_id)!;return {metric_key,tag_id,tag_name:s.name,device_name:s.device_name} as Binding;})]);return}
   }
   setError('Có quá nhiều nguồn để gợi ý chính xác. Chọn một thiết bị hoặc thu hẹp tìm kiếm.');
  }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
 }
 const [metrics,setMetrics]=useState<Metric[]>([]),[bindings,setBindings]=useState<Record<string,string>>({}),[known,setKnown]=useState<Binding[]>([]),[sources,setSources]=useState<Source[]>([]),[search,setSearch]=useState(''),[offset,setOffset]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false),[suggested,setSuggested]=useState<Record<string,string>>({});
 const [devices,setDevices]=useState<{id:string;name:string}[]>([]),[device,setDevice]=useState(entity.legacy_kind==='devices'?entity.legacy_id||'':'');
 useEffect(()=>{let active=true;void Promise.all([request<Metric[]>(`/entities/${entity.id}/metrics`),request<Binding[]>(`/entities/${entity.id}/bindings`),request<typeof devices>('/devices')]).then(([m,b,d])=>{if(active){setMetrics(m);setKnown(b);setDevices(d);setBindings(Object.fromEntries(b.map(v=>[v.metric_key,v.tag_id])));}}).catch(e=>{if(active)setError(errorMessage(e));});return()=>{active=false;};},[entity.id]);
 useEffect(()=>{let active=true;const timer=setTimeout(()=>{void request<Source[]>(`/entity-sources?device_id=${encodeURIComponent(device)}&search=${encodeURIComponent(search)}&limit=100&offset=${offset}`).then(v=>{if(active)setSources(v);}).catch(e=>{if(active)setError(errorMessage(e));});},200);return()=>{active=false;clearTimeout(timer);};},[search,offset,device]);
 async function save(){setBusy(true);try{await request(`/entities/${entity.id}/bindings`,{method:'PUT',body:JSON.stringify({revision:entity.revision,bindings})});onSaved(entity.id);onClose();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 const link=(s:Source)=>`?device_id=${encodeURIComponent(s.device_id)}&signal=${encodeURIComponent(s.key)}#configuration`;
 return <NativeDialog title={`Gán nguồn dữ liệu · ${entity.name}`} onClose={onClose} busy={busy} footer={<><span>Kiểm tra gợi ý trước khi áp dụng. Nguồn gốc và lịch sử không bị thay đổi.</span><button className="primary" disabled={busy||!metrics.length} onClick={()=>void save()}>Áp dụng nguồn dữ liệu</button></>}>
 <div className="native-form-grid"><label>Thiết bị cung cấp dữ liệu<select value={device} onChange={e=>{setDevice(e.target.value);setOffset(0);}}><option value="">Tất cả thiết bị</option>{devices.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>Tìm nguồn theo tín hiệu / thiết bị<input value={search} onChange={e=>{setSearch(e.target.value);setOffset(0);}} placeholder="Tên thiết bị hoặc mã tín hiệu"/></label></div>
 <button disabled={busy||!sources.length} onClick={()=>void suggest()}>Tự gợi ý</button>{Object.keys(suggested).length>0&&<p role="status">Đã gợi ý {Object.keys(suggested).length}/{metrics.length} đại lượng. Kiểm tra trước khi áp dụng.</p>}
 <div className="native-source-pager"><button disabled={offset===0} onClick={()=>setOffset(n=>Math.max(0,n-100))}>Trang trước</button><span>Nguồn {sources.length?offset+1:0}–{offset+sources.length}</span><button disabled={sources.length<100} onClick={()=>setOffset(n=>n+100)}>Trang sau</button></div>
 {metrics.map(m=>{const compatible=sources.filter(s=>!sourceIssue(s,m));return <div className="native-binding-row" key={m.key}><div><strong>{m.name}</strong><small>{m.unit||'Không đơn vị'}{suggested[m.key]?' · Gợi ý — cần kiểm tra':''}</small></div><label>Nguồn dữ liệu cho {m.name}<select value={bindings[m.key]||''} onChange={e=>{setBindings(old=>({...old,[m.key]:e.target.value}));setSuggested(old=>{const next={...old};delete next[m.key];return next;});}}><option value="">Chưa gán nguồn</option>{bindings[m.key]&&!sources.some(s=>s.id===bindings[m.key])&&<option value={bindings[m.key]}>{known.find(b=>b.metric_key===m.key)?.device_name} · {known.find(b=>b.metric_key===m.key)?.tag_name}</option>}{sources.map(s=>{const reason=sourceIssue(s,m);return <option key={s.id} value={s.id} disabled={!!reason}>{s.device_name} · {s.name} [{s.unit||s.data_type}]{reason?' — '+reason:''}</option>;})}</select>{!compatible.length&&sources.length>0&&<span>Chưa có nguồn phù hợp trong trang này. {sources.slice(0,5).map(s=><a key={s.id} href={link(s)}>Sửa {s.name} ↗ </a>)}</span>}</label></div>;})}{error&&<p role="alert" className="error">{error}</p>}</NativeDialog>;
}
