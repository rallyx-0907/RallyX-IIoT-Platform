import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Grafana} from './Grafana';
afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();history.replaceState(null,'','/');});
it('creates a saved dashboard for the chosen point',async()=>{
 const fetcher=vi.fn(async(url:RequestInfo|URL,options?:RequestInit)=>{
  if(options?.method==='POST')return new Response(JSON.stringify({uid:'new-point',url:'/grafana/d/new-point/test'}));
  const path=String(url);
  const body=path.endsWith('/status')?{available:true,can_edit:true}:path.endsWith('/devices')?[{id:'dev1',name:'Motor'}]:path.endsWith('/tags')?[{id:'tag1',device_id:'dev1',name:'Temperature',key:'temp',data_type:'float64',unit:'°C',store_history:true}]:[];
  return new Response(JSON.stringify(body));
 });vi.stubGlobal('fetch',fetcher);render(<Grafana/>);
 fireEvent.click(await screen.findByRole('button',{name:'Tạo dashboard'}));
 await screen.findByRole('option',{name:'Motor'});
 fireEvent.change(screen.getByLabelText('Thiết bị'),{target:{value:'dev1'}});
 fireEvent.click(screen.getByRole('checkbox',{name:/Temperature/}));
 fireEvent.change(screen.getByLabelText('Tên dashboard'),{target:{value:'Temperature dashboard'}});
 fireEvent.click(screen.getByRole('button',{name:'Xem trước'}));
 fireEvent.click(screen.getByRole('button',{name:'Áp dụng'})); await waitFor(()=>expect(screen.getByTitle('Grafana dashboards').getAttribute('src')).toBe('/grafana/d/new-point?kiosk&theme=dark'));
 const saved=JSON.parse(String(fetcher.mock.calls.find(call=>call[1]?.method==='POST')?.[1]?.body));
 expect(saved.dashboard.panels[0].targets[0].rawSql).toContain("tag_id = 'tag1'");expect(saved.overwrite).toBe(false);
});
it('keeps the sample closed and hides creation for viewers',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url)=>new Response(JSON.stringify(String(url).endsWith('/status')?{available:true,can_edit:false}:[]))));
 render(<Grafana/>);await screen.findByLabelText('Dashboard đã lưu');expect(screen.queryByTitle('Grafana dashboards')).toBeNull();expect(screen.queryByRole('button',{name:'Tạo dashboard'})).toBeNull();
});
it('keeps saved dashboards usable when device loading fails',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url)=>{
  const path=String(url);if(path.endsWith('/devices'))throw new Error('offline');
  return new Response(JSON.stringify(path.endsWith('/status')?{available:true,can_edit:true}:path.includes('search?')?[{uid:'saved',title:'Saved pressure',url:'/d/saved/pressure'}]:[]));
 }));render(<Grafana/>);fireEvent.click(await screen.findByRole('button',{name:'Saved pressure'}));
 expect(screen.getByTitle('Grafana dashboards').getAttribute('src')).toBe('/grafana/d/saved?kiosk&theme=dark');
});

