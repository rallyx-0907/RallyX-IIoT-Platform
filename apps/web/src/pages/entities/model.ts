export type MetadataField={key:string;name:string;type:'string'|'number'|'boolean';required:boolean};
export type EntityType={key:string;name:string;fields:MetadataField[];revision:number};
export type Entity={id:string;name:string;code:string;type_key:string;type_name?:string;parent_id:string|null;metadata:Record<string,unknown>;enabled:boolean;archived:boolean;revision:number;profile_id:string|null;profile_version:number|null;child_count:number;legacy_kind?:string;legacy_id?:string};
export type Metric={key:string;name:string;data_type:'number'|'boolean'|'string';unit:string;precision:number;history:boolean;min?:number;max?:number;entities?:number};
export type Profile={id:string;name:string;revision:number;metrics:Metric[];default_template_id?:string|null;default_template_version?:number|null};
export type Layout={x:number;y:number;w:number;h:number};
export function nextWidgetLayout(widgets:{layout:Layout}[],w:number,h:number):Layout {
 for(let y=0;y<=1000-h;y++)for(let x=0;x<=24-w;x++){
  if(widgets.every(({layout:p})=>x+w<=p.x||x>=p.x+p.w||y+h<=p.y||y>=p.y+p.h))return {x,y,w,h};
 }
 throw new Error('Dashboard đã hết không gian bố trí. Hãy thêm tab mới.');
}
export type Widget={id:string;type:string;title:string;binding:{scope:'current'|'parent'|'children'|'descendants';metric:string;type_key?:string};metrics?:string[];aggregation:string;layout:Layout;presentation:{unit?:string;precision:number;min?:number;max?:number;color?:string}};
export type DashboardDocument={schema_version:1;pages:{id:string;name:string;widgets:Widget[]}[]};
export type Template={id:string;name:string;revision:number;published_version:number;document:DashboardDocument};
export type Point={ts:string;value:number|boolean|string|null;quality:string};
export type Series={entity_id:string;name:string;metric:string;unit:string;quality:string;value:unknown;points:Point[]};
export type Child={id:string;name:string;type_key:string;type_name?:string;state:string;last_seen?:string;child_count:number};
export type Problem={id:number;entity_id:string;asset_name:string;rule_name:string;severity:string;activated_at:string;acknowledged_at:string|null};
export type WidgetData={id:string;type:string;title:string;value:unknown;unit:string;quality:string;expected:number;good:number;updated_at?:string;series:Series[];diagnostics:string[];rows?:Child[]|Problem[];states?:Record<string,number>};
export type Runtime={entity:Entity;breadcrumb:Entity[];assignment:{template_id:string;template_version:number;revision:number};document:DashboardDocument;widgets:WidgetData[];overview:{state:string;last_seen?:string;children:Child[];states:Record<string,number>;child_total:number;alarms:Problem[]};generated_at:string;from:string;to:string};
export type Source={id:string;key:string;name:string;datatype:string;data_type:string;unit:string;device_id:string;device_name:string;asset_name:string;store_history:boolean};
export type Binding={metric_key:string;tag_id:string;tag_name:string;unit:string;device_name:string};
export const widgetNames:Record<string,string>={'value-card':'Chỉ số','status-card':'Trạng thái',gauge:'Đồng hồ',progress:'Thanh mức',timeseries:'Xu hướng nhiều tín hiệu',bar:'So sánh giá trị',distribution:'Phân bố trạng thái','entity-table':'Danh sách thực thể con','alarm-table':'Cảnh báo trong phạm vi','state-timeline':'Lịch sử trạng thái'};
export const stateNames:Record<string,string>={RUNNING:'Đang chạy',STOPPED:'Đã dừng',FAULT:'Lỗi',ONLINE:'Có dữ liệu',UNKNOWN:'Chưa xác định',DISABLED:'Đã tắt',GOOD:'Tốt',PARTIAL:'Thiếu nguồn',STALE:'Dữ liệu cũ',UNMAPPED:'Chưa map tín hiệu',NO_DATA:'Chưa có dữ liệu tốt',INCOMPATIBLE:'Không tương thích',AMBIGUOUS:'Cần chọn tổng hợp',BAD:'Dữ liệu lỗi',LIMIT:'Vượt giới hạn'};
export const stateColors:Record<string,string>={RUNNING:'#2dd4bf',STOPPED:'#fbbf24',FAULT:'#fb7185',ONLINE:'#38bdf8',UNKNOWN:'#8193aa',DISABLED:'#59687c'};
export function rememberEntity(userID:string,id:string){try{localStorage.setItem(`rallyx.entity.last.${userID}`,id);}catch{}const url=new URL(location.href);url.searchParams.delete('dashboard');url.searchParams.delete('simpleBoard');url.searchParams.set('entity',id);url.hash='dashboards';history.replaceState(null,'',url.pathname+url.search+url.hash);}
export function lastEntity(userID:string){const linked=new URLSearchParams(location.search).get('entity');if(linked)return linked;try{return localStorage.getItem(`rallyx.entity.last.${userID}`)||'';}catch{return '';}}
export function entityInput(e:Entity){return {name:e.name,code:e.code||'',type_key:e.type_key,parent_id:e.parent_id||'',metadata:e.metadata||{},enabled:e.enabled,archived:e.archived,revision:e.revision,profile_id:e.profile_id||'',profile_version:e.profile_version||0};}
export function newDocument():DashboardDocument{return {schema_version:1,pages:[{id:'main',name:'Tổng quan',widgets:[]}]};}
