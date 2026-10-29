import {useCallback,useEffect,useState} from 'react';
import {errorMessage,request} from '../api/client';
import type {User} from '../types/platform';
import {EntityNavigation} from './entities/EntityNavigation';
import {BindingEditor,EntitySetup,ProfileEditor} from './entities/EntitySetup';
import {TemplateLibrary,TemplateBuilder} from './entities/TemplateBuilder';
import {NativeCanvas,State} from './entities/NativeWidgets';
import {lastEntity,rememberEntity,type Runtime,type Entity,type Template} from './entities/model';
import './entityDashboards.css';

export function EntityDashboards({user,offline}:{user:User;offline:boolean}){
 const [selected,setSelected]=useState(()=>lastEntity(user.id)),[runtime,setRuntime]=useState<Runtime>(),[page,setPage]=useState(''),[hours,setHours]=useState(1),[offset,setOffset]=useState(0),[revision,setRevision]=useState(0),[error,setError]=useState(''),[loading,setLoading]=useState(false),[modal,setModal]=useState<''|'new'|'edit'|'bindings'|'library'|'profile'|'builder'>(''),[template,setTemplate]=useState<Template>();
 const admin=user.role==='admin';const choose=useCallback((id:string)=>{setSelected(id);setPage('');setOffset(0);setRuntime(undefined);rememberEntity(user.id,id);setError('');},[user.id]);
 useEffect(()=>{if(selected)rememberEntity(user.id,selected);},[selected,user.id]);
 useEffect(()=>{if(selected)return;let alive=true;void request<Entity[]>('/entities?parent=&limit=100&offset=0').then(rows=>{if(alive&&rows.length)choose(rows[0].id);}).catch(e=>{if(alive)setError(errorMessage(e));});return()=>{alive=false;};},[selected,choose,revision]);
 useEffect(()=>{if(!selected)return;let alive=true,inFlight=false;const controller=new AbortController();async function load(){if(inFlight)return;inFlight=true;setLoading(true);try{const to=new Date(),from=new Date(to.getTime()-hours*3600000);const value=await request<Runtime>(`/entities/${encodeURIComponent(selected)}/dashboard-runtime`,{method:'POST',body:JSON.stringify({page_id:page,from:from.toISOString(),to:to.toISOString(),offset}),signal:controller.signal});if(alive){setRuntime(value);setError('');}}catch(e){if(alive)setError(errorMessage(e));}finally{inFlight=false;if(alive)setLoading(false);}}void load();const timer=setInterval(()=>{if(document.visibilityState==='visible'&&!modal)void load();},5000);return()=>{alive=false;controller.abort();clearInterval(timer);};},[selected,page,hours,offset,revision,modal]);
 function refresh(id?:string){setRevision(n=>n+1);if(id&&id!==selected)choose(id);}
 async function editTemplate(){if(!runtime?.assignment.template_id||runtime.assignment.template_id==='rallyx-entity-overview'){setTemplate(undefined);setModal('builder');return;}try{const value=await request<Template>(`/entity-dashboard-templates/${encodeURIComponent(runtime.assignment.template_id)}`);setTemplate(value);setModal('builder');}catch(e){setError(errorMessage(e));}}
 const current=runtime?.entity,pageID=page||runtime?.document.pages[0]?.id||'';
 return <div className="native-dashboard">
  <div className="native-workspace-bar"><div><small>ENTITY · PROFILE · TEMPLATE</small><h2>Giám sát theo thực thể</h2></div><div>{admin&&<><button onClick={()=>setModal('new')}>+ Thêm thực thể</button><button onClick={()=>setModal('profile')}>Tạo profile</button><button className="primary" onClick={()=>setModal('library')}>Thư viện dashboard</button></>}<a href="#legacy-dashboards">Dashboard cũ / Grafana ↗</a></div></div>
  <div className="native-workspace"><EntityNavigation selected={selected} onSelect={choose} revision={revision}/><div className="native-runtime">
   {error&&<p role="alert" className="error">{error} <button onClick={()=>refresh()}>Thử lại</button></p>}
   {offline&&<p className="warning">Mất kết nối realtime. Các trạng thái là bản ghi cuối; giá trị hiện tại bị ẩn đến khi kết nối phục hồi.</p>}
   {!selected&&!loading&&<div className="native-welcome"><h2>Mô hình nhà máy theo cách của bạn</h2><p>Thêm thực thể, gán profile, map tín hiệu rồi chọn template. Máy cùng loại dùng chung dashboard và tự đổi dữ liệu theo ngữ cảnh.</p></div>}
   {loading&&!runtime&&<p role="status">Đang tải dashboard theo ngữ cảnh…</p>}
   {runtime&&<><nav className="native-breadcrumb" aria-label="Đường dẫn thực thể">{runtime.breadcrumb.map((e,i)=><span key={e.id}>{i>0&&<i>/</i>}<button onClick={()=>choose(e.id)}>{e.name}</button></span>)}</nav><div className="native-context-heading"><div><small>{current?.type_name||current?.type_key}{current?.code&&` · ${current.code}`}</small><h2>{current?.name}</h2><State value={offline?'UNKNOWN':runtime.overview.state}/></div><div><label>Khoảng thời gian<select value={hours} onChange={e=>setHours(Number(e.target.value))}><option value={0.25}>15 phút</option><option value={1}>1 giờ</option><option value={6}>6 giờ</option><option value={24}>24 giờ</option><option value={168}>7 ngày</option><option value={720}>30 ngày</option></select></label>{admin&&<><button onClick={()=>setModal('edit')}>Cấu hình entity</button><button disabled={!current?.profile_id} onClick={()=>setModal('bindings')}>Map tín hiệu</button><button onClick={()=>void editTemplate()}>Thiết kế / kéo thả</button></>}</div></div>
    {admin&&!current?.profile_id&&<div className="native-setup-notice"><span>Chưa có profile ngữ nghĩa. Gán profile để dùng chỉ số và template theo loại máy; cây con và cảnh báo hiện tại vẫn xem được.</span><button onClick={()=>setModal('edit')}>Gán profile</button></div>}
    <div className="native-page-tabs">{runtime.document.pages.map(p=><button key={p.id} className={pageID===p.id?'active':''} onClick={()=>setPage(p.id)}>{p.name}</button>)}<span>Template v{runtime.assignment.template_version||'—'} · Cập nhật {new Date(runtime.generated_at).toLocaleTimeString('vi-VN')} · 5 giây</span><button disabled={loading} onClick={()=>refresh()}>Làm mới</button></div>
    <NativeCanvas runtime={runtime} pageID={pageID} offline={offline||!!error} onEntity={choose}/>
    {runtime.overview.child_total>50&&<div className="native-source-pager"><button disabled={offset===0} onClick={()=>setOffset(n=>Math.max(0,n-50))}>Trang trước</button><span>{offset+1}–{Math.min(offset+50,runtime.overview.child_total)} / {runtime.overview.child_total} thực thể con</span><button disabled={offset+50>=runtime.overview.child_total} onClick={()=>setOffset(n=>n+50)}>Trang sau</button></div>}
   </>}
  </div></div>
  {(modal==='new'||modal==='edit')&&<EntitySetup entity={modal==='edit'?current:undefined} parent={modal==='new'?current:runtime?.breadcrumb.at(-2)} onClose={()=>setModal('')} onSaved={refresh}/>}
  {modal==='bindings'&&current&&<BindingEditor entity={current} onClose={()=>setModal('')} onSaved={refresh}/>}
  {modal==='profile'&&<ProfileEditor onClose={()=>{setModal('');refresh();}}/>}
  {modal==='library'&&<TemplateLibrary entityID={selected} onClose={()=>setModal('')} onApplied={()=>refresh()}/>}
  {modal==='builder'&&<TemplateBuilder entityID={selected} template={template} onClose={()=>setModal('')} onApplied={()=>refresh()}/>}
 </div>;
}
