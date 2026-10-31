import aliases from './unitAliases.json';
import type {Metric,Source} from './model';
export function canonicalUnit(value:string){const trimmed=value.trim();return (aliases as Record<string,string>)[trimmed.toLowerCase()]||trimmed;}
const typeNames:Record<string,string>={number:'Số',boolean:'Logic',string:'Văn bản'};
export function sourceIssue(source:Source,metric:Metric){
 if(source.datatype!==metric.data_type)return `Kiểu ${typeNames[source.datatype]||source.datatype}, cần ${typeNames[metric.data_type]}`;
 if(canonicalUnit(source.unit)!==canonicalUnit(metric.unit))return `Khác đơn vị: tín hiệu = ${source.unit||'không có'}, cần ${metric.unit||'không có'}`;
 if(metric.history&&!source.store_history)return 'Chưa bật lưu lịch sử — bật tại Cấu hình tín hiệu';
 return '';
}
export function suggestSources(metrics:Metric[],sources:Source[],current:Record<string,string>={}){
 const suggested:Record<string,string>={};
 const name=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 for(const metric of metrics){
  if(current[metric.key])continue;
  const compatible=sources.filter(s=>!sourceIssue(s,metric));
  const byKey=compatible.filter(s=>s.key===(metric.source_key||metric.key)),candidates=byKey.length?byKey:compatible.filter(s=>name(s.name)===name(metric.name));
  if(candidates.length===1)suggested[metric.key]=candidates[0].id;
 }
 return suggested;
}
