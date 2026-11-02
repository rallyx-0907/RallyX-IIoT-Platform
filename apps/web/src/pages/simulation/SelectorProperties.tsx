import {BufferedInput} from './BufferedInput';

type Kind='number'|'boolean'|'string';
type Position={value:number|boolean|string;label:string};
function positionsOf(value:unknown):Position[]{
 if(Array.isArray(value)&&[2,3].includes(value.length)&&value.every(p=>p&&typeof p.label==='string'&&['number','boolean','string'].includes(typeof p.value)))return value;
 return [{value:0,label:'Vị trí 1'},{value:1,label:'Vị trí 2'}];
}
export function convertSelectorPositions(value:unknown,kind:Kind):Position[]{
 const positions=positionsOf(value);return (kind==='boolean'?positions.slice(0,2):positions).map((p,index)=>({...p,value:typeof p.value===kind?p.value:kind==='boolean'?index===1:kind==='number'?index:String(p.value)}));
}
export function SelectorProperties({properties,onChange,boundType}:{properties:Record<string,unknown>;onChange:(properties:Record<string,unknown>)=>void;boundType?:Kind}){
 const positions=positionsOf(properties.positions),kind=boundType||typeof positions[0].value as Kind;
 const setPositions=(next:Position[])=>onChange({...properties,positions:next});
 const update=(index:number,patch:Partial<Position>)=>setPositions(positions.map((p,i)=>i===index?{...p,...patch}:p));
 const duplicate=new Set(positions.map(p=>typeof p.value+':'+String(p.value))).size!==positions.length;
 return <fieldset className="selector-properties"><legend>Các vị trí công tắc</legend>
  <label>Số vị trí<select value={positions.length} onChange={event=>{
   const count=Number(event.target.value);if(count===2){setPositions(positions.slice(0,2));return;}
   let next=2;while(positions.some(p=>p.value===(kind==='number'?next:String(next))))next++;
   setPositions([...positions,{value:kind==='number'?next:String(next),label:'Vị trí 3'}]);
  }}><option value="2">2 vị trí</option><option value="3" disabled={kind==='boolean'}>3 vị trí</option></select></label>
  <label>Kiểu giá trị<select value={kind} disabled={Boolean(boundType)} onChange={event=>setPositions(convertSelectorPositions(positions,event.target.value as Kind))}><option value="number">Số</option><option value="boolean" disabled={positions.length===3}>Logic (false / true)</option><option value="string">Chuỗi ký tự</option></select></label>
  {boundType&&<p>Kiểu giá trị theo tín hiệu đã chọn. Công tắc chỉ hiển thị trạng thái.</p>}
  {positions.map((position,index)=><div key={index} className="selector-position-fields"><strong>Vị trí {index+1}</strong><label>Nhãn vị trí {index+1}<input maxLength={80} value={position.label} onChange={event=>update(index,{label:event.target.value})}/></label><label>Giá trị vị trí {index+1}{kind==='boolean'?<select value={String(position.value)} onChange={event=>update(index,{value:event.target.value==='true'})}><option value="false">false</option><option value="true">true</option></select>:<BufferedInput type={kind==='number'?'number':'text'} maxLength={2000} value={String(position.value)} onChange={event=>{const raw=event.target.value;const value=kind==='number'?Number(raw):raw;if(typeof value==='number'&&!Number.isFinite(value))return;update(index,{value});}}/>}</label></div>)}
  {duplicate&&<p className="error" role="alert">Giá trị của các vị trí phải khác nhau.</p>}
 </fieldset>;
}
