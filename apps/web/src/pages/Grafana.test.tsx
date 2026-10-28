import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Grafana} from './Grafana';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('creates a saved dashboard for the chosen point',async()=>{
 const fetcher=vi.fn(async(url:RequestInfo|URL,options?:RequestInit)=>{
  if(options?.method==='POST')return new Response(JSON.stringify({uid:'new-point',url:'/grafana/d/new-point/test'}));
  const path=String(url);
  const body=path.endsWith('/status')?{available:true,can_edit:true}:path.endsWith('/devices')?[{id:'dev1',name:'Motor'}]:path.endsWith('/tags')?[{id:'tag1',device_id:'dev1',name:'Temperature',key:'temp',data_type:'float64',unit:'°C',store_history:true}]:[];
  return new Response(JSON.stringify(body));
 });vi.stubGlobal('fetch',fetcher);render(<Grafana/>);
 fireEvent.click(await screen.findByRole('button',{name:'Tạo dashboard cho một point'}));
 await screen.findByRole('option',{name:'Motor'});
 fireEvent.change(screen.getByLabelText('1. Thiết bị'),{target:{value:'dev1'}});
 fireEvent.change(screen.getByLabelText('2. Điểm dữ liệu'),{target:{value:'tag1'}});
 fireEvent.click(screen.getByRole('button',{name:'Tạo và mở dashboard'}));
 await waitFor(()=>expect(screen.getByTitle('Grafana dashboards').getAttribute('src')).toBe('/grafana/d/new-point?kiosk'));
 const saved=JSON.parse(String(fetcher.mock.calls.find(call=>call[1]?.method==='POST')?.[1]?.body));
 expect(saved.dashboard.panels[0].targets[0].rawSql).toContain("tag_id = 'tag1'");expect(saved.overwrite).toBe(false);
});
it('keeps the sample closed and hides creation for viewers',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url)=>new Response(JSON.stringify(String(url).endsWith('/status')?{available:true,can_edit:false}:[]))));
 render(<Grafana/>);await screen.findByText('Dashboard của bạn');expect(screen.queryByTitle('Grafana dashboards')).toBeNull();expect(screen.queryByRole('button',{name:'Tạo dashboard cho một point'})).toBeNull();
});
it('keeps saved dashboards usable when device loading fails',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url)=>{
  const path=String(url);if(path.endsWith('/devices'))throw new Error('offline');
  return new Response(JSON.stringify(path.endsWith('/status')?{available:true,can_edit:true}:path.includes('search?')?[{uid:'saved',title:'Saved pressure',url:'/d/saved/pressure'}]:[]));
 }));render(<Grafana/>);fireEvent.click(await screen.findByRole('button',{name:'Saved pressure'}));
 expect(screen.getByTitle('Grafana dashboards').getAttribute('src')).toBe('/grafana/d/saved?kiosk');
});
