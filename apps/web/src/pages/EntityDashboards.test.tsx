import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {EntityDashboards} from './EntityDashboards';
afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();history.replaceState(null,'','/');});
const user={id:'engineer',username:'engineer',role:'admin' as const,must_change_password:false};
const entity=(id:string)=>({id,name:id==='a'?'Machine A':'Machine B',type_key:'group',revision:1,enabled:true,archived:false,metadata:{},child_count:0});
it('keeps engineering controls behind a single admin edit menu',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('[]')));render(<EntityDashboards user={user} offline={false}/>);
 expect(screen.queryByRole('button',{name:'Thư viện mẫu dashboard'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Chỉnh sửa'}));
 expect(await screen.findByRole('button',{name:'Thư viện mẫu dashboard'})).toBeTruthy();
});
it('remembers an entity opened by direct link for subsequent tabs',()=>{
 history.replaceState(null,'','/?entity=linked-machine#dashboards');
 vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(()=>{})));
 render(<EntityDashboards user={user} offline={false}/>);
 expect(localStorage.getItem('rallyx.entity.last.engineer')).toBe('linked-machine');
});
it('opens the same semantic template with each selected entity context',async()=>{
 const fetcher=vi.fn(async(url:RequestInfo|URL,options?:RequestInit)=>{const path=String(url);let body:unknown=[];
 if(path.endsWith('/entity-types'))body=[{key:'group',name:'Group',fields:[]}];
 else if(path.includes('/dashboard-runtime')){const id=path.includes('/a/')?'a':'b';body={entity:entity(id),assignment:{template_id:'shared',template_version:1,revision:1},breadcrumb:[entity(id)],document:{schema_version:1,pages:[{id:'main',name:'Overview',widgets:[{id:'load',type:'value-card',title:'Load',binding:{scope:'current',metric:'load'},aggregation:'last',layout:{x:0,y:0,w:8,h:5},presentation:{precision:0}}]}]},widgets:[{id:'load',type:'value-card',title:'Load',value:id==='a'?10:20,unit:'A',quality:'GOOD',good:1,expected:1,series:[],diagnostics:[]}],overview:{state:'UNKNOWN',children:[],states:{},child_total:0,alarms:[]},generated_at:new Date().toISOString()};}
 else if(path.includes('/entities?'))body=path.includes('parent=')&&!path.includes('parent=&')?[]:[entity('a'),entity('b')];
 return new Response(JSON.stringify(body));});vi.stubGlobal('fetch',fetcher);
 render(<EntityDashboards user={user} offline={false}/>);
 await screen.findByText('10');fireEvent.change(screen.getByLabelText('Nhà máy / vị trí'),{target:{value:'b'}});await screen.findByText('20');
 expect(fetcher.mock.calls.filter(c=>String(c[0]).includes('/dashboard-runtime')).every(c=>!JSON.parse(String(c[1]?.body)).document)).toBe(true);
 expect(localStorage.getItem('rallyx.entity.last.engineer')).toBe('b');
});
it('shows configuration separately and cancellation does not save a template',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('[]')));render(<EntityDashboards user={user} offline={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'Chỉnh sửa'}));fireEvent.click(await screen.findByRole('button',{name:'Thư viện mẫu dashboard'}));
 await screen.findByRole('dialog');fireEvent.click(screen.getByRole('button',{name:'Đóng'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
