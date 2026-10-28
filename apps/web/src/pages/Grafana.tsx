import {useEffect,useState} from 'react';
import {request,errorMessage} from '../api/client';
import {t} from '../i18n';
type Status={enabled:boolean;available:boolean;url?:string;can_edit:boolean};
export function Grafana(){
 const [status,setStatus]=useState<Status>();const [error,setError]=useState('');const [revision,setRevision]=useState(0);
 useEffect(()=>{const controller=new AbortController();setError('');void request<Status>('/grafana/status',{signal:controller.signal}).then(setStatus).catch(e=>{if(!controller.signal.aborted)setError(errorMessage(e));});return()=>controller.abort();},[revision]);
 return <section className="grafana-page">
  <div className="toolbar"><p className="muted">{t('Grafana uses your RallyX session. Device data is read-only.')}</p>{status?.available&&<a className="secondary" href="/grafana/" target="_blank" rel="noopener noreferrer">{t(status.can_edit?'Open Grafana editor':'Open Grafana')}</a>}<a href="#widgets">{t('Legacy data widgets')}</a></div>
  {error&&<p className="error" role="alert">{t(error)}</p>}
  {!status&&!error&&<p role="status">{t('Loading Grafana…')}</p>}
  {status&&!status.available&&<article><p>{t('Grafana is temporarily unavailable. Data collection continues.')}</p><button onClick={()=>setRevision(n=>n+1)}>{t('Retry')}</button></article>}
  {status?.available&&<iframe title={t('Grafana dashboards')} src="/grafana/d/rallyx-overview/rallyx" style={{width:'100%',height:'calc(100vh - 260px)',minHeight:700,border:'1px solid #dce3ec',borderRadius:8}}/>}
 </section>;
}
