import {NavIcon} from './NavIcon';
import {t} from '../i18n';
const operations=['dashboards','overview','alarms','history','live'];
export function WorkspaceNavigation({pages,role,current,alarmCount,onNavigate}:{pages:string[][];role:string;current:string;alarmCount:number;onNavigate:(id:string)=>void}){
 const links=(ids:string[])=>ids.map(id=>pages.find(p=>p[0]===id)).filter((p):p is string[]=>!!p).map(([id,,label])=><a key={id} href={'#'+id} title={t(label)} aria-label={t(label)} onClick={()=>onNavigate(id)} aria-current={current===id?'page':undefined}><span><NavIcon page={id}/></span><b>{t(label)}</b>{id==='alarms'&&alarmCount>0&&<em>{alarmCount}</em>}</a>);
 return <><p className="nav-label">VẬN HÀNH</p><nav aria-label="Vận hành">{links(operations)}</nav>{role==='admin'&&<details className="settings-navigation" open={!operations.includes(current)}><summary>Cài đặt</summary><nav aria-label="Cài đặt">{links(['devices','connections','templates','configuration','rules','system','legacy-dashboards'])}</nav></details>}</>;
}
