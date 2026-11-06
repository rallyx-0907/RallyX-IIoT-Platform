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
it('reserves independent heading, bounded donut drawing and scrollable legend regions',()=>{
 const distribution:Widget={...widget,type:'distribution',title:'Phân bố trạng thái khu vực',binding:{scope:'children',metric:''}};
 const props={widget:distribution,data:{...data,type:'distribution',title:distribution.title,states:{FAULT:1,RUNNING:1}},offline:false,from:'2026-11-06T00:00:00Z',to:'2026-11-06T01:00:00Z',onEntity:()=>{}};
 const {container,rerender}=render(<NativeWidget {...props}/>);
 const root=container.querySelector('.widget-distribution')!;
 expect(root.children[0].className).toBe('native-widget-heading');
 expect(root.querySelector('.native-distribution-chart > .native-donut')).toBeTruthy();
 expect(root.querySelector('.native-distribution-legend')).toBeTruthy();
 expect(screen.getByRole('heading').getAttribute('title')).toBe(distribution.title);
 expect(root.querySelector('.native-donut')?.getAttribute('aria-label')).toContain('2');
 rerender(<NativeWidget {...props} offline/>);
 expect(screen.getByText('Chưa xác định')).toBeTruthy();
 rerender(<NativeWidget {...props} data={{...props.data,states:{}}}/>);
 expect(screen.getByText('Chưa có mục cấp dưới.')).toBeTruthy();
});
