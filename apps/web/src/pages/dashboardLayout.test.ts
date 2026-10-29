import {expect,it} from 'vitest';
import {placePanel} from './dashboardLayout';
it('moves and resizes within the grid and pushes collisions down without mutating input',()=>{
 const panels=[{id:1,gridPos:{x:0,y:0,w:12,h:6},custom:'keep'},{id:2,gridPos:{x:12,y:0,w:12,h:6}}];
 const result=placePanel(panels,1,{x:12,y:0,w:12,h:8});
 expect(result[0].gridPos).toEqual({x:12,y:0,w:12,h:8});expect(result[1].gridPos.y).toBe(8);
 expect(result[0].custom).toBe('keep');expect(panels[1].gridPos.y).toBe(0);
 expect(placePanel(panels,1,{x:99,y:-3,w:30,h:1})[0].gridPos).toEqual({x:0,y:0,w:24,h:3});
});
it('bounds extreme drag coordinates and ignores invalid numeric geometry',()=>{
 const panels=[{id:1,gridPos:{x:0,y:0,w:8,h:6}}];
 expect(placePanel(panels,1,{x:0,y:999999,w:8,h:6})[0].gridPos.y).toBe(1000);
 expect(Number.isFinite(placePanel(panels,1,{x:NaN,y:NaN,w:NaN,h:NaN})[0].gridPos.w)).toBe(true);
});
