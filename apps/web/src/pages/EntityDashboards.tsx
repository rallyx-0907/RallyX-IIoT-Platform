import {LegacyMigration} from './entities/LegacyMigration';
import {useCallback,useEffect,useState} from 'react';
import {errorMessage,request} from '../api/client';
import type {User} from '../types/platform';
import {EntityNavigation} from './entities/EntityNavigation';
import {BindingEditor,EntitySetup,ProfileEditor} from './entities/EntitySetup';
import {TemplateLibrary,TemplateBuilder} from './entities/TemplateBuilder';
import {NativeCanvas,State} from './entities/NativeWidgets';
import {lastEntity,rememberEntity,type Runtime,type Entity,type Template} from './entities/model';
import './entityDashboards.css';

export function EntityDashboards({user,offline,onAddDevice,onCloneDevice}:{user:User;offline:boolean;onAddDevice?:()=>void;onCloneDevice?:(id:string)=>void}){
 const [selected,setSelected]=useState(()=>lastEntity(user.id)),[runtime,setRuntime]=useState<Runtime>(),[page,setPage]=useState(''),[hours,setHours]=useState(1),[offset,setOffset]=useState(0),[revision,setRevision]=useState(0),[error,setError]=useState(''),[loading,setLoading]=useState(false),[modal,setModal]=useState<''|'new'|'edit'|'bindings'|'library'|'profile'|'builder'|'migration'>(''),[template,setTemplate]=useState<Template>();
 const [editOpen,setEditOpen]=useState(false),[treeOpen,setTreeOpen]=useState(false),[roots,setRoots]=useState<Entity[]>([]);
 const admin=user.role==='admin';const choose=useCallback((id:string)=>{setSelected(id);setPage('');setOffset(0);setRuntime(undefined);rememberEntity(user.id,id);setError('');},[user.id]);
 useEffect(()=>{if(selected)rememberEntity(user.id,selected);},[selected,user.id]);
 useEffect(()=>{let alive=true;void request<Entity[]>('/entities?parent=&limit=100&offset=0').then(rows=>{if(alive){setRoots(rows);if(!selected&&rows.length)choose(rows[0].id);}}).catch(e=>{if(alive)setError(errorMessage(e));});return()=>{alive=false;};},[selected,choose,revision]);
 useEffect(()=>{if(!selected)return;let alive=true,inFlight=false;const controller=new AbortController();async function load(){if(inFlight)return;inFlight=true;setLoading(true);try{const to=new Date(),from=new Date(to.getTime()-hours*3600000);const value=await request<Runtime>(`/entities/${encodeURIComponent(selected)}/dashboard-runtime`,{method:'POST',body:JSON.stringify({page_id:page,from:from.toISOString(),to:to.toISOString(),offset}),signal:controller.signal});if(alive){setRuntime(value);setError('');}}catch(e){if(alive)setError(errorMessage(e));}finally{inFlight=false;if(alive)setLoading(false);}}void load();const timer=setInterval(()=>{if(document.visibilityState==='visible'&&!modal)void load();},5000);return()=>{alive=false;controller.abort();clearInterval(timer);};},[selected,page,hours,offset,revision,modal]);
 function refresh(id?:string){setRevision(n=>n+1);if(id&&id!==selected)choose(id);}
 async function editTemplate(){if(!runtime?.assignment.template_id||runtime.assignment.template_id==='rallyx-entity-overview'){setTemplate(undefined);setModal('builder');return;}try{const value=await request<Template>(`/entity-dashboard-templates/${encodeURIComponent(runtime.assignment.template_id)}`);setTemplate(value);setModal('builder');}catch(e){setError(errorMessage(e));}}
 const current=runtime?.entity,pageID=page||runtime?.document.pages[0]?.id||'';
 return <div className="native-dashboard">
  <div className="native-workspace-bar"><h2>Giám sát vận hành</h2><div>{admin&&<><button className="primary" onClick={onAddDevice}>+ Thêm thiết bị</button><div className="native-edit-control"><button aria-expanded={editOpen} onClick={()=>setEditOpen(v=>!v)}>Chỉnh sửa</button>{editOpen&&<nav className="native-edit-menu" aria-label="Chỉnh sửa dashboard" onClick={()=>setEditOpen(false)}><button onClick={()=>setModal('new')}>Thêm khu vực / máy</button><button disabled={!current} onClick={()=>setModal('edit')}>Cài đặt máy</button><button disabled={!current?.profile_id} onClick={()=>setModal('bindings')}>Gán nguồn dữ liệu</button><button onClick={()=>setModal('profile')}>Bộ đại lượng nâng cao</button><button onClick={()=>setModal('library')}>Thư viện mẫu dashboard</button><button onClick={()=>void editTemplate()}>Thiết kế / kéo thả</button><button onClick={()=>setModal('migration')}>Chuyển bảng theo dõi cũ</button>{current?.legacy_kind==='devices'&&onCloneDevice&&<button onClick={()=>onCloneDevice(current.legacy_id!)}>Thêm thiết bị cùng loại</button>}</nav>}</div></>}</div></div>
  <div className={'native-workspace'+(treeOpen?'':' tree-collapsed')}>{treeOpen&&<EntityNavigation selected={selected} onSelect={choose} revision={revision}/>}<div className="native-runtime"><div className="native-location-bar"><button aria-expanded={treeOpen} onClick={()=>setTreeOpen(v=>!v)}>{treeOpen?'Ẩn cây vị trí':'Cây vị trí'}</button><label>Nhà máy / vị trí<select value={runtime?.breadcrumb[0]?.id||''} onChange={e=>choose(e.target.value)}><option value="">Chọn vị trí</option>{roots.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label></div>
   {error&&<p role="alert" className="error">{error} <button onClick={()=>refresh()}>Thử lại</button></p>}
   {offline&&<p className="warning">Mất kết nối realtime. Các trạng thái là bản ghi cuối; giá trị hiện tại bị ẩn đến khi kết nối phục hồi.</p>}
   {!selected&&!loading&&<div className="native-welcome"><h2>Bắt đầu giám sát thiết bị</h2><ol><li>Chọn kết nối</li><li>Chọn mẫu hoặc dò tín hiệu</li><li>Đặt vị trí và tên thiết bị</li></ol>{admin&&onAddDevice&&<button className="primary" onClick={onAddDevice}>Bắt đầu thêm thiết bị</button>}</div>}
   {loading&&!runtime&&<p role="status">Đang tải dashboard theo ngữ cảnh…</p>}
   {runtime&&<><nav className="native-breadcrumb" aria-label="Đường dẫn vị trí">{runtime.breadcrumb.map((e,i)=><span key={e.id}>{i>0&&<i>/</i>}<button onClick={()=>choose(e.id)}>{e.name}</button></span>)}</nav><div className="native-context-heading"><div><small>{current?.type_name||current?.type_key}{current?.code&&` · ${current.code}`}</small><h2>{current?.name}</h2><State value={offline?'UNKNOWN':runtime.overview.state}/></div><div><label>Khoảng thời gian<select value={hours} onChange={e=>setHours(Number(e.target.value))}><option value={0.25}>15 phút</option><option value={1}>1 giờ</option><option value={6}>6 giờ</option><option value={24}>24 giờ</option><option value={168}>7 ngày</option><option value={720}>30 ngày</option></select></label></div></div>

    <div className="native-page-tabs">{runtime.document.pages.map(p=><button key={p.id} className={pageID===p.id?'active':''} onClick={()=>setPage(p.id)}>{p.name}</button>)}<span>Mẫu v{runtime.assignment.template_version||'—'} · Cập nhật {new Date(runtime.generated_at).toLocaleTimeString('vi-VN')} · 5 giây</span><button disabled={loading} onClick={()=>refresh()}>Làm mới</button></div>
    <NativeCanvas runtime={runtime} pageID={pageID} offline={offline||!!error} onEntity={choose}/>
    {runtime.overview.child_total>50&&<div className="native-source-pager"><button disabled={offset===0} onClick={()=>setOffset(n=>Math.max(0,n-50))}>Trang trước</button><span>{offset+1}–{Math.min(offset+50,runtime.overview.child_total)} / {runtime.overview.child_total} thực thể con</span><button disabled={offset+50>=runtime.overview.child_total} onClick={()=>setOffset(n=>n+50)}>Trang sau</button></div>}
   </>}
  </div></div>
  {(modal==='new'||modal==='edit')&&<EntitySetup entity={modal==='edit'?current:undefined} parent={modal==='new'?current:runtime?.breadcrumb.at(-2)} onClose={()=>setModal('')} onSaved={refresh}/>}
  {modal==='bindings'&&current&&<BindingEditor entity={current} onClose={()=>setModal('')} onSaved={refresh}/>}
  {modal==='profile'&&<ProfileEditor onClose={()=>{setModal('');refresh();}}/>}
  {modal==='library'&&<TemplateLibrary entityID={selected} onClose={()=>setModal('')} onApplied={()=>refresh()}/>}
  {modal==='builder'&&<TemplateBuilder entityID={selected} template={template} onClose={()=>setModal('')} onApplied={()=>refresh()}/>}
 {modal==='migration'&&<LegacyMigration onClose={()=>setModal('')} onCreated={refresh}/>}</div>;
}
