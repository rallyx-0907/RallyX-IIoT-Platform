import {useEffect,useState} from 'react';
import {request,errorMessage} from '../../api/client';
import {NativeDialog} from './NativeDialog';
export function LegacyMigration({onClose,onCreated}:{onClose:()=>void;onCreated:(id:string)=>void}){
 const [boards,setBoards]=useState<{id:string;name:string}[]>([]),[selected,setSelected]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{void request<typeof boards>('/dashboard/boards').then(setBoards).catch(e=>setError(errorMessage(e)));},[]);
 async function migrate(){setBusy(true);setError('');try{const result=await request<{entity_id:string}>('/dashboard-boards/'+encodeURIComponent(selected)+'/migrate-native',{method:'POST'});onCreated(result.entity_id);onClose();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 return <NativeDialog title="Chuyển bảng theo dõi cũ" onClose={onClose} busy={busy} footer={<><button disabled={busy} onClick={onClose}>Hủy</button><button className="primary" disabled={!selected||!confirmed||busy} onClick={()=>void migrate()}>Tạo bản dashboard dùng chung</button></>}>
 <p>Sao chép bảng cá nhân thành dashboard dùng chung trong cây vị trí. Bảng cũ và lịch sử dữ liệu được giữ nguyên.</p>
 <label>Bảng đã lưu<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Chọn bảng cần chuyển</option>{boards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
 {!boards.length&&!error&&<p>Chưa có bảng theo dõi cũ đã lưu để chuyển.</p>}
 <label className="native-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Cho phép người dùng có quyền giám sát xem bản dashboard mới.</label>
 <p>Dashboard Grafana vẫn mở trong Báo cáo nâng cao; công cụ này chuyển các bảng theo dõi đơn giản đã lưu.</p>
 {error&&<p role="alert" className="error">{error}</p>}
 </NativeDialog>;
}
