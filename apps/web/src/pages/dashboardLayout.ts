export type GridPos={x:number;y:number;w:number;h:number};
export type LayoutPanel={id:number;gridPos:GridPos;[key:string]:unknown};
const overlaps=(a:GridPos,b:GridPos)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
export function placePanel<T extends LayoutPanel>(panels:T[],id:number,position:GridPos):T[]{
 const value=(n:number,fallback:number)=>Number.isFinite(n)?Math.round(n):fallback;
 const w=Math.min(24,Math.max(3,value(position.w,8)));const h=Math.min(30,Math.max(3,value(position.h,6)));
 const fixed={x:Math.max(0,Math.min(24-w,value(position.x,0))),y:Math.min(1000,Math.max(0,value(position.y,0))),w,h};
 const next=panels.map(p=>({...p,gridPos:{...(p.id===id?fixed:p.gridPos)}}));
 const occupied:GridPos[]=[fixed];
 for(const panel of next.filter(p=>p.id!==id).sort((a,b)=>a.gridPos.y-b.gridPos.y||a.gridPos.x-b.gridPos.x)){
  let collision;while((collision=occupied.find(other=>overlaps(panel.gridPos,other))))panel.gridPos.y=collision.y+collision.h;
  occupied.push(panel.gridPos);
 }
 return next;
}
