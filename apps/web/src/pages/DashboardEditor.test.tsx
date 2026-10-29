import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {DashboardEditor} from './DashboardEditor';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const initial={uid:'board',title:'Test',version:7,custom:'preserved',panels:[{id:1,type:'stat',title:'Pressure',gridPos:{x:0,y:0,w:8,h:6},targets:[{rawSql:'unchanged'}]}]};
it('saves resized layout with optimistic version and retains custom panel fields',async()=>{
 const api=vi.fn(async(_path:string,options?:RequestInit)=>options?{uid:'board'}:{dashboard:initial});
 render(<DashboardEditor uid="board" points={[]} devices={[]} api={api as never} onClose={()=>{}} onSaved={()=>{}}/>);
 const handle=await screen.findByRole('button',{name:'Đổi kích thước ô 1'});fireEvent.keyDown(handle,{key:'ArrowRight'});
 fireEvent.click(screen.getByRole('button',{name:'Lưu dashboard'}));await screen.findByText('Đã lưu bố cục dashboard.');
 const saved=JSON.parse(api.mock.calls.find(call=>call[1]?.method==='POST')![1]!.body as string);
 expect(saved.overwrite).toBe(false);expect(saved.dashboard.version).toBe(7);expect(saved.dashboard.panels[0].gridPos.w).toBe(9);expect(saved.dashboard.panels[0].targets[0].rawSql).toBe('unchanged');expect(saved.dashboard.custom).toBe('preserved');
});
it('can undo deletion and keeps unsaved work after a version conflict',async()=>{
 const api=vi.fn(async(_path:string,options?:RequestInit)=>{if(options)throw new Error('Version conflict');return {dashboard:initial};});
 render(<DashboardEditor uid="board" points={[]} devices={[]} api={api as never} onClose={()=>{}} onSaved={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Di chuyển ô 1'}));fireEvent.click(screen.getByRole('button',{name:'Xóa ô'}));
 expect(screen.queryByRole('button',{name:'Di chuyển ô 1'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Hoàn tác'}));
 expect(screen.getByRole('button',{name:'Di chuyển ô 1'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Lưu dashboard'}));
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Version conflict'));expect((screen.getByRole('button',{name:'Lưu dashboard'}) as HTMLButtonElement).disabled).toBe(false);
});
