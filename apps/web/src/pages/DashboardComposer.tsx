import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {request,errorMessage} from '../api/client';
import type {Site,Sample,Tag} from '../types/platform';
import type {Point} from './pointDashboard';
import {scopePoints,workspaceDashboard,previewFresh,previewPath,stateLabel,type Scope,type ChartChoice} from './dashboardWorkspace';
type Props={points:Point[];devices:{id:string;name:string}[];onClose:()=>void;onApply:(doc:ReturnType<typeof workspaceDashboard>)=>Promise<void>};
const kinds:Record<string,string>={stat:'Chỉ số / trạng thái',timeseries:'Biểu đồ xu hướng',gauge:'Đồng hồ',bargauge:'Thanh mức',table:'Bảng giá trị'};
export function DashboardComposer({points,devices,onClose,onApply}:Props){
 const [tree,setTree]=useState<Site[]>([]),[scope,setScope]=useState<Scope>({}),[choices,setChoices]=useState<ChartChoice[]>([]),[name,setName]=useState(''),[search,setSearch]=useState(''),[preview,setPreview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [treeLoading,setTreeLoading]=useState(true);const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(dialog.current?.showModal){dialog.current.removeAttribute('open');dialog.current.showModal();}let active=true;void request<Site[]>('/assets/tree').then(v=>{if(active)setTree(v);}).catch(e=>{if(active)setError(errorMessage(e));}).finally(()=>{if(active)setTreeLoading(false);});return()=>{active=false;};},[]);
 const sites=tree.filter(s=>!scope.site||s.id===scope.site),areas=sites.flatMap(s=>s.areas).filter(a=>!scope.area||a.id===scope.area),assets=areas.flatMap(a=>a.assets).filter(a=>!scope.asset||a.id===scope.asset);
 const allowed=new Set(scopePoints(tree,scope));
 const available=points.filter(p=>(tree.length?allowed.has(p.id):!scope.device||p.device_id===scope.device)&&`${p.name} ${p.key||''} ${devices.find(d=>d.id===p.device_id)?.name||''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
 const scopeName=[tree.find(s=>s.id===scope.site)?.name,areas.find(a=>a.id===scope.area)?.name,assets.find(a=>a.id===scope.asset)?.name,devices.find(d=>d.id===scope.device)?.name].filter(Boolean).join(' / ')||'Toàn bộ hệ thống';
 const change=()=>{setPreview(false);setError('');};
 function toggle(point:Point){change();setChoices(old=>old.some(c=>c.point.id===point.id)?old.filter(c=>c.point.id!==point.id):old.length>=24?old:[...old,{point:{...point,device_name:devices.find(d=>d.id===point.device_id)?.name},kind:['bool','boolean','string'].includes(point.data_type)||point.store_history===false?'stat':'timeseries',min:0,max:100}]);}
 const selectedScope=choices.some(c=>!allowed.has(c.point.id))&&tree.length?'Nhiều máy / thiết bị':scopeName;
 function validate(){try{workspaceDashboard(name,selectedScope,choices);setError('');setPreview(true);}catch(e){setError(errorMessage(e));}}
 async function apply(){setBusy(true);setError('');try{await onApply(workspaceDashboard(name,selectedScope,choices));}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 return <dialog ref={dialog} open className="dashboard-dialog" aria-labelledby="composer-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
  <div className="composer-heading"><div><small>THIẾT KẾ DASHBOARD</small><h2 id="composer-title">{preview?'Xem trước dashboard':'Chọn phạm vi và biểu đồ'}</h2></div><button disabled={busy} aria-label="Đóng cấu hình" onClick={onClose}>Đóng</button></div>
  <div className="composer-body">
   {!preview?<><div className="composer-settings"><label>Tên dashboard<input value={name} maxLength={160} placeholder="Ví dụ: Giám sát dây chuyền đóng gói" onChange={e=>{setName(e.target.value);change();}}/></label>
    <div className="scope-grid"><label>Nhà máy<select value={scope.site||''} onChange={e=>{setScope({site:e.target.value});change();}}><option value="">Tất cả nhà máy</option>{tree.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label>Khu vực<select value={scope.area||''} onChange={e=>{setScope({...scope,area:e.target.value,asset:'',device:''});change();}}><option value="">Tất cả khu vực</option>{sites.flatMap(s=>s.areas).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <label>Máy / tài sản<select value={scope.asset||''} onChange={e=>{setScope({...scope,asset:e.target.value,device:''});change();}}><option value="">Tất cả máy</option>{areas.flatMap(a=>a.assets).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <label>Thiết bị<select value={scope.device||''} onChange={e=>{setScope({...scope,device:e.target.value});change();}}><option value="">Tất cả thiết bị</option>{(tree.length?assets.flatMap(a=>a.devices):devices).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label></div>
    <p className="muted">{scopeName} · {available.length} point. Có thể chọn point ở nhiều máy; đổi bộ lọc vẫn giữ các point đã chọn.</p>
    <label>Tìm tín hiệu<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Tên tín hiệu, mã hoặc thiết bị"/></label>
    {treeLoading&&<p role="status">Đang tải cấu trúc nhà máy…</p>}
    <div className="point-picker">{available.slice(0,200).map(p=><label key={p.id} className="point-option"><input type="checkbox" value={p.id} checked={choices.some(c=>c.point.id===p.id)} disabled={!choices.some(c=>c.point.id===p.id)&&choices.length>=24} onChange={()=>toggle(p)}/><span><strong>{p.name}</strong><small>{devices.find(d=>d.id===p.device_id)?.name} · {p.key} · {p.unit||p.data_type}</small></span></label>)}</div>{available.length>200&&<p>Đang hiển thị 200 kết quả. Lọc theo máy hoặc tìm tên để thu hẹp.</p>}</div>
    <div className="chosen-charts"><h3>Biểu đồ đã chọn · {choices.length}/24</h3>{!choices.length&&<p>Chọn các tín hiệu bên trái. Mỗi tín hiệu có thể dùng kiểu biểu đồ riêng.</p>}{choices.map((c,i)=><div className="chart-setting" key={c.point.id}><strong>{c.point.name}</strong><small>{devices.find(d=>d.id===c.point.device_id)?.name}</small><label>Kiểu hiển thị<select value={c.kind} onChange={e=>{setChoices(old=>old.map((v,j)=>j===i?{...v,kind:e.target.value}:v));change();}}>{Object.entries(kinds).filter(([k])=>!['bool','boolean','string'].includes(c.point.data_type)||['stat','table'].includes(k)).map(([k,label])=><option key={k} value={k} disabled={k==='timeseries'&&c.point.store_history===false}>{label}</option>)}</select></label>{['gauge','bargauge'].includes(c.kind)&&<div className="range-inputs">{(['min','max'] as const).map(k=><label key={k}>{k==='min'?'Thấp nhất':'Cao nhất'}<input type="number" step="any" value={c[k]} onChange={e=>{setChoices(old=>old.map((v,j)=>j===i?{...v,[k]:Number(e.target.value)}:v));change();}}/></label>)}</div>}<button onClick={()=>toggle(c.point)} aria-label={`Bỏ ${c.point.name}`}>Bỏ biểu đồ</button></div>)}</div></>:<div className="composer-preview"><h3>{name}</h3><p>{selectedScope} · Dữ liệu thật từ hệ thống · Lịch sử 1 giờ gần nhất</p><LivePreview><div className="visual-summaries">{choices.slice(0,4).map(c=><LiveChart key={c.point.id} choice={{...c,kind:"stat"}}/>)}</div><div className="visual-grid">{choices.map(c=><LiveChart key={c.point.id} choice={c}/>)}</div></LivePreview></div>}
  </div>
  {error&&<p className="error" role="alert">{error}</p>}
  <div className="composer-footer"><span>{preview?'Chưa lưu. Áp dụng để tạo tab dashboard.':`${choices.length} tín hiệu được chọn · Chưa thay đổi dữ liệu đã lưu`}</span><button disabled={busy} onClick={preview?()=>setPreview(false):onClose}>{preview?'Quay lại cấu hình':'Hủy'}</button>{preview?<button className="primary" disabled={busy} onClick={()=>void apply()}>{busy?'Đang lưu…':'Áp dụng'}</button>:<button className="primary" disabled={!choices.length||!name.trim()} onClick={validate}>Xem trước</button>}</div>
 </dialog>;
}
const LiveContext=createContext<{tags:Tag[];error:string}>({tags:[],error:''});
export function LivePreview({children}:{children:ReactNode}){
 const [data,setData]=useState<{tags:Tag[];error:string}>({tags:[],error:''});
 useEffect(()=>{let active=true,inFlight=false;const controller=new AbortController();async function load(){if(inFlight)return;inFlight=true;try{
  const [tags,tree]=await Promise.all([request<Tag[]>('/tags',{signal:controller.signal}),request<Site[]>('/assets/tree',{signal:controller.signal})]);
  const enabled=new Map(tree.flatMap(s=>s.areas.flatMap(a=>a.assets.flatMap(m=>m.devices.flatMap(d=>d.tags.map(p=>[p.id,m.enabled&&d.enabled&&p.enabled!==false] as const))))));
  if(active)setData({tags:tags.map(tag=>({...tag,enabled:tag.enabled!==false&&enabled.get(tag.id)===true})),error:''});
 }catch(e){if(active)setData({tags:[],error:errorMessage(e)});}finally{inFlight=false;}}void load();const timer=setInterval(()=>void load(),5000);return()=>{active=false;controller.abort();clearInterval(timer);};},[]);
 return <LiveContext.Provider value={data}>{children}</LiveContext.Provider>;
}
export function LiveChart({choice}:{choice:ChartChoice}){
 const {point,kind,min,max}=choice;const {tags,error:liveError}=useContext(LiveContext);const tag=tags.find(t=>t.id===point.id);const [samples,setSamples]=useState<Sample[]>([]),[error,setError]=useState('');
 useEffect(()=>{let active=true;const controller=new AbortController();
 if(kind==='timeseries'){const to=new Date(),from=new Date(to.getTime()-3600000);void request<Sample[]>(`/tags/${encodeURIComponent(point.id)}/history?from=${from.toISOString()}&to=${to.toISOString()}&limit=1000`,{signal:controller.signal}).then(v=>{if(active)setSamples(v);}).catch(e=>{if(active)setError(errorMessage(e));});}
 return()=>{active=false;controller.abort();};},[point.id,kind]);
 const good=previewFresh(tag);
 const val=good?tag?.value:undefined,number=typeof val==='number'?val:undefined;
 const values=samples.filter(s=>s.quality==='GOOD'&&typeof s.value==='number');
 const line=previewPath(samples,Date.now()-3600000);
 const percent=number===undefined?0:Math.max(0,Math.min(100,(number-min)/(max-min)*100));
 return <article className={`visual-card visual-${kind}`}><div><strong>{point.name}</strong><span className={good?'quality-good':'quality-warn'}>{good?'TỐT':tag?.enabled===false?'ĐÃ TẮT':tag?.realtime_enabled===false?'TẮT REALTIME':tag?.quality==='GOOD'?'ĐÃ CŨ':tag?.quality||'CHƯA CÓ DỮ LIỆU'}</span></div><div className="visual-value">{val===undefined?'—':typeof val==='boolean'?stateLabel(point,val):String(val)} <small>{point.unit}</small></div>
 {kind==='timeseries'&&(values.length?<svg viewBox="0 0 400 140" role="img" aria-label={`Xu hướng ${point.name}`}><path d="M0 25H400 M0 75H400 M0 125H400" stroke="#ffffff15"/><path d={line} fill="none" stroke="currentColor" strokeWidth="3"/></svg>:<p>Chưa có mẫu lịch sử tốt trong 1 giờ gần nhất.</p>)}
 {kind==='gauge'&&<svg viewBox="0 0 220 125" role="img" aria-label={`Đồng hồ ${point.name}`}><path d="M20 110 A90 90 0 0 1 200 110" pathLength="100" fill="none" stroke="#ffffff15" strokeWidth="15"/>{good&&<path d="M20 110 A90 90 0 0 1 200 110" pathLength="100" fill="none" stroke="currentColor" strokeWidth="15" strokeDasharray={`${percent} 100`}/>}<text x="15" y="123" fill="#a7b9ce" fontSize="12">{min}</text><text x="180" y="123" fill="#a7b9ce" fontSize="12">{max}</text></svg>}
 {kind==='bargauge'&&<div className="visual-bar"><i style={{width:`${percent}%`}}/><small>{min} — {max} {point.unit}</small></div>}
 {kind==='table'&&<table><tbody><tr><th>Tín hiệu</th><td>{point.key}</td></tr><tr><th>Thời điểm</th><td>{tag?.ts?new Date(tag.ts).toLocaleString('vi-VN'):'—'}</td></tr></tbody></table>}
 {!good&&<small>Dữ liệu chưa sẵn sàng hoặc đã cũ; không dùng làm giá trị hiện tại.</small>}{(error||liveError)&&<small role="alert">{error||liveError}</small>}
 </article>;
}
