import {bounded} from './adapters.mjs';
import {scaledValue} from './decode.mjs';

export function flattenFields(topic,payload){
 const fields=[];const walk=(value,path=[],depth=0)=>{
  if(depth>6||fields.length>=128)return;
  if(value!==null&&['number','boolean','string'].includes(typeof value)){
   if(typeof value==='number'&&!Number.isFinite(value))return;
   const leaf=path.at(-1);if(!leaf||['timestamp','device_id','quality','units'].includes(path[0])||path.some(k=>/[.\[\]]/.test(k)||['__proto__','constructor','prototype'].includes(k)))return;
   fields.push({topic,path:path.join('.'),key:'signal_'+fields.length,name:leaf,unit:typeof payload.units?.[leaf]==='string'?payload.units[leaf]:'',data_type:typeof value==='boolean'?'bool':typeof value==='number'?'float64':'string',value,...(typeof payload.device_id==='string'?{source_device_id:payload.device_id}:{})});return;
  }
  if(value&&typeof value==='object')for(const [key,child] of Object.entries(value).slice(0,128))walk(child,[...path,key],depth+1);
 };walk(payload);return fields;
}

async function listen(connection,seconds,signal){
 const {connect}=await import('mqtt');const config=connection.protocol_config||{};
 const client=connect(config.broker_url,{...connection.credentials,ca:config.ca,connectTimeout:connection.timeout_ms||2000,reconnectPeriod:0,clean:true});
 const fields=new Map();let timer;
 try{return await new Promise((resolve,reject)=>{
  const abort=()=>reject(new Error('Đã hủy nghe thử'));signal?.addEventListener('abort',abort,{once:true});
  const finish=()=>{signal?.removeEventListener('abort',abort);resolve({fields:[...fields.values()],elapsed_ms:seconds*1000,connected:true});};
  client.once('error',reject);client.once('connect',()=>client.subscribe((config.topic||'#').replaceAll('{device}','+'),{qos:1},err=>{if(err){reject(err);return}timer=setTimeout(finish,seconds*1000);}));
  client.on('message',(topic,bytes,packet)=>{if(bytes.length>262144||fields.size>=256)return;try{const payload=JSON.parse(bytes.toString());for(const field of flattenFields(topic,payload)){if(fields.size>=256)break;fields.set(topic+'\0'+field.path,{...field,retained:!!packet.retain,received_at:new Date().toISOString()});}}catch{/* Ignore non-JSON source frames. */}});
 });}finally{clearTimeout(timer);client.end(true);}
}

export async function diagnoseTransient(body,{createAdapter,signal}={}){
 const {connection,device={},operation}=body;
 if(!connection||!['modbus-tcp','modbus-rtu','mqtt','simulator'].includes(connection.protocol))throw new Error('Kết nối không hợp lệ');
 const started=Date.now();
 if(operation==='listen'){
  if(connection.protocol!=='mqtt'||!Number.isInteger(body.listen_seconds)||body.listen_seconds<10||body.listen_seconds>30)throw new Error('Thời gian nghe không hợp lệ');
  return bounded(()=>listen(connection,body.listen_seconds,signal),body.listen_seconds*1000+5000,()=>{},signal);
 }
 let tags=body.tags||[];
 if(operation==='scan'){
  if(!connection.protocol.startsWith('modbus-')||!Number.isInteger(body.scan_start)||!Number.isInteger(body.scan_count)||body.scan_start<0||body.scan_count<1||body.scan_count>50||body.scan_start+body.scan_count>65536)throw new Error('Dải quét không hợp lệ');
  tags=Array.from({length:body.scan_count},(_,i)=>({id:'scan-'+i,key:'signal_'+(i+1),name:'Tín hiệu '+(i+1),address:String(body.scan_start+i),function_code:3,data_type:'uint16',datatype:'number',unit:'',scale:1,offset:0,store_history:true}));
 }
 if(!['connection','scan','read'].includes(operation)||!Array.isArray(tags)||tags.length>64||(operation!=='connection'&&!tags.length))throw new Error('Yêu cầu đọc thử không hợp lệ');
 const adapter=await createAdapter(connection,{...device,tags},{signal});
 try{
  if(operation==='connection'){await adapter.test?.();return {connected:true,elapsed_ms:Date.now()-started};}
  const readings=[];
  // MQTT must decode fields from the same incoming frame, rather than consuming
  // one frame per selected key. Modbus reads each selection for individual errors.
  if(connection.protocol==='mqtt'){
   const result=await adapter.read(tags);for(const tag of tags){const row=result.readings.find(r=>r.tag_id===tag.id);readings.push(row?{...row,key:tag.key,scaled:scaledValue(row.decoded,tag),quality:'GOOD',definition:withoutId(tag)}:{tag_id:tag.id,key:tag.key,quality:'BAD',error:'Chưa có trường dữ liệu trong bản tin này',definition:withoutId(tag)});}
  }else for(const tag of tags){
   if(signal?.aborted)throw new Error('Đã hủy đọc thử');
   try{const result=await adapter.read([tag]);const row=result.readings[0];readings.push({...row,key:tag.key,scaled:scaledValue(row.decoded,tag),quality:'GOOD',definition:withoutId(tag)});}catch{readings.push({tag_id:tag.id,key:tag.key,quality:'BAD',error:'Không đọc được tín hiệu — kiểm tra địa chỉ và kiểu dữ liệu',definition:withoutId(tag)});}
  }
  return {connected:readings.some(r=>r.quality==='GOOD'),elapsed_ms:Date.now()-started,readings};
 }finally{await adapter.close();}
}
function withoutId(tag){const {id,datatype,...definition}=tag;return definition;}

export async function handleTransient(req,res,service){
 const controller=new AbortController();const cancel=()=>controller.abort();const onClose=()=>{if(!res.writableEnded)cancel()};res.once('close',onClose);service.diagnostics.add(cancel);
 const reply=(status,body)=>{if(!res.destroyed){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));}};
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2097152){reply(413,{error:'Request too large'});return}}
  const body=JSON.parse(raw),limit=body.operation==='listen'?(Number(body.listen_seconds)||10)*1000+5000:12000;
  const result=await bounded(()=>diagnoseTransient(body,{createAdapter:service.createAdapter,signal:controller.signal}),Math.min(35000,limit),cancel,controller.signal);reply(200,result);
 }catch{reply(502,{error:'Thiết bị không phản hồi — kiểm tra địa chỉ, mạng và mã thiết bị'});}finally{service.diagnostics.delete(cancel);res.removeListener('close',onClose);controller.abort();}
}
