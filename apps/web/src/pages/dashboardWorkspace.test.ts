import {expect,it} from 'vitest';
import {scopePoints,workspaceDashboard,previewFresh,previewPath} from './dashboardWorkspace';
import type {Site} from '../types/platform';
const tree=[{id:'s',name:'Factory',areas:[{id:'a',name:'Area',assets:[{id:'m1',name:'Machine 1',devices:[{id:'d1',name:'Sensor',tags:[{id:'p1'}]}]},{id:'m2',name:'Machine 2',devices:[{id:'d2',name:'Motor',tags:[{id:'p2'}]}]}]}]}] as Site[];
it('filters through factory, area, machine and device without mixing machines',()=>{
 expect(scopePoints(tree,{site:'s'})).toEqual(['p1','p2']);
 expect(scopePoints(tree,{asset:'m2'})).toEqual(['p2']);
 expect(scopePoints(tree,{device:'d1'})).toEqual(['p1']);
 expect(scopePoints(tree,{site:'missing'})).toEqual([]);
});
it('never treats disabled realtime as live and leaves gaps in bad history',()=>{
 const tag={quality:'GOOD',ts:new Date().toISOString(),realtime_enabled:false};
 expect(previewFresh(tag)).toBe(false);
 const path=previewPath([{ts:'2026-01-01T00:00:00Z',value:1,quality:'GOOD'},{ts:'2026-01-01T00:01:00Z',value:2,quality:'BAD'},{ts:'2026-01-01T00:02:00Z',value:3,quality:'GOOD'}],Date.parse('2026-01-01T00:00:00Z'));
 expect(path.match(/M/g)).toHaveLength(2);
});
it('builds compact mixed panels with escaped point queries and compatible types',()=>{
 const p={id:"p'1",name:'Temperature',data_type:'float64',unit:'°C'};
 const doc=workspaceDashboard('Factory view','Factory',[{point:p,kind:'timeseries',min:0,max:100},{point:{...p,id:'p2',data_type:'bool'},kind:'stat',min:0,max:1}]);
 expect(doc.panels).toHaveLength(4);
 expect(doc.panels[0].gridPos.w).toBe(12);
 expect(doc.panels[2].targets[0].rawSql).toContain("tag_id = 'p''1'");
 expect(()=>workspaceDashboard('Bad','',[{point:{...p,data_type:'bool'},kind:'gauge',min:0,max:1}])).toThrow();
 expect(()=>workspaceDashboard('Empty','',[])).toThrow();
});
it('keeps boolean fault meaning and rejects invalid ranges or excessive points',()=>{
 const choice={point:{id:'fault',name:'Fault',data_type:'bool',semantic:'fault'},kind:'stat',min:0,max:1};
 const doc=workspaceDashboard('Machine','Area',[choice]);
 expect(doc.panels[0].fieldConfig.defaults).toMatchObject({mappings:[{options:{true:{text:'LỖI',color:'red'},false:{text:'BÌNH THƯỜNG',color:'green'}}}]});
 expect(()=>workspaceDashboard('Too many','',Array.from({length:25},()=>choice))).toThrow();
 expect(()=>workspaceDashboard('Range','',[{...choice,point:{...choice.point,data_type:'float64'},kind:'gauge',min:20,max:10}])).toThrow();
});
