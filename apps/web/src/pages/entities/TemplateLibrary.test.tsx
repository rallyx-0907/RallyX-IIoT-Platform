import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {TemplateLibrary} from './TemplateBuilder';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('opens a template clone as an unsaved preview without persisting on cancel',async()=>{
 const template={id:'shared',name:'Điện năng',revision:3,published_version:2,document:{schema_version:1,pages:[{id:'main',name:'Chính',widgets:[]}]}};
 const fetcher=vi.fn(async(url:RequestInfo|URL,options?:RequestInit)=>new Response(JSON.stringify(String(url).endsWith('/entity-dashboard-templates')&&!options?.method?[template]:String(url).endsWith('/entity-dashboard-templates/shared')?template:options?.method==='POST'?{...template,id:'copy',...JSON.parse(String(options.body))}:[])));vi.stubGlobal('fetch',fetcher);
 render(<TemplateLibrary entityID="a" onClose={()=>{}} onApplied={()=>{}}/>);
 fireEvent.click(await screen.findByText('Điện năng'));fireEvent.click(await screen.findByRole('button',{name:'Nhân bản mẫu dashboard'}));
 await waitFor(()=>expect((screen.getByLabelText('Tên mẫu dashboard') as HTMLInputElement).value).toBe('Điện năng (bản sao)'));
 fireEvent.click(screen.getByRole('button',{name:'Đóng'}));
 expect(fetcher.mock.calls.some(([,o])=>o?.method==='POST'||o?.method==='PUT')).toBe(false);
});
