import {pointDashboard,type Point} from './pointDashboard';
import type {Site,Sample} from '../types/platform';
export type Scope={site?:string;area?:string;asset?:string;device?:string};
export type ChartChoice={point:Point;kind:string;min:number;max:number};
export function stateLabel(point:Point,value:boolean){
 return point.semantic==='fault'?(value?'LỖI':'BÌNH THƯỜNG'):point.semantic==='run'?(value?'ĐANG CHẠY':'DỪNG'):(value?'BẬT':'TẮT');
}
function mappings(point:Point){return ['bool','boolean'].includes(point.data_type)?{mappings:[{type:'value',options:{true:{text:stateLabel(point,true),color:point.semantic==='fault'?'red':'green'},false:{text:stateLabel(point,false),color:point.semantic==='run'?'orange':'green'}}}]}:{};}
export function previewFresh(tag?:{quality?:string;ts?:string;enabled?:boolean;realtime_enabled?:boolean;archived?:boolean;tag_enabled?:boolean;device_enabled?:boolean;asset_enabled?:boolean;stale_seconds?:number}){
 return !!tag&&!tag.archived&&tag.enabled!==false&&tag.tag_enabled!==false&&tag.device_enabled!==false&&tag.asset_enabled!==false&&tag.realtime_enabled!==false&&tag.quality==='GOOD'&&!!tag.ts&&Number.isFinite(Date.parse(tag.ts))&&Date.now()-Date.parse(tag.ts)<=(tag.stale_seconds||60)*1000;
}
export function previewPath(samples:Sample[],start:number){
 const valid=samples.filter(s=>s.quality==='GOOD'&&typeof s.value==='number'&&Number.isFinite(s.value));
 const nums=valid.map(s=>Number(s.value)),lo=Math.min(...nums),hi=Math.max(...nums);let pen=false;
 return samples.map(s=>{if(s.quality!=='GOOD'||typeof s.value!=='number'||!Number.isFinite(s.value)||!Number.isFinite(Date.parse(s.ts))){pen=false;return '';}
 const command=pen?'L':'M';pen=true;return `${command}${Math.max(0,Math.min(400,(Date.parse(s.ts)-start)/3600000*400))},${125-(s.value-lo)/(hi-lo||1)*100}`;
 }).join(' ');
}
export function scopePoints(tree:Site[],scope:Scope):string[]{
 return tree.filter(s=>!scope.site||s.id===scope.site).flatMap(s=>s.areas.filter(a=>!scope.area||a.id===scope.area).flatMap(a=>a.assets.filter(m=>!scope.asset||m.id===scope.asset).flatMap(m=>m.devices.filter(d=>!scope.device||d.id===scope.device).flatMap(d=>d.tags.map(p=>p.id)))));
}
export function workspaceDashboard(title:string,scope:string,choices:ChartChoice[]){
 if(!title.trim()||choices.length<1||choices.length>24)throw new Error('Chọn từ 1 đến 24 point và nhập tên dashboard.');
 const colors=['#2dd4bf','#a78bfa','#38bdf8','#fb923c'];
 const summaries=choices.slice(0,4).map((c,i)=>{
  const p=pointDashboard({...c.point,name:c.point.device_name?`${c.point.device_name} · ${c.point.name}`:c.point.name},title,'stat',0,100).panels[0];
  return {...p,id:i+1,gridPos:{x:i*(24/Math.min(4,choices.length)),y:0,w:24/Math.min(4,choices.length),h:4},fieldConfig:{...p.fieldConfig,defaults:{...p.fieldConfig.defaults,...mappings(c.point),color:{mode:'fixed',fixedColor:colors[i]}}},options:{...p.options,colorMode:'background',graphMode:'none',textMode:'value_and_name'}};
 });
 const charts=choices.map((c,i)=>{
  const numeric=!['bool','boolean','string'].includes(c.point.data_type);
  if(!numeric&&['timeseries','gauge','bargauge'].includes(c.kind))throw new Error('Point logic hoặc văn bản chỉ dùng chỉ số / bảng.');
  if(c.kind==='timeseries'&&c.point.store_history===false)throw new Error('Point chưa bật lưu lịch sử.');
  const p=pointDashboard({...c.point,name:c.point.device_name?`${c.point.device_name} · ${c.point.name}`:c.point.name},title,c.kind,c.min,c.max).panels[0];
  return {...p,id:i+10,gridPos:{x:(i%2)*12,y:4+Math.floor(i/2)*8,w:12,h:8},fieldConfig:{...p.fieldConfig,defaults:{...p.fieldConfig.defaults,...mappings(c.point),color:{mode:'fixed',fixedColor:colors[i%4]},custom:{drawStyle:'line',lineInterpolation:'smooth',lineWidth:2,fillOpacity:15,showPoints:'never',axisPlacement:'auto'}}}};
 });
 return {title:title.trim(),description:`RallyX · ${scope}`,tags:['RallyX','rallyx-workspace'],timezone:'browser',schemaVersion:39,editable:true,refresh:'5s',time:{from:'now-1h',to:'now'},panels:[...summaries,...charts]};
}
