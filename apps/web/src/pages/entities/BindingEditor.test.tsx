import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {BindingEditor} from './BindingEditor';
import type {Entity} from './model';
const entity={id:'machine',name:'Máy',revision:1,enabled:true,archived:false,metadata:{},type_key:'group'} as Entity;
const metric={key:'power',name:'Công suất',data_type:'number',unit:'kW',history:true,precision:1};
const source={id:'a',key:'power',name:'Công suất',datatype:'number',data_type:'float64',unit:' kw ',store_history:true,device_id:'d',device_name:'Đồng hồ'};
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
it('explains incompatible sources and links to their device signal configuration',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL)=>new Response(JSON.stringify(String(url).endsWith('/metrics')?[metric]:String(url).includes('entity-sources')?[{...source,unit:'A'}]:[]))));
 render(<BindingEditor entity={entity} onClose={()=>{}} onSaved={()=>{}}/>);
 const option=await screen.findByRole('option',{name:/Khác đơn vị/});expect((option as HTMLOptionElement).disabled).toBe(true);
 const link=screen.getByRole('link',{name:/Sửa Công suất/});expect(link.getAttribute('href')).toContain('device_id=d&signal=power#configuration');
});
it('checks all source pages before suggesting and never saves an ambiguous match',async()=>{
 const first=[source,...Array.from({length:199},(_,i)=>({...source,id:'other'+i,key:'other'+i,name:'Khác '+i}))];
 const fetcher=vi.fn(async(url:RequestInfo|URL)=>{const path=String(url);return new Response(JSON.stringify(path.endsWith('/metrics')?[metric]:path.includes('entity-sources')?path.includes('limit=200')?(path.includes('offset=200')?[{...source,id:'duplicate'}]:first):[source]:[]))});
 vi.stubGlobal('fetch',fetcher);render(<BindingEditor entity={entity} onClose={()=>{}} onSaved={()=>{}}/>);
 await screen.findByRole('option',{name:/Đồng hồ · Công suất/});fireEvent.click(screen.getByRole('button',{name:'Tự gợi ý'}));
 await screen.findByText(/Chưa có gợi ý duy nhất/);await waitFor(()=>expect(fetcher.mock.calls.some(([p])=>String(p).includes('offset=200'))).toBe(true));
 expect((screen.getByLabelText('Nguồn dữ liệu cho Công suất') as HTMLSelectElement).value).toBe('');
});
