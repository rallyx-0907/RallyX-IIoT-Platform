export type Point={id:string;name:string;data_type:string;unit?:string;semantic?:string;store_history?:boolean;device_id?:string;device_name?:string;key?:string};
export function pointDashboard(point:Point,title:string,type:string,min:number,max:number){
 if(!['stat','timeseries','gauge','bargauge','table'].includes(type))throw new Error('Kiểu biểu đồ không hợp lệ.');
 if((type==='gauge'||type==='bargauge')&&(!Number.isFinite(min)||!Number.isFinite(max)||max<=min))throw new Error('Giới hạn trên phải lớn hơn giới hạn dưới.');
 const ds={type:'grafana-postgresql-datasource',uid:'rallyx-reporting'};
 const filter=`tag_id = '${point.id.replaceAll("'","''")}'`;
 const numeric=!['bool','boolean','string'].includes(point.data_type);
 const sql=type==='timeseries'
  ?`SELECT $__timeGroupAlias(sampled_at,$__interval),avg(numeric_value) AS "Giá trị" FROM rallyx_reporting.samples WHERE $__timeFilter(sampled_at) AND ${filter} AND quality='GOOD' GROUP BY 1 ORDER BY 1 LIMIT 3000`
  :`SELECT ${numeric?'numeric_value':'value_text'} AS "Giá trị" FROM rallyx_reporting.current_values WHERE ${filter} AND quality='GOOD'`;
 function panel(id:number,kind:string,label:string,query:string,y:number,h:number){return {id,type:kind,title:label,datasource:ds,gridPos:{x:0,y,w:24,h},targets:[{refId:'A',datasource:ds,rawSql:query,rawQuery:true,format:kind==='timeseries'?'time_series':'table',editorMode:'code'}],fieldConfig:{defaults:{...(numeric&&kind!=='table'?{unit:point.unit?`suffix:${point.unit}`:'none',...(kind==='gauge'||kind==='bargauge'?{min,max}:{})}:{}),color:{mode:'palette-classic'},noValue:'Chưa có dữ liệu tốt'},overrides:[]},options:kind==='table'?{showHeader:true}:{reduceOptions:{calcs:['lastNotNull'],fields:'',values:false},colorMode:'value',graphMode:'none',legend:{displayMode:'list',placement:'bottom'},tooltip:{mode:'single'}}};}
 return {title,description:`RallyX point: ${point.id}`,tags:['RallyX','rallyx-point'],timezone:'browser',schemaVersion:39,editable:true,refresh:'5s',time:{from:'now-1h',to:'now'},panels:[panel(1,type,point.name,sql,0,11),panel(2,'table','Chất lượng và thời điểm cập nhật',`SELECT value_text AS "Giá trị",unit AS "Đơn vị",quality AS "Chất lượng",sampled_at AS "Thời điểm" FROM rallyx_reporting.current_values WHERE ${filter}`,11,4)]};
}
