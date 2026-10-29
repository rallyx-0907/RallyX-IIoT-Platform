import {expect,it} from 'vitest';
import {nextWidgetLayout} from './model';
it('packs new cards across the available row before creating unused vertical space',()=>{
 const first=nextWidgetLayout([],8,5),second=nextWidgetLayout([{layout:first}],8,5),third=nextWidgetLayout([{layout:first},{layout:second}],8,5);
 expect([first.x,second.x,third.x]).toEqual([0,8,16]);expect(third.y).toBe(0);
 const fourth=nextWidgetLayout([{layout:first},{layout:second},{layout:third}],8,5);expect(fourth.y).toBe(5);
});
