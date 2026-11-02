import {useState} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {SelectorProperties,convertSelectorPositions} from './SelectorProperties';
afterEach(cleanup);
function Fixture(){const [properties,setProperties]=useState<Record<string,unknown>>({positions:[{value:10,label:'MAN'},{value:20,label:'AUTO'}]});return <><output>{JSON.stringify(properties)}</output><SelectorProperties properties={properties} onChange={setProperties}/></>;}
it('edits two or three typed position mappings without exposing a third entry for two positions',()=>{
 render(<Fixture/>);expect(screen.queryByLabelText('Nhãn vị trí 3')).toBeNull();fireEvent.change(screen.getByLabelText('Số vị trí'),{target:{value:'3'}});expect(screen.getByLabelText('Nhãn vị trí 3')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Nhãn vị trí 3'),{target:{value:'REMOTE'}});fireEvent.change(screen.getByLabelText('Giá trị vị trí 3'),{target:{value:'30'}});fireEvent.blur(screen.getByLabelText('Giá trị vị trí 3'));
 expect(screen.getByRole('status').textContent).toContain('30');
});
it('uses strict boolean values and prevents three boolean positions',()=>{
 const change=vi.fn();render(<SelectorProperties properties={{positions:[{value:false,label:'LOCAL'},{value:true,label:'REMOTE'}]}} onChange={change} boundType="boolean"/>);
 expect((screen.getByLabelText('Giá trị vị trí 1') as HTMLSelectElement).value).toBe('false');expect((screen.getByRole('option',{name:'3 vị trí'}) as HTMLOptionElement).disabled).toBe(true);
});
it('converts mapping types when binding while retaining configured labels and same-type values',()=>{
 const positions=[{value:10,label:'LOCAL'},{value:20,label:'REMOTE'}];expect(convertSelectorPositions(positions,'number')).toEqual(positions);expect(convertSelectorPositions(positions,'boolean')).toEqual([{value:false,label:'LOCAL'},{value:true,label:'REMOTE'}]);
});
