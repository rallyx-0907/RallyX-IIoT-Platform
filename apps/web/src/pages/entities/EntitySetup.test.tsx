import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {EntitySetup} from './EntitySetup';
import {request} from '../../api/client';
vi.mock('../../api/client',()=>({request:vi.fn(),errorMessage:(e:Error)=>e.message}));
const profile={id:'electric',name:'Điện năng',revision:2,metrics:[{key:'power',name:'Công suất',data_type:'number',unit:'kW',precision:1,history:true}]};
beforeEach(()=>{vi.mocked(request).mockImplementation(async path=>path==='/entity-types'?[{key:'group',name:'Nhóm',fields:[],revision:1}]:path==='/entity-profiles'?[profile]:[]);});
it('edits a selected profile as a new version through a separate dialog',async()=>{
 render(<EntitySetup onClose={()=>{}} onSaved={()=>{}}/>);
 await waitFor(()=>expect(screen.getByRole('option',{name:/Điện năng/})).toBeTruthy());
 fireEvent.change(screen.getByLabelText('Profile'),{target:{value:'electric'}});
 fireEvent.click(screen.getByRole('button',{name:'Tạo phiên bản profile'}));
 expect(screen.getByRole('heading',{name:'Phiên bản profile mới'})).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Tên hiển thị'),{target:{value:'Công suất thực'}});
 expect(vi.mocked(request).mock.calls.filter(([,o])=>o?.method==='PUT')).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'Lưu profile'}));
 await waitFor(()=>expect(request).toHaveBeenCalledWith('/entity-profiles/electric',expect.objectContaining({method:'PUT',body:expect.stringContaining('Công suất thực')})));
 const body=JSON.parse(vi.mocked(request).mock.calls.find(([p,o])=>p==='/entity-profiles/electric'&&o?.method==='PUT')![1]!.body as string);expect(body.revision).toBe(2);
});
