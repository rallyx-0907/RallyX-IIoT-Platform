import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Tags } from './Tags';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const admin = { id: 'u', username: 'user', role: 'admin' as const, must_change_password: false };
function backend(invalid = false, fail = false, tagOverrides: Record<string, unknown> = {}) {
  const calls: {path:string; method:string; body:Record<string,unknown>}[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path:string, init:RequestInit = {}) => {
    const method = init.method || 'GET'; calls.push({path, method, body:init.body ? JSON.parse(String(init.body)) : {}});
    let data:unknown = path.endsWith('/tags') ? [{id:'t', device_id:'d', key:'speed', name:'Speed', data_type:'uint16', address:'0', scale:2, offset:1, sample_policy:'all', enabled:true, store_history:true, realtime_enabled:true, ...tagOverrides}] : path.endsWith('/devices') ? [{id:'d',name:'Drive',connection_id:'c',asset_id:'a'}] : path.endsWith('/connections') ? [{id:'c',protocol:'modbus-tcp'}] : [];
    if (method !== 'GET') data = path.endsWith('/preview') ? {total:1,rows:[{row:2,tag:{key:'speed'}}],errors:invalid ? [{row:2,column:'tag',message:'Duplicate key'}] : []} : path.endsWith('/test-read') ? {readings:[{tag_id:'t',raw:[4],decoded:4,scaled:9}]} : {imported:1};
    return new Response(JSON.stringify(fail && method === 'DELETE' ? {error:{message:'Archive denied'}} : data),{status:fail && method === 'DELETE' ? 422 : 200});
  })); return calls;
}
it('enables history by switching a current-state-only tag to every sample',async()=>{
  const calls=backend(false,false,{sample_policy:'none',store_history:false}); render(<Tags user={admin}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Edit Speed'}));
  fireEvent.click(screen.getByLabelText('Store history'));
  fireEvent.click(screen.getByRole('button',{name:'Save tag'})); await screen.findByText('Tag saved.');
  expect(calls.find(c=>c.method==='PATCH')?.body).toMatchObject({store_history:true,sample_policy:'all'});
});
it('clears an existing poll override when the field is blanked',async()=>{
  const calls=backend(false,false,{poll_interval_ms:1000}); render(<Tags user={admin}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Edit Speed'}));
  fireEvent.change(screen.getByLabelText('Poll override (ms)'),{target:{value:''}});
  fireEvent.click(screen.getByRole('button',{name:'Save tag'})); await screen.findByText('Tag saved.');
  expect(calls.find(c=>c.method==='PATCH')?.body).toHaveProperty('poll_interval_ms',null);
});
it('edits mapping without immutable identities and shows actual diagnostic stages', async () => {
  const calls=backend(); render(<Tags user={admin}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Edit Speed'}));
  fireEvent.change(screen.getByLabelText('Offset'),{target:{value:'3'}});
  fireEvent.click(screen.getByRole('button',{name:'Save tag'})); await screen.findByText('Tag saved.');
  const saved=calls.find(c=>c.method==='PATCH')!; expect(saved.body).toMatchObject({data_type:'uint16',offset:3}); expect(saved.body).not.toHaveProperty('device_id'); expect(saved.body).not.toHaveProperty('asset_id'); expect(saved.body).not.toHaveProperty('id');
  fireEvent.click(screen.getByRole('button',{name:'Test read Speed'})); await screen.findByText('Raw: [4]'); expect(screen.getByText('Decoded: 4')).toBeTruthy(); expect(screen.getByText('Scaled: 9')).toBeTruthy();
  expect(calls.find(c=>c.path.endsWith('/test-read'))?.body).toEqual({device_id:'d',tag_id:'t'});
});
it('invalidates CSV preview when source changes',async()=>{
  const calls=backend(); render(<Tags user={admin}/>); await screen.findByText('Speed');
  fireEvent.change(screen.getByLabelText('CSV content'),{target:{value:'device,tag,data_type\nd,new,uint16'}}); fireEvent.click(screen.getByRole('button',{name:'Preview CSV'}));
  await waitFor(()=>expect((screen.getByRole('button',{name:'Import CSV'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('CSV content'),{target:{value:'changed'}}); expect((screen.getByRole('button',{name:'Import CSV'}) as HTMLButtonElement).disabled).toBe(true); expect(calls.filter(c=>c.path.endsWith('/import'))).toHaveLength(0);
});
it('shows row and column validation errors and blocks import',async()=>{
  backend(true); render(<Tags user={admin}/>); fireEvent.change(screen.getByLabelText('CSV content'),{target:{value:'bad'}}); fireEvent.click(screen.getByRole('button',{name:'Preview CSV'})); await screen.findByText('Row 2, tag: Duplicate key'); expect((screen.getByRole('button',{name:'Import CSV'}) as HTMLButtonElement).disabled).toBe(true);
});
it('confirms archive, retains history and displays errors',async()=>{
  const calls=backend(false,true); render(<Tags user={admin}/>); fireEvent.click(await screen.findByRole('button',{name:'Archive Speed'})); expect(calls.some(c=>c.method==='DELETE')).toBe(false); fireEvent.click(screen.getByRole('button',{name:'Confirm archive'})); await screen.findByText('Archive denied'); expect(calls.find(c=>c.method==='DELETE')?.body).toEqual({confirm:true,history_policy:'retain'});
});
it.each(['viewer','operator'] as const)('allows %s to browse and export only',async role=>{const calls=backend(); render(<Tags user={{...admin,role}}/>); await screen.findByText('Speed'); expect(screen.getByRole('link',{name:'Export tags CSV'}).getAttribute('href')).toBe('/api/v1/config/tags.csv'); expect(screen.queryByRole('button',{name:'Add tag'})).toBeNull(); expect(screen.queryByLabelText('CSV content')).toBeNull(); expect(calls.every(c=>c.method==='GET')).toBe(true);});

it('creates a device-owned typed tag using its connection protocol',async()=>{
  const calls=backend(); render(<Tags user={admin}/>); await screen.findByText('Speed');
  fireEvent.click(screen.getByRole('button',{name:'Add tag'}));
  fireEvent.change(screen.getByLabelText('Tag key'),{target:{value:'temperature'}});
  fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Temperature'}});
  fireEvent.change(screen.getByLabelText('Address / MQTT value key'),{target:{value:'12'}});
  fireEvent.click(screen.getByRole('button',{name:'Save tag'})); await screen.findByText('Tag saved.');
  expect(calls.find(c=>c.method==='POST' && c.path.endsWith('/tags'))?.body).toMatchObject({device_id:'d',source_type:'modbus-tcp',key:'temperature',data_type:'float32',address:'12',function_code:3,scale:1,offset:0,store_history:true,realtime_enabled:true});
});
it('commits the exact validated CSV and reports imported count',async()=>{
  const calls=backend(); render(<Tags user={admin}/>); const csv='device,tag,data_type\nd,new,uint16';
  fireEvent.change(screen.getByLabelText('CSV content'),{target:{value:csv}}); fireEvent.click(screen.getByRole('button',{name:'Preview CSV'}));
  await waitFor(()=>expect((screen.getByRole('button',{name:'Import CSV'}) as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(screen.getByRole('button',{name:'Import CSV'})); await screen.findByText('Imported 1 tags.'); expect(calls.find(c=>c.path.endsWith('/import'))?.body).toEqual({csv}); expect((screen.getByRole('button',{name:'Import CSV'}) as HTMLButtonElement).disabled).toBe(true);
});
it('keeps an editor open when validation fails and reports test-read failures',async()=>{
  backend(); const initial=globalThis.fetch;
  vi.stubGlobal('fetch',vi.fn(async (path:string,init:RequestInit={})=>init.method==='PATCH' || path.endsWith('/test-read') ? new Response(JSON.stringify({error:{message:init.method==='PATCH'?'Invalid register':'Connection timed out'}}),{status:422}) : initial(path,init)));
  render(<Tags user={admin}/>); fireEvent.click(await screen.findByRole('button',{name:'Edit Speed'})); fireEvent.click(screen.getByRole('button',{name:'Save tag'})); await screen.findByText('Invalid register'); expect(screen.getByRole('button',{name:'Save tag'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Test read Speed'})); await screen.findByText('Connection timed out'); expect(screen.queryByLabelText('Test read result')).toBeNull();
});
it('archives only the confirmed tag while retaining history',async()=>{
  const calls=backend(); render(<Tags user={admin}/>); fireEvent.click(await screen.findByRole('button',{name:'Archive Speed'})); fireEvent.click(screen.getByRole('button',{name:'Confirm archive'})); await screen.findByText('Tag archived. History retained.'); expect(calls.find(c=>c.method==='DELETE')).toMatchObject({path:'/api/v1/tags/t',body:{confirm:true,history_policy:'retain'}});
});
