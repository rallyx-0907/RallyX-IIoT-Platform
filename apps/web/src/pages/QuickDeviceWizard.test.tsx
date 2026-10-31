import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QuickDeviceWizard} from './QuickDeviceWizard';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('creates a device in three screens without asking for semantic keys and writes only on Finish',async()=>{
 const definition={key:'power',name:'Công suất',data_type:'float64',unit:'kW',store_history:true};
 const fetcher=vi.fn(async(url:RequestInfo|URL,options?:RequestInit)=>{
  const path=String(url);let body:unknown=[];
  if(path.endsWith('/connections'))body=[{id:'c',name:'Mô phỏng có sẵn',protocol:'simulator',site_id:'s',protocol_config:{}}];
  if(path.endsWith('/templates'))body=[{id:'t',name:'Đồng hồ thử',protocol:'simulator',tag_definitions:[definition]}];
  if(path.endsWith('/assets/tree'))body=[{id:'s',name:'Nhà máy',areas:[{id:'a',name:'Khu vực',assets:[{id:'m',name:'Máy'}]}]}];
  if(path.endsWith('/onboarding/preview'))body={connected:true,elapsed_ms:5,readings:[{key:'power',decoded:12,scaled:12,quality:'GOOD'}]};
  if(path.endsWith('/onboarding/complete'))body={entity_id:'new-device',mapped:1,total:1};
  return new Response(JSON.stringify(body));
 });vi.stubGlobal('fetch',fetcher);const done=vi.fn();render(<QuickDeviceWizard onClose={()=>{}} onCreated={done}/>);
 fireEvent.change(screen.getByLabelText('Giao thức'),{target:{value:'simulator'}});await screen.findByRole('option',{name:'Mô phỏng có sẵn'});fireEvent.change(screen.getByLabelText('Kết nối'),{target:{value:'c'}});fireEvent.click(screen.getByRole('button',{name:'Tiếp tục'}));
 fireEvent.click(await screen.findByRole('button',{name:/Đồng hồ thử/}));await screen.findByText('12');fireEvent.click(screen.getByRole('button',{name:'Tiếp tục'}));
 fireEvent.change(screen.getByLabelText('Tên thiết bị'),{target:{value:'Máy mới'}});
 expect(fetcher.mock.calls.some(([,o])=>o?.method==='POST'&&!String(o.body).includes('operation'))).toBe(false);
 expect(screen.queryByLabelText('Metric key')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Hoàn tất'}));await waitFor(()=>expect(done).toHaveBeenCalledWith('new-device',{mapped:1,total:1}));
 expect(fetcher.mock.calls.filter(([p])=>String(p).endsWith('/onboarding/complete'))).toHaveLength(1);
},15000);
