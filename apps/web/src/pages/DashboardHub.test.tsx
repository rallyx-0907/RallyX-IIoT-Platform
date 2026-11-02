import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {DashboardHub} from './DashboardHub';

vi.mock('./simulation/SimulationEditor',()=>({SimulationEditor:({dashboard,onChange,mode}:any)=><div><span>{mode}</span><button onClick={()=>onChange({...dashboard,name:dashboard.name+'*'})}>Sửa sơ đồ</button></div>}));
const admin={id:'a',username:'a',role:'admin' as const,must_change_password:false};
const board={id:'sim-1',name:'Sơ đồ máy',type:'simulation',revision:1,canvas:{width:1200,height:800,gridSize:10,snapToGrid:true},layout:[]};
afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();history.replaceState(null,'','/');});
function fixture(role:'admin'|'viewer'='admin'){
 const fetcher=vi.fn(async(_url:RequestInfo|URL,options?:RequestInit)=>new Response(JSON.stringify(options?.method==='POST'?board:options?.method==='PATCH'?{...board,...JSON.parse(String(options.body)),revision:2}:String(_url).endsWith('/sim-1')?board:[board])));
 vi.stubGlobal('fetch',fetcher);
 render(<DashboardHub user={{...admin,role}} tags={[]} connection="live" standard={<p>Phân tích hiện có</p>}/>);return fetcher;
}
it('lists dashboard types alongside the preserved standard workspace',async()=>{
 fixture();expect(await screen.findByRole('button',{name:'Sơ đồ máy · Sơ đồ thiết bị'})).toBeTruthy();expect(screen.getByText('Phân tích hiện có')).toBeTruthy();
});
it('opens a saved simulation in live mode and keeps a direct link',async()=>{
 fixture();fireEvent.click(await screen.findByRole('button',{name:'Sơ đồ máy · Sơ đồ thiết bị'}));expect(await screen.findByText('live')).toBeTruthy();expect(new URLSearchParams(location.search).get('simulation')).toBe('sim-1');
});
it('restores saved simulation from a new-tab URL',async()=>{
 history.replaceState(null,'','/?simulation=sim-1#dashboards');fixture();expect(await screen.findByText('live')).toBeTruthy();
});
it('creates a simulation through its own dialog',async()=>{
 const fetcher=fixture();fireEvent.click(screen.getByRole('button',{name:'Tạo dashboard'}));fireEvent.change(screen.getByLabelText('Tên dashboard'),{target:{value:'Sơ đồ máy'}});fireEvent.click(screen.getByRole('button',{name:'Tạo sơ đồ'}));
 await waitFor(()=>expect(fetcher.mock.calls.some(c=>c[1]?.method==='POST'&&JSON.parse(String(c[1].body)).type==='simulation')).toBe(true));
});
it('shows dirty edits and saves with the current revision',async()=>{
 const fetcher=fixture();fireEvent.click(await screen.findByRole('button',{name:'Sơ đồ máy · Sơ đồ thiết bị'}));await screen.findByText('live');fireEvent.click(screen.getByRole('button',{name:'Thiết kế'}));fireEvent.click(await screen.findByRole('button',{name:'Sửa sơ đồ'}));expect(screen.getByText('Chưa lưu thay đổi')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Lưu dashboard'}));
 await waitFor(()=>expect(fetcher.mock.calls.some(c=>c[1]?.method==='PATCH'&&JSON.parse(String(c[1].body)).revision===1)).toBe(true));await screen.findByText('Đã lưu');
});
it('keeps viewers in live mode without editing or creation actions',async()=>{
 history.replaceState(null,'','/?simulation=sim-1#dashboards');fixture('viewer');await screen.findByText('live');expect(screen.queryByRole('button',{name:'Thiết kế'})).toBeNull();expect(screen.queryByRole('button',{name:'Tạo dashboard'})).toBeNull();
});
it('guards unsaved workspace navigation',async()=>{
 fixture();fireEvent.click(await screen.findByRole('button',{name:'Sơ đồ máy · Sơ đồ thiết bị'}));await screen.findByText('live');fireEvent.click(screen.getByRole('button',{name:'Sửa sơ đồ'}));
 vi.spyOn(window,'confirm').mockReturnValue(false);const event=new Event('rallyx:before-navigate',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);vi.restoreAllMocks();
});
it('preserves edits made while a save response is in flight',async()=>{
 let complete!:(response:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(async(_url:RequestInfo|URL,options?:RequestInit)=>options?.method==='PATCH'?new Promise<Response>(resolve=>{complete=resolve;}):new Response(JSON.stringify(String(_url).endsWith('/sim-1')?board:[board]))));
 history.replaceState(null,'','/?simulation=sim-1#dashboards');render(<DashboardHub user={admin} tags={[]} connection="live" standard={<p>Phân tích</p>}/>);await screen.findByText('live');fireEvent.click(screen.getByRole('button',{name:'Sửa sơ đồ'}));fireEvent.click(screen.getByRole('button',{name:'Lưu dashboard'}));fireEvent.click(screen.getByRole('button',{name:'Sửa sơ đồ'}));
 complete(new Response(JSON.stringify({...board,name:board.name+'*',revision:2})));
 await screen.findByRole('heading',{name:board.name+'**'});expect(screen.getByText('Chưa lưu thay đổi')).toBeTruthy();
});
