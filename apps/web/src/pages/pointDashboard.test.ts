import {expect,it} from 'vitest';
import {pointDashboard} from './pointDashboard';
it('binds every panel to exactly the chosen point and escapes SQL literals',()=>{
 const d=pointDashboard({id:"a'b",name:'Temperature',data_type:'float64',unit:'°C'},'My dashboard','timeseries',0,100);
 expect(d.title).toBe('My dashboard');
 expect(d.panels[0].targets[0].rawSql).toContain("tag_id = 'a''b'");
 expect(d.panels[0].type).toBe('timeseries');
 expect(d.panels[1].type).toBe('table');
});
it('uses current values for string and boolean points',()=>{
 for(const data_type of ['bool','string']){
  const d=pointDashboard({id:'one',name:'State',data_type},'State','stat',0,100);
  expect(d.panels[0].targets[0].rawSql).toContain('current_values');
  expect(d.panels[0].targets[0].rawSql).toContain('value_text');
 }
});

it('supports current-value visualizations and validates gauge limits',()=>{
 for(const type of ['stat','gauge','bargauge','table']){
  const d=pointDashboard({id:'only',name:'Level',data_type:'uint16'},'Level',type,0,200);
  expect(d.panels[0].type).toBe(type);expect(d.panels[0].targets[0].rawSql).toContain("tag_id = 'only'");
 }
 expect(()=>pointDashboard({id:'x',name:'x',data_type:'float64'},'x','gauge',100,0)).toThrow();
});
it('keeps Grafana tags below its 50 character limit with long point identifiers',()=>{
 const id='a'.repeat(64);const d=pointDashboard({id,name:'Point',data_type:'uint16'},'Point','stat',0,100);
 expect(d.tags.every(tag=>tag.length<=50)).toBe(true);expect(d.description).toContain(id);
});
