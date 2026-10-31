import {useCallback,useEffect,useState} from 'react';
import {request,errorMessage} from '../api/client';
import {t} from '../i18n';
import {type Point} from './pointDashboard';
import {DashboardComposer} from './DashboardComposer';
import type {workspaceDashboard} from './dashboardWorkspace';
import './dashboardWorkspace.css';
import {DashboardEditor} from './DashboardEditor';
import {DashboardWidgets} from '../components/DashboardWidgets';
import {dashboardLink,linkedDashboard,rememberedDashboard,rememberDashboard} from './dashboardChoice';
type Status={enabled:boolean;available:boolean;url?:string;can_edit:boolean};
type Board={uid:string;title:string;url:string;tags?:string[]};
async function grafana<T>(path:string,options:RequestInit={}):Promise<T>{
 const response=await fetch(`/grafana/api/${path}`,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...options.headers}});
 let body;try{body=await response.json();}catch{throw new Error('Grafana tạm thời không phản hồi. Vui lòng thử lại.');}if(!response.ok)throw new Error(body.message||'Không thể kết nối Grafana.');return body;
}
export function Grafana({userID='current',allowCreate=true}:{userID?:string;allowCreate?:boolean}){
 const [status,setStatus]=useState<Status>();const [error,setError]=useState('');const [revision,setRevision]=useState(0);
 const [boards,setBoards]=useState<Board[]>([]);const [selected,setSelected]=useState<Board>();
 const [simpleBoards,setSimpleBoards]=useState<{id:string;name:string}[]>([]);const [simpleSelection,setSimpleSelection]=useState<string>();const [listLoading,setListLoading]=useState(true);
 const [editing,setEditing]=useState(false);const [frameRevision,setFrameRevision]=useState(0);
 const [devices,setDevices]=useState<{id:string;name:string}[]>([]);const [points,setPoints]=useState<Point[]>([]);
 const [creating,setCreating]=useState(false);
 const chooseGrafana=useCallback((board:Board)=>{setSelected(board);setSimpleSelection(undefined);rememberDashboard(userID,{kind:'grafana',id:board.uid});},[userID]);
 const chooseSimple=useCallback((id:string)=>{setSelected(undefined);setSimpleSelection(id);rememberDashboard(userID,{kind:'simple',id});},[userID]);
 useEffect(()=>{let active=true;let statusError='';setError('');setListLoading(true);
  void request<Status>('/grafana/status').catch(()=>{statusError='Chưa kiểm tra được trạng thái Grafana. Các bảng theo dõi đơn giản vẫn được tải riêng.';return {enabled:false,available:false,can_edit:false};}).then(async next=>{
   if(!active)return;setStatus(next);
   void Promise.all([request<typeof devices>('/devices'),request<Point[]>('/tags')]).then(([dev,tags])=>{if(active){setDevices(dev);setPoints(tags);}}).catch(()=>{if(active)setError(previous=>previous+' Không tải được danh sách thiết bị và point. Anh vẫn có thể mở dashboard đã lưu.');});
   const [charts,simple,widgets]=await Promise.allSettled([
    next.available?grafana<Board[]>('search?type=dash-db'):Promise.resolve([] as Board[]),
    request<{id:string;name:string}[]>('/dashboard/boards'),request<{board_id?:string|null}[]>('/dashboard'),
   ]);
   if(!active)return;
   const chartList=charts.status==='fulfilled'&&Array.isArray(charts.value)?charts.value:[];
   const simpleList=simple.status==='fulfilled'&&Array.isArray(simple.value)?simple.value.slice():[];
   if(widgets.status==='fulfilled'&&Array.isArray(widgets.value)&&widgets.value.some(widget=>!widget.board_id))simpleList.unshift({id:'',name:'Bảng theo dõi mặc định'});
   setBoards(chartList);setSimpleBoards(simpleList);
   const errors:string[]=statusError?[statusError]:[];
   if(charts.status==='rejected')errors.push('Chưa tải được danh sách dashboard Grafana. Hãy làm mới danh sách.');
   if(simple.status==='rejected'||widgets.status==='rejected')errors.push('Chưa tải được đầy đủ các bảng theo dõi đơn giản.');
   const link=linkedDashboard(),choice=link||rememberedDashboard(userID);
   let chart=choice?.kind==='grafana'?chartList.find(board=>board.uid===choice.id):undefined;
   if(choice?.kind==='grafana'&&!chart&&next.available){
    try{
     const saved=await grafana<{dashboard:{uid:string;title:string}}>(`dashboards/uid/${encodeURIComponent(choice.id)}`);
     if(!active)return;
     if(saved.dashboard?.uid===choice.id){chart={uid:saved.dashboard.uid,title:saved.dashboard.title,url:`/d/${encodeURIComponent(choice.id)}`};const recovered=chart;setBoards(previous=>[recovered,...previous.filter(board=>board.uid!==recovered.uid)]);}
    }catch{/* Keep the requested identity; never replace it with an unrelated dashboard. */}
   }
   if(!active)return;
   const savedSimple=choice?.kind==='simple'?simpleList.find(board=>board.id===choice.id):undefined;
   if(chart)chooseGrafana(chart);else if(savedSimple)chooseSimple(savedSimple.id);
   else if(choice){setSelected(undefined);setSimpleSelection(undefined);errors.push('Chưa mở được dashboard đã chọn hoặc anh không có quyền xem. Lựa chọn vẫn được giữ; hãy làm mới danh sách hoặc chọn một bảng đã lưu bên dưới.');}
   else {const first=chartList.find(board=>board.uid!=='rallyx-overview');if(first)chooseGrafana(first);else if(simpleList.length)chooseSimple(simpleList[0].id);}
   setError(previous=>[...errors,previous].filter(Boolean).join(' '));
  }).catch(e=>{if(active)setError(errorMessage(e));}).finally(()=>{if(active)setListLoading(false);});
  return()=>{active=false;};
 },[revision,userID,chooseGrafana,chooseSimple]);
 useEffect(()=>{const refresh=()=>{if(!editing&&!creating&&document.visibilityState==='visible')setRevision(n=>n+1);};window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[editing,creating]);
 async function create(doc:ReturnType<typeof workspaceDashboard>){
  const result=await grafana<{uid:string;url:string}>('dashboards/db',{method:'POST',body:JSON.stringify({dashboard:doc,overwrite:false,message:'Tạo dashboard nhiều cấp trong RallyX'})});
  if(!result.uid||!/^[-a-zA-Z0-9_]+$/.test(result.uid))throw new Error('Grafana trả về mã dashboard không hợp lệ.');
  const board={...result,title:doc.title};setBoards(old=>[board,...old]);chooseGrafana(board);setCreating(false);
 }
 return <div className="grafana-page dashboard-workspace">
  <div className="workspace-navigation"><div className="dashboard-tabs" aria-label="Dashboard đã lưu">
   {boards.filter(b=>b.uid!=='rallyx-overview').map(b=><button key={b.uid} title={b.title} aria-pressed={selected?.uid===b.uid} className={selected?.uid===b.uid?'active':''} onClick={()=>chooseGrafana(b)}>{b.title}</button>)}
   {simpleBoards.map(board=><button key={`simple-${board.id}`} aria-label={`${board.name} · Bảng theo dõi đơn giản`} aria-pressed={simpleSelection===board.id} className={simpleSelection===board.id?'active':''} onClick={()=>chooseSimple(board.id)}>{board.name}</button>)}
  </div>{allowCreate&&status?.available&&status.can_edit&&<button className="primary" onClick={()=>{setCreating(true);setError('');}}>Tạo dashboard</button>}<button aria-label="Làm mới danh sách" disabled={listLoading} onClick={()=>setRevision(n=>n+1)}>Làm mới</button></div>
  {error&&<p className="error" role="alert">{t(error)}</p>}
  {listLoading&&!selected&&simpleSelection===undefined&&<p role="status">Đang tải các dashboard đã lưu…</p>}
  {status&&!status.available&&<p className="warning">{t('Grafana is temporarily unavailable. Data collection continues.')} <button onClick={()=>setRevision(n=>n+1)}>{t('Retry')}</button></p>}
  {!listLoading&&!selected&&simpleSelection===undefined&&<div className="dashboard-empty"><span>▥</span><h2>Không gian giám sát của nhà máy</h2><p>Tạo dashboard theo nhà máy, khu vực hoặc máy. Kết hợp chỉ số, đồng hồ và biểu đồ của nhiều thiết bị trên cùng một bảng.</p>{status?.available&&<button onClick={()=>chooseGrafana({uid:'rallyx-overview',title:'Tổng quan hệ thống',url:'/d/rallyx-overview'})}>Xem dashboard tổng quan</button>}</div>}
  {selected&&<><div className="workspace-actions"><strong>{selected.title}</strong><span>Dữ liệu hiện trường · Tự cập nhật 5 giây</span><div><a href={dashboardLink({kind:'grafana',id:selected.uid})} target="_blank" rel="noopener noreferrer">Mở tab mới ↗</a>{status?.can_edit&&<button onClick={()=>setEditing(true)}>Tùy chỉnh / kéo thả</button>}{status?.can_edit&&<a href={`/grafana/d/${encodeURIComponent(selected.uid)}`} target="_blank" rel="noopener noreferrer">Grafana ↗</a>}</div></div><iframe key={`${selected.uid}-${frameRevision}`} title={t('Grafana dashboards')} src={`/grafana/d/${encodeURIComponent(selected.uid)}?kiosk&theme=dark`} className="dashboard-frame"/></>}
  {simpleSelection!==undefined&&<DashboardWidgets readOnly={!allowCreate} key={simpleSelection} initialBoardID={simpleSelection} onBoardSelect={chooseSimple}/>}
  {creating&&<DashboardComposer points={points} devices={devices} onClose={()=>setCreating(false)} onApply={create}/>}
  {selected&&editing&&<div className="editor-modal-backdrop" role="dialog" aria-modal="true" aria-label="Cấu hình bố cục dashboard"><DashboardEditor uid={selected.uid} points={points} devices={devices} api={grafana} onClose={()=>{setEditing(false);setFrameRevision(n=>n+1);}} onSaved={title=>{setSelected({...selected,title});setBoards(old=>old.map(board=>board.uid===selected.uid?{...board,title}:board));setFrameRevision(n=>n+1);}}/></div>}
 </div>;
}