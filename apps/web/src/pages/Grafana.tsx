import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {request,errorMessage} from '../api/client';
import {t} from '../i18n';
import {pointDashboard,type Point} from './pointDashboard';
import {DashboardEditor} from './DashboardEditor';
import {DashboardWidgets} from '../components/DashboardWidgets';
import {dashboardLink,linkedDashboard,rememberedDashboard,rememberDashboard} from './dashboardChoice';
type Status={enabled:boolean;available:boolean;url?:string;can_edit:boolean};
type Board={uid:string;title:string;url:string;tags?:string[]};
async function grafana<T>(path:string,options:RequestInit={}):Promise<T>{
 const response=await fetch(`/grafana/api/${path}`,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...options.headers}});
 let body;try{body=await response.json();}catch{throw new Error('Grafana tạm thời không phản hồi. Vui lòng thử lại.');}if(!response.ok)throw new Error(body.message||'Không thể kết nối Grafana.');return body;
}
export function Grafana({userID='current'}:{userID?:string}){
 const [status,setStatus]=useState<Status>();const [error,setError]=useState('');const [revision,setRevision]=useState(0);
 const [boards,setBoards]=useState<Board[]>([]);const [selected,setSelected]=useState<Board>();
 const [simpleBoards,setSimpleBoards]=useState<{id:string;name:string}[]>([]);const [simpleSelection,setSimpleSelection]=useState<string>();const [listLoading,setListLoading]=useState(true);
 const [editing,setEditing]=useState(false);const [frameRevision,setFrameRevision]=useState(0);
 const [devices,setDevices]=useState<{id:string;name:string}[]>([]);const [points,setPoints]=useState<Point[]>([]);
 const [creating,setCreating]=useState(false);const [busy,setBusy]=useState(false);
 const [device,setDevice]=useState('');const [pointID,setPointID]=useState('');const [search,setSearch]=useState('');
 const [kind,setKind]=useState('timeseries');const [name,setName]=useState('');const [min,setMin]=useState(0);const [max,setMax]=useState(100);
 const point=points.find(p=>p.id===pointID);const numeric=point&&!['bool','boolean','string'].includes(point.data_type);
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
 useEffect(()=>{const refresh=()=>{if(!editing&&document.visibilityState==='visible')setRevision(n=>n+1);};window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[editing]);
 async function create(event:FormEvent){event.preventDefault();if(!point||!status?.can_edit||busy)return;setBusy(true);setError('');try{
  const result=await grafana<{uid:string;url:string}>('dashboards/db',{method:'POST',body:JSON.stringify({dashboard:pointDashboard(point,name.trim(),kind,min,max),overwrite:false,message:'Tạo từ trình chọn điểm dữ liệu RallyX'})});
  if(!result.uid||!/^[-a-zA-Z0-9_]+$/.test(result.uid))throw new Error('Grafana trả về mã dashboard không hợp lệ.');
  const board={...result,title:name.trim()};setBoards(old=>[board,...old]);chooseGrafana(board);setCreating(false);
 }catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 return <section className="grafana-page">
  {!editing&&<div className="toolbar"><p className="muted">Chọn một dashboard đã lưu hoặc tạo dashboard từ điểm dữ liệu của thiết bị.</p>{status?.available&&status.can_edit&&<button className="primary" onClick={()=>{setCreating(true);setError('');}}>Tạo dashboard cho một point</button>}</div>}
  {error&&<p className="error" role="alert">{t(error)}</p>}
  {!status&&!error&&<p role="status">Đang tải dashboard…</p>}
  {status&&!status.available&&<article><p>{t('Grafana is temporarily unavailable. Data collection continues.')}</p><button onClick={()=>setRevision(n=>n+1)}>{t('Retry')}</button></article>}
  {status&&<>
   {!editing&&<>
   {creating&&<article><h2>Tạo dashboard từ điểm dữ liệu</h2><p>Mỗi dashboard dưới đây gắn với đúng một point. Không cần cấu hình datasource hay viết truy vấn.</p><form className="form-grid" onSubmit={create}>
    <label>1. Thiết bị<select required value={device} onChange={e=>{setDevice(e.target.value);setPointID('');setSearch('');}}><option value="">Chọn thiết bị</option>{devices.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
    <label>Tìm điểm dữ liệu<input disabled={!device} value={search} placeholder="Tên hoặc mã point" onChange={e=>setSearch(e.target.value)}/></label>
    <label>2. Điểm dữ liệu<select required disabled={!device} value={pointID} onChange={e=>{const p=points.find(p=>p.id===e.target.value);setPointID(e.target.value);if(p){setName(`${devices.find(d=>d.id===device)?.name} · ${p.name}`);setKind(['bool','boolean','string'].includes(p.data_type)||p.store_history===false?'stat':'timeseries');}}}><option value="">Chọn point cần hiển thị</option>{points.filter(p=>p.device_id===device&&(!search||`${p.name} ${p.key}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())||p.id===pointID)).map(p=><option key={p.id} value={p.id}>{p.name} · {p.key} · {p.unit||p.data_type}</option>)}</select></label>
    <label>3. Kiểu hiển thị<select disabled={!point} value={kind} onChange={e=>setKind(e.target.value)}><option value="stat">Giá trị hiện tại / trạng thái</option>{numeric&&<><option value="timeseries" disabled={point.store_history===false}>Biểu đồ xu hướng theo thời gian</option><option value="gauge">Đồng hồ đo</option><option value="bargauge">Thanh mức giá trị</option></>}<option value="table">Bảng giá trị</option></select></label>
    {(kind==='gauge'||kind==='bargauge')&&<><label>Giới hạn dưới<input required type="number" value={min} onChange={e=>setMin(Number(e.target.value))}/></label><label>Giới hạn trên<input required type="number" min={min+Number.EPSILON} value={max} onChange={e=>setMax(Number(e.target.value))}/></label></>}
    <label>4. Tên dashboard<input required maxLength={160} value={name} onChange={e=>setName(e.target.value)}/></label>
    {point&&<p>Đang chọn: <strong>{devices.find(d=>d.id===device)?.name} → {point.name}</strong> · {point.unit||point.data_type}{point.store_history===false?' · Point chưa bật lưu lịch sử.':''}</p>}
    <div className="toolbar"><button className="primary" disabled={!point||!name.trim()||busy||((kind==='gauge'||kind==='bargauge')&&max<=min)}>{busy?'Đang tạo…':'Tạo và mở dashboard'}</button><button type="button" disabled={busy} onClick={()=>setCreating(false)}>Hủy</button></div>
   </form></article>}
   <article><div className="toolbar"><h2>Dashboard đã lưu</h2><button disabled={listLoading} onClick={()=>setRevision(n=>n+1)}>Làm mới danh sách</button></div>
    {listLoading&&<p role="status">Đang tải các dashboard đã lưu…</p>}
    {!listLoading&&!error&&!boards.some(b=>b.uid!=='rallyx-overview')&&!simpleBoards.length&&<p>Chưa có dashboard riêng. Chọn “Tạo dashboard cho một point” để bắt đầu.</p>}
    <div className="toolbar">{boards.filter(b=>b.uid!=='rallyx-overview').map(b=><button key={b.uid} className={selected?.uid===b.uid?'primary':'secondary'} onClick={()=>chooseGrafana(b)}>{b.title}</button>)}</div>
    {simpleBoards.length>0&&<><h3>Bảng theo dõi đơn giản đã lưu</h3><p className="muted">Các bảng gồm chỉ số, đồng hồ và biểu đồ từ point đã tạo trước đây. Chọn tên bảng để xem lại.</p><div className="toolbar">{simpleBoards.map(board=><button key={board.id} aria-label={`${board.name} · Bảng theo dõi đơn giản`} className={simpleSelection===board.id?'primary':'secondary'} onClick={()=>chooseSimple(board.id)}>{board.name}</button>)}</div></>}
    {status.available&&<details><summary>Tham khảo và tùy chỉnh nâng cao</summary><div className="toolbar"><button onClick={()=>chooseGrafana({uid:'rallyx-overview',title:'Dashboard mẫu tổng hợp',url:'/d/rallyx-overview/rallyx'})}>Xem dashboard mẫu tổng hợp</button><a href="/grafana/" target="_blank" rel="noopener noreferrer">{t(status.can_edit?'Open Grafana editor':'Open Grafana')}</a></div></details>}
   </article>
   </>}
   {simpleSelection!==undefined&&<><div className="toolbar"><h2>{simpleBoards.find(board=>board.id===simpleSelection)?.name||'Bảng theo dõi đơn giản'}</h2><a href={dashboardLink({kind:'simple',id:simpleSelection})} target="_blank" rel="noopener noreferrer">Mở dashboard trong tab mới</a></div><p className="muted">Bảng theo dõi gồm các chỉ số và biểu đồ đã ghim từ point. Mỗi thay đổi được lưu vào tài khoản đang đăng nhập.</p><DashboardWidgets key={simpleSelection} initialBoardID={simpleSelection} onBoardSelect={chooseSimple}/></>}
   {selected&&(editing?<DashboardEditor uid={selected.uid} points={points} devices={devices} api={grafana} onClose={()=>{setEditing(false);setFrameRevision(n=>n+1);}} onSaved={title=>{setSelected({...selected,title});setBoards(old=>old.map(board=>board.uid===selected.uid?{...board,title}:board));setFrameRevision(n=>n+1);}}/>:<><div className="toolbar"><h2>{selected.title}</h2><a href={dashboardLink({kind:'grafana',id:selected.uid})} target="_blank" rel="noopener noreferrer">Mở dashboard trong tab mới</a><button onClick={()=>setSelected(undefined)}>Đóng dashboard</button>{status.can_edit&&<button className="primary" onClick={()=>setEditing(true)}>Tùy chỉnh / kéo thả</button>}{status.can_edit&&<a href={`/grafana/d/${encodeURIComponent(selected.uid)}`} target="_blank" rel="noopener noreferrer">Chỉnh sửa nâng cao trong Grafana</a>}</div><iframe key={`${selected.uid}-${frameRevision}`} title={t('Grafana dashboards')} src={`/grafana/d/${encodeURIComponent(selected.uid)}?kiosk`} style={{width:'100%',height:'75vh',minHeight:600,border:'1px solid #dce3ec',borderRadius:8}}/></>)}
  </>}
 </section>;
}
