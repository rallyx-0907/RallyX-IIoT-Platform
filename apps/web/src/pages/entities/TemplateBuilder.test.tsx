import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {TemplateBuilder} from './TemplateBuilder';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('previews an entity-bound metric without saving then publishes and assigns explicitly',async()=>{
 const fetcher=vi.fn(async(url:RequestInfo|URL,options?:RequestInit)=>{const path=String(url);let body:unknown=[];
 if(path.includes('available-metrics'))body=[{key:'load',name:'Load',data_type:'number',unit:'A',precision:0,history:true}];
 else if(path.includes('dashboard-runtime')){const doc=JSON.parse(String(options?.body)).document;body={entity:{id:'a',name:'Machine A'},assignment:{template_id:'',template_version:0,revision:0},document:doc,widgets:doc.pages[0].widgets.map((w:{id:string;type:string;title:string})=>({...w,value:42,unit:'A',quality:'GOOD',good:1,expected:1,series:[],diagnostics:[]})),from:new Date(Date.now()-3600000).toISOString(),to:new Date().toISOString()};}
 else if(path.endsWith('/entity-dashboard-templates')&&options?.method==='POST')body={id:'saved-template',revision:1,published_version:1,name:'Reusable',document:JSON.parse(String(options.body)).document};
 else if(path.includes('/entities?'))body=[{id:'a',name:'Machine A'}];
 return new Response(JSON.stringify(body));});vi.stubGlobal('fetch',fetcher);const applied=vi.fn();render(<TemplateBuilder entityID="a" onClose={()=>{}} onApplied={applied}/>);
 fireEvent.change(screen.getByLabelText('Tên template'),{target:{value:'Reusable'}});
 fireEvent.click(screen.getByRole('button',{name:'Chỉ số'}));await screen.findByRole('option',{name:/Load/});fireEvent.change(screen.getByLabelText('Đại lượng'),{target:{value:'load'}});
 expect((screen.getByRole('button',{name:'Áp dụng'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Xem trước'}));await screen.findByText('42');
 expect(fetcher.mock.calls.some(c=>String(c[0]).endsWith('/entity-dashboard-templates')&&c[1]?.method==='POST')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Áp dụng'}));await waitFor(()=>expect(applied).toHaveBeenCalled());
 const saved=JSON.parse(String(fetcher.mock.calls.find(c=>String(c[0]).endsWith('/entity-dashboard-templates')&&c[1]?.method==='POST')?.[1]?.body));expect(saved.entity_id).toBe('a');expect(saved.document.pages[0].widgets[0].binding).toEqual({scope:'current',metric:'load'});
});
