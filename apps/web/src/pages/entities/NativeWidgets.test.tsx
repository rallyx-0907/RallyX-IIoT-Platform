import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {NativeWidget} from './NativeWidgets';
import type {Widget,WidgetData} from './model';
afterEach(cleanup);
const widget:Widget={id:'a',type:'value-card',title:'Thanh ghi 0 (HR 40001)',binding:{scope:'current',metric:'power'},aggregation:'last',layout:{x:0,y:0,w:8,h:6},presentation:{precision:1}};
const data:WidgetData={id:'a',type:'value-card',title:'Công suất tác dụng',value:10,unit:'kW',quality:'GOOD',expected:1,good:1,series:[],diagnostics:[]};
function show(patch:Partial<WidgetData>={}){return render(<NativeWidget widget={widget} data={{...data,...patch}} offline={false} from="2026-10-31T00:00:00Z" to="2026-10-31T01:00:00Z" onEntity={()=>{}}/>);}
it('shows semantic names and hides redundant single-source coverage',()=>{show();expect(screen.getByRole('heading').textContent).toBe('Công suất tác dụng');expect(screen.queryByText('1/1 nguồn tốt')).toBeNull();});
it('retains coverage for partial aggregates',()=>{show({expected:3,good:2,quality:'PARTIAL'});expect(screen.getByText('2/3 nguồn tốt')).toBeTruthy();});
