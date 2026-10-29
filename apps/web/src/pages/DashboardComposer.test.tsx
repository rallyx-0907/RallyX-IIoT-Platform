import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {DashboardComposer} from './DashboardComposer';
import type {workspaceDashboard} from './dashboardWorkspace';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('previews multiple devices without writes and only applies explicitly',async()=>{
 const fetcher=vi.fn(async(_url:RequestInfo|URL,_options?:RequestInit)=>new Response('[]'));vi.stubGlobal('fetch',fetcher);
 const apply=vi.fn(async(_doc:ReturnType<typeof workspaceDashboard>)=>{});render(<DashboardComposer points={[{id:'p1',device_id:'d1',name:'Temperature',data_type:'float64'},{id:'p2',device_id:'d2',name:'Run',data_type:'bool'}]} devices={[{id:'d1',name:'Sensor'},{id:'d2',name:'Motor'}]} onApply={apply} onClose={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('Tên dashboard'),{target:{value:'Factory view'}});
 fireEvent.click(screen.getByRole('checkbox',{name:/Temperature/}));fireEvent.click(screen.getByRole('checkbox',{name:/Run/}));
 fireEvent.click(screen.getByRole('button',{name:'Xem trước'}));
 expect(screen.getByText('Xem trước dashboard')).toBeTruthy();expect(apply).not.toHaveBeenCalled();
 expect(fetcher.mock.calls.every(call=>!call[1]?.method||call[1].method==='GET')).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Áp dụng'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 expect(apply.mock.calls[0][0].panels).toHaveLength(4);
});
it('cancels configuration without saving',()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('[]')));const close=vi.fn(),apply=vi.fn();render(<DashboardComposer points={[]} devices={[]} onClose={close} onApply={apply}/>);
 fireEvent.click(screen.getByRole('button',{name:'Hủy'}));expect(close).toHaveBeenCalledOnce();expect(apply).not.toHaveBeenCalled();
});
