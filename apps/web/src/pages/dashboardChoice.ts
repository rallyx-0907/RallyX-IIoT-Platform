export type DashboardChoice={kind:'grafana'|'simple';id:string};
const key=(userID:string)=>`rallyx.dashboard.last.${userID}`;
export function rememberedDashboard(userID:string):DashboardChoice|undefined{
 try{const item=JSON.parse(localStorage.getItem(key(userID))||'null');if(item&&['grafana','simple'].includes(item.kind)&&typeof item.id==='string')return item;}catch{/* Browser storage is optional. */}
}
export function linkedDashboard():DashboardChoice|undefined{
 const query=new URLSearchParams(location.search);
 if(query.has('dashboard'))return {kind:'grafana',id:query.get('dashboard')||''};
 if(query.has('simpleBoard'))return {kind:'simple',id:query.get('simpleBoard')||''};
}
export function dashboardLink(choice:DashboardChoice){const url=new URL(location.href);url.searchParams.delete('dashboard');url.searchParams.delete('simpleBoard');url.searchParams.set(choice.kind==='grafana'?'dashboard':'simpleBoard',choice.id);url.hash='dashboards';return url.pathname+url.search+url.hash;}
export function rememberDashboard(userID:string,choice:DashboardChoice){
 try{localStorage.setItem(key(userID),JSON.stringify(choice));}catch{/* The URL still permits reopening when storage is blocked. */}
 history.replaceState(null,'',dashboardLink(choice));
}