it('reopens a saved dashboard after unmount and remount without losing its identity',async()=>{
 localStorage.clear();history.replaceState(null,'','/#dashboards');
 vi.stubGlobal('fetch',vi.fn(async(url)=>new Response(JSON.stringify(String(url).endsWith('/status')?{available:true,can_edit:true}:String(url).includes('search?')?[{uid:'first',title:'First board',url:'/d/first/test'},{uid:'persisted',title:'Saved dashboard',url:'/d/persisted/test'}]:[]))));
 const first=render(<Grafana userID="engineer"/>);fireEvent.click(await screen.findByRole('button',{name:'Saved dashboard'}));first.unmount();
 history.replaceState(null,'','/#dashboards');render(<Grafana userID="engineer"/>);
 expect((await screen.findByTitle('Grafana dashboards')).getAttribute('src')).toContain('/persisted?kiosk');
});
it('lists the existing simple dashboards beside Grafana dashboards',async()=>{
 history.replaceState(null,'','/#dashboards');localStorage.clear();
 vi.stubGlobal('fetch',vi.fn(async(url)=>{const path=String(url);return new Response(JSON.stringify(path.endsWith('/status')?{available:true,can_edit:true}:path.endsWith('/dashboard/boards')?[{id:'old-board',name:'Modbus test bench'}]:[]));}));
 render(<Grafana userID="engineer"/>);expect(await screen.findByRole('button',{name:'Modbus test bench · Bảng theo dõi đơn giản'})).toBeTruthy();
});
it('gives an explicit dashboard link priority over the last selected board',async()=>{
 localStorage.setItem('rallyx.dashboard.last.engineer',JSON.stringify({kind:'grafana',id:'previous'}));history.replaceState(null,'','/?dashboard=linked#dashboards');
 vi.stubGlobal('fetch',vi.fn(async(url)=>new Response(JSON.stringify(String(url).endsWith('/status')?{available:true,can_edit:true}:String(url).includes('search?')?[{uid:'previous',title:'Previous'},{uid:'linked',title:'Linked'}]:[]))));
 render(<Grafana userID="engineer"/>);expect((await screen.findByTitle('Grafana dashboards')).getAttribute('src')).toContain('/linked?kiosk');
});
it('does not show an empty-dashboard message when listing failed',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url)=>{if(String(url).includes('search?'))throw new Error('offline');return new Response(JSON.stringify(String(url).endsWith('/status')?{available:true,can_edit:true}:[]));}));
 render(<Grafana/>);await screen.findByRole('alert');expect(screen.queryByText(/Chưa có dashboard riêng/)).toBeNull();
});
it('does not reuse another users last dashboard selection',async()=>{
 localStorage.setItem('rallyx.dashboard.last.other',JSON.stringify({kind:'grafana',id:'second'}));history.replaceState(null,'','/#dashboards');
 vi.stubGlobal('fetch',vi.fn(async(url)=>new Response(JSON.stringify(String(url).endsWith('/status')?{available:true,can_edit:false}:String(url).includes('search?')?[{uid:'first',title:'First'},{uid:'second',title:'Second'}]:[]))));
 render(<Grafana userID="viewer"/>);expect((await screen.findByTitle('Grafana dashboards')).getAttribute('src')).toContain('/first?kiosk');
});
it('still discovers existing simple boards when the Grafana status endpoint fails',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url)=>{const path=String(url);if(path.endsWith('/grafana/status'))throw new Error('status unavailable');return new Response(JSON.stringify(path.endsWith('/dashboard/boards')?[{id:'safe',name:'Saved old board'}]:[]));}));
 render(<Grafana/>);expect(await screen.findByRole('button',{name:'Saved old board · Bảng theo dõi đơn giản'})).toBeTruthy();
});
it('opens an existing dashboard before a slow point catalog finishes',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url)=>{const path=String(url);if(path.endsWith('/tags'))return new Promise<Response>(()=>{});return new Response(JSON.stringify(path.endsWith('/status')?{available:true,can_edit:true}:path.includes('search?')?[{uid:'kept',title:'Saved'}]:[]));}));
 render(<Grafana/>);expect((await screen.findByTitle('Grafana dashboards')).getAttribute('src')).toContain('/kept?kiosk');
});
it('loads a remembered saved dashboard by UID when search has not indexed it yet',async()=>{
 localStorage.setItem('rallyx.dashboard.last.engineer',JSON.stringify({kind:'grafana',id:'new-saved'}));history.replaceState(null,'','/#dashboards');
 vi.stubGlobal('fetch',vi.fn(async(url)=>{const path=String(url);return new Response(JSON.stringify(path.endsWith('/status')?{available:true,can_edit:true}:path.includes('search?')?[{uid:'older',title:'Older'}]:path.endsWith('/dashboards/uid/new-saved')?{dashboard:{uid:'new-saved',title:'Just saved'}}:[]));}));
 render(<Grafana userID="engineer"/>);expect((await screen.findByTitle('Grafana dashboards')).getAttribute('src')).toContain('/new-saved?kiosk');expect(screen.getByRole('button',{name:'Just saved'})).toBeTruthy();
});
