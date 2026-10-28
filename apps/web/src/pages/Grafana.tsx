import {useEffect,useState,type FormEvent} from 'react';
import {request,errorMessage} from '../api/client';
import {t} from '../i18n';
import {pointDashboard,type Point} from './pointDashboard';
type Status={enabled:boolean;available:boolean;url?:string;can_edit:boolean};
type Board={uid:string;title:string;url:string;tags?:string[]};
async function grafana<T>(path:string,options:RequestInit={}):Promise<T>{
 const response=await fetch(`/grafana/api/${path}`,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...options.headers}});
 let body;try{body=await response.json();}catch{throw new Error('Grafana tạm thời không phản hồi. Vui lòng thử lại.');}if(!response.ok)throw new Error(body.message||'Không thể kết nối Grafana.');return body;
}
export function Grafana(){
 const [status,setStatus]=useState<Status>();const [error,setError]=useState('');const [revision,setRevision]=useState(0);
 const [boards,setBoards]=useState<Board[]>([]);const [selected,setSelected]=useState<Board>();
 const [devices,setDevices]=useState<{id:string;name:string}[]>([]);const [points,setPoints]=useState<Point[]>([]);
 const [creating,setCreating]=useState(false);const [busy,setBusy]=useState(false);
 const [device,setDevice]=useState('');const [pointID,setPointID]=useState('');const [search,setSearch]=useState('');
 const [kind,setKind]=useState('timeseries');const [name,setName]=useState('');const [min,setMin]=useState(0);const [max,setMax]=useState(100);
 const point=points.find(p=>p.id===pointID);const numeric=point&&!['bool','boolean','string'].includes(point.data_type);
 useEffect(()=>{let active=true;setError('');void request<Status>('/grafana/status').then(async next=>{if(!active)return;setStatus(next);if(next.available){await Promise.all([grafana<Board[]>('search?type=dash-db').then(list=>{if(active)setBoards(Array.isArray(list)?list:[]);}),Promise.all([request<typeof devices>('/devices'),request<Point[]>('/tags')]).then(([dev,tags])=>{if(active){setDevices(dev);setPoints(tags);}}).catch(()=>{if(active)setError('Không tải được danh sách thiết bị và point. Anh vẫn có thể mở dashboard đã lưu.');})]);}}).catch(e=>{if(active)setError(errorMessage(e));});return()=>{active=false;};},[revision]);
 async function create(event:FormEvent){event.preventDefault();if(!point||!status?.can_edit||busy)return;setBusy(true);setError('');try{
  const result=await grafana<{uid:string;url:string}>('dashboards/db',{method:'POST',body:JSON.stringify({dashboard:pointDashboard(point,name.trim(),kind,min,max),overwrite:false,message:'Tạo từ trình chọn điểm dữ liệu RallyX'})});
  if(!result.uid||!/^[-a-zA-Z0-9_]+$/.test(result.uid))throw new Error('Grafana trả về mã dashboard không hợp lệ.');
  const board={...result,title:name.trim()};setBoards(old=>[board,...old]);setSelected(board);setCreating(false);
 }catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 return <section className="grafana-page">
  <div className="toolbar"><p className="muted">Chọn một dashboard đã lưu hoặc tạo dashboard từ điểm dữ liệu của thiết bị.</p>{status?.available&&status.can_edit&&<button className="primary" onClick={()=>{setCreating(true);setError('');}}>Tạo dashboard cho một point</button>}</div>
  {error&&<p className="error" role="alert">{t(error)}</p>}
  {!status&&!error&&<p role="status">Đang tải dashboard…</p>}
  {status&&!status.available&&<article><p>{t('Grafana is temporarily unavailable. Data collection continues.')}</p><button onClick={()=>setRevision(n=>n+1)}>{t('Retry')}</button></article>}
  {status?.available&&<>
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
   <article><h2>Dashboard của bạn</h2>{!boards.filter(b=>b.uid!=='rallyx-overview').length&&<p>Chưa có dashboard riêng. Chọn “Tạo dashboard cho một point” để bắt đầu.</p>}<div className="toolbar">{boards.filter(b=>b.uid!=='rallyx-overview').map(b=><button key={b.uid} className={selected?.uid===b.uid?'primary':'secondary'} onClick={()=>setSelected(b)}>{b.title}</button>)}</div><details><summary>Tham khảo và tùy chỉnh nâng cao</summary><div className="toolbar"><button onClick={()=>setSelected({uid:'rallyx-overview',title:'Dashboard mẫu tổng hợp',url:'/d/rallyx-overview/rallyx'})}>Xem dashboard mẫu tổng hợp</button><a href="/grafana/" target="_blank" rel="noopener noreferrer">{t(status.can_edit?'Open Grafana editor':'Open Grafana')}</a><a href="#widgets">{t('Legacy data widgets')}</a></div></details></article>
   {selected&&<><div className="toolbar"><h2>{selected.title}</h2><button onClick={()=>setSelected(undefined)}>Đóng dashboard</button>{status.can_edit&&<a href={`/grafana/d/${encodeURIComponent(selected.uid)}`} target="_blank" rel="noopener noreferrer">Chỉnh sửa nâng cao trong Grafana</a>}</div><iframe key={selected.uid} title={t('Grafana dashboards')} src={`/grafana/d/${encodeURIComponent(selected.uid)}?kiosk`} style={{width:'100%',height:'75vh',minHeight:600,border:'1px solid #dce3ec',borderRadius:8}}/></>}
  </>}
 </section>;
}
