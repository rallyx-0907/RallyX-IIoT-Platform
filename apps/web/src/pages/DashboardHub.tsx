import {useEffect,useRef,useState,type ReactNode} from 'react';
import {errorMessage,post,request} from '../api/client';
import type {Tag,User} from '../types/platform';
import type {DashboardDocument,SimulationMode} from '../types/simulation';
import {SimulationEditor} from './simulation/SimulationEditor';
import './dashboardHub.css';

type Props={user:User;tags:Tag[];connection:string;standard:ReactNode};
const selectedFromURL=()=>new URLSearchParams(location.search).get('simulation')||'';
export function DashboardHub({user,tags,connection,standard}:Props){
 const [items,setItems]=useState<DashboardDocument[]>([]),[id,setID]=useState(selectedFromURL);
 const [saved,setSaved]=useState<DashboardDocument|null>(null),[draft,setDraft]=useState<DashboardDocument|null>(null);
 const [mode,setMode]=useState<SimulationMode>('live'),[creating,setCreating]=useState(false),[name,setName]=useState(''),[kind,setKind]=useState('simulation');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[loading,setLoading]=useState(false),[deleting,setDeleting]=useState(false);
 const dirty=Boolean(draft&&saved&&JSON.stringify(draft)!==JSON.stringify(saved));
 const dirtyRef=useRef(dirty);dirtyRef.current=dirty;
 const idRef=useRef(id);idRef.current=id;
 const admin=user.role==='admin';
 const loadList=()=>request<DashboardDocument[]>('/dashboards').then(setItems);
 useEffect(()=>{let active=true;request<DashboardDocument[]>('/dashboards').then(result=>{if(active)setItems(result);}).catch(e=>{if(active)setError('Danh sách dashboard: '+errorMessage(e));});return()=>{active=false;};},[user.id]);
 useEffect(()=>{
  let active=true;setError('');setNotice('');setSaved(null);setDraft(null);setMode('live');setDeleting(false);
  if(!id){setLoading(false);return;}
  setLoading(true);request<DashboardDocument>('/dashboards/'+encodeURIComponent(id)).then(result=>{if(active){setSaved(result);setDraft(result);}}).catch(e=>{if(active)setError(errorMessage(e));}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[id,user.id]);
 useEffect(()=>{
  const before=(event:BeforeUnloadEvent)=>{if(dirtyRef.current){event.preventDefault();event.returnValue='';}};
  const guard=(event:Event)=>{if(dirtyRef.current&&!window.confirm('Bạn có thay đổi chưa lưu. Rời dashboard?'))event.preventDefault();};
  const pop=()=>{if(dirtyRef.current&&!window.confirm('Bạn có thay đổi chưa lưu. Rời dashboard?')){const url=new URL(location.href);if(idRef.current)url.searchParams.set('simulation',idRef.current);else url.searchParams.delete('simulation');history.replaceState(null,'',url.pathname+url.search+'#dashboards');return;}setID(selectedFromURL());};
  window.addEventListener('beforeunload',before);window.addEventListener('popstate',pop);window.addEventListener('rallyx:before-navigate',guard);
  return()=>{window.removeEventListener('beforeunload',before);window.removeEventListener('popstate',pop);window.removeEventListener('rallyx:before-navigate',guard);};
 },[]);
 const select=(next:string)=>{
  if(next===id)return;
  if(dirty&&!window.confirm('Bạn có thay đổi chưa lưu. Rời dashboard?'))return;
  const url=new URL(location.href);if(next){url.searchParams.set('simulation',next);url.searchParams.delete('entity');}else url.searchParams.delete('simulation');
  url.searchParams.delete('dashboard');url.searchParams.delete('simpleBoard');history.pushState(null,'',url.pathname+url.search+'#dashboards');setID(next);
 };
 const create=async()=>{
  if(kind==='standard'){setCreating(false);select('');return;}
  setBusy(true);setError('');try{const result=await post<DashboardDocument>('/dashboards',{name:name.trim(),type:'simulation'});setCreating(false);setName('');await loadList();select(result.id);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}
 };
 const save=async()=>{
  if(!draft||!saved)return;const submitted=draft;setBusy(true);setError('');try{
   const result=await request<DashboardDocument>('/dashboards/'+encodeURIComponent(submitted.id),{method:'PATCH',body:JSON.stringify({name:submitted.name,canvas:submitted.canvas,layout:submitted.layout,revision:saved.revision})});
   if(idRef.current===submitted.id){setSaved(result);setDraft(current=>current===submitted?result:current?{...current,revision:result.revision,updatedAt:result.updatedAt}:current);setNotice('Đã lưu');}
   await loadList();
  }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
 };
 const remove=async()=>{
  if(!saved)return;setBusy(true);setError('');try{
   // DELETE returns 204, unlike the JSON API client used for document requests.
   const response=await fetch('/api/v1/dashboards/'+encodeURIComponent(saved.id),{method:'DELETE',credentials:'same-origin'});
   if(!response.ok){let message='Không thể xóa dashboard';try{message=(await response.json()).error?.message||message;}catch{/* Preserve the HTTP error. */}throw new Error(message);}
   setDraft(null);setSaved(null);setID('');const url=new URL(location.href);url.searchParams.delete('simulation');history.replaceState(null,'',url.pathname+url.search+'#dashboards');setDeleting(false);await loadList();
  }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
 };
 return <div className="dashboard-hub">
  <nav className="dashboard-directory" aria-label="Danh sách dashboard"><div className="dashboard-directory-title"><strong>Dashboard của bạn</strong>{admin&&<button onClick={()=>{setCreating(true);setError('');}}>Tạo dashboard</button>}</div>
   <div className="dashboard-tabs"><button className={!id?'selected':''} aria-pressed={!id} onClick={()=>select('')}>Giám sát vận hành · Phân tích</button>{items.map(item=><button key={item.id} className={id===item.id?'selected':''} aria-pressed={id===item.id} onClick={()=>select(item.type==='simulation'?item.id:'')}>{item.name} · {item.type==='simulation'?'Sơ đồ thiết bị':'Phân tích'}</button>)}</div>
  </nav>
  {error&&<p className="error" role="alert">{error}</p>}
  {!id?standard:loading?<p role="status">Đang tải sơ đồ…</p>:draft&&<>
   <div className="simulation-toolbar"><div><h2>{draft.name}</h2><small>Sơ đồ thiết bị · Chỉ đọc dữ liệu hiện trường</small></div><div className="simulation-mode-buttons" role="group" aria-label="Chế độ dashboard"><button aria-pressed={mode==='live'} onClick={()=>setMode('live')}>Trực tiếp</button>{admin&&<><button aria-pressed={mode==='preview'} onClick={()=>setMode('preview')}>Xem thử</button><button aria-pressed={mode==='design'} onClick={()=>setMode('design')}>Thiết kế</button></>}</div>
    {admin&&<div className="simulation-save"><span role="status">{dirty?'Chưa lưu thay đổi':notice||'Đã lưu'}</span><button disabled={busy||!dirty} onClick={()=>void save()}>Lưu dashboard</button>{mode==='design'&&<button className="secondary" onClick={()=>setDeleting(true)}>Xóa dashboard</button>}</div>}
   </div>
   {mode==='design'&&admin&&<label className="simulation-name">Tên dashboard<input maxLength={200} value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></label>}
   <SimulationEditor key={draft.id} dashboard={draft} onChange={admin?setDraft:()=>{}} tags={tags} connection={connection} mode={admin?mode:'live'}/>
  </>}
  {creating&&<div className="simulation-modal-backdrop"><form className="simulation-modal" role="dialog" aria-modal="true" aria-labelledby="create-dashboard-title" onSubmit={event=>{event.preventDefault();void create();}}><h2 id="create-dashboard-title">Tạo dashboard</h2>{error&&<p className="error" role="alert">{error}</p>}<label>Loại dashboard<select value={kind} onChange={event=>setKind(event.target.value)}><option value="simulation">Sơ đồ thiết bị — đèn, đồng hồ, sơ đồ tự do</option><option value="standard">Phân tích — chỉ số, trạng thái, xu hướng</option></select></label>{kind==='simulation'?<label>Tên dashboard<input autoFocus required maxLength={200} value={name} onChange={event=>setName(event.target.value)} placeholder="Ví dụ: Sơ đồ trạm bơm"/></label>:<p>Mở không gian giám sát phân tích hiện có. Bạn có thể tạo và áp dụng mẫu theo nhà máy, máy và thiết bị tại đó.</p>}<div className="simulation-dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>setCreating(false)}>Hủy</button><button disabled={busy||(kind==='simulation'&&!name.trim())}>{kind==='simulation'?'Tạo sơ đồ':'Mở dashboard phân tích'}</button></div></form></div>}
  {deleting&&<div className="simulation-modal-backdrop"><div className="simulation-modal" role="dialog" aria-modal="true" aria-labelledby="delete-dashboard-title"><h2 id="delete-dashboard-title">Xóa dashboard này?</h2><p>Chỉ xóa bố cục sơ đồ. Dữ liệu tín hiệu và lịch sử vẫn được giữ lại.</p><div className="simulation-dialog-actions"><button className="secondary" disabled={busy} onClick={()=>setDeleting(false)}>Hủy</button><button disabled={busy} onClick={()=>void remove()}>Xóa sơ đồ</button></div></div></div>}
 </div>;
}
