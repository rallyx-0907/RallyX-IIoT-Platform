import { t as translate, useLanguage, LanguageSelector, getLocale } from './i18n';
import { useEffect, useState } from 'react';
import { ApiError, errorMessage, post, request } from './api/client';
import {WorkspaceNavigation} from './components/WorkspaceNavigation';
import {QuickDeviceWizard,type CloneDevice} from './pages/QuickDeviceWizard';
import {rememberEntity} from './pages/entities/model';
import { AuthForm } from './components/AuthForm';
import { usePlatform } from './stores/usePlatform';
import { Overview } from './pages/Overview';
import { Grafana } from './pages/Grafana';
import { linkedDashboard, rememberedDashboard } from './pages/dashboardChoice';
import { DashboardWidgets } from './components/DashboardWidgets';
import { Assets } from './pages/Assets';
import { History } from './pages/History';
import { Alarms } from './pages/Alarms';
import { Rules } from './pages/Rules';
import { System } from './pages/System';
import { Connections } from './pages/Connections';
import { Devices } from './pages/Devices';
import { Templates } from './pages/Templates';
import { Tags } from './pages/Tags';
import { LiveData } from './pages/LiveData';
import {EntityDashboards} from './pages/EntityDashboards';
import {lastEntity} from './pages/entities/model';
import type { User } from './types/platform';

const pages = [
  ['dashboards', '', 'Dashboards', 'Build dashboards from your devices and datapoints.'],
  ['legacy-dashboards', '', 'Báo cáo nâng cao', 'Các dashboard đã lưu trước khi dùng entity runtime.'],
  ['widgets', '', 'Saved simple dashboards', 'Saved indicators, gauges and point trends.'],
  ['overview', '◫', 'Overview', 'Your local operations, at a glance.'],
  ['assets', '▦', 'Assets', 'Equipment, configured tags, and operating metrics.'],
  ['live', '⌁', 'Live Data', 'Current values and quality from the field.'],
  ['history', '◷', 'History & Trends', 'Explore samples, transitions, and runtime sessions.'],
  ['alarms', '△', 'Alarms', 'Conditions that need your attention.'],
  ['connections', '⤧', 'Connections', 'Follow the path from field data to your platform.'],
  ['devices', '◇', 'Devices', 'Configure devices and their connection or template.'],
  ['templates', '▤', 'Templates', 'Reusable device definitions and tag mappings.'],
  ['configuration', '⚙', 'Tag Configuration', 'Define the signals your platform monitors.'],
  ['rules', '≡', 'Rules', 'Configure fault, threshold, and communication alarms.'],
  ['system', '⊞', 'System', 'Installation health, diagnostics, and access.'],
];

export function App() {
  const language = useLanguage();
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const [user, setUser] = useState<User | null>();
  const [startupError, setStartupError] = useState('');
  const [page, setPage] = useState(location.hash.slice(1) || 'dashboards');
  const [selected, setSelected] = useState('');
  const [actionError, setActionError] = useState('');
  const [completionNotice,setCompletionNotice]=useState('');
  const [nativeOverride,setNativeOverride]=useState(false);
  const [quickWizard,setQuickWizard]=useState<boolean|CloneDevice>(false),[nativeEpoch,setNativeEpoch]=useState(0);
  const dashboardEntry=page==='dashboards'||page==='legacy-dashboards'||Boolean(!location.hash&&user&&(lastEntity(user.id)||linkedDashboard()||rememberedDashboard(user.id)));
  const platform = usePlatform(user,!dashboardEntry);
  useEffect(() => {
    if (user && !location.hash && (lastEntity(user.id)||linkedDashboard() || rememberedDashboard(user.id))) {
      const target='dashboards';setPage(target);history.replaceState(null,'',location.pathname+location.search+'#'+target);
    }
  }, [user?.id]);
  useEffect(() => {
    let current = true;
    request<User>('/auth/me').then(result => { if (current) setUser(result); }).catch(error => {
      if (current) { if (!(error instanceof ApiError && error.status === 401)) setStartupError(errorMessage(error)); setUser(null); }
    });
    const hash = () => setPage(location.hash.slice(1) || 'dashboards');
    window.addEventListener('hashchange', hash);
    return () => { current = false; window.removeEventListener('hashchange', hash); };
  }, []);
  const navigate = (next: string) => { if(next==='dashboards'){const url=new URL(location.href);url.searchParams.delete('dashboard');url.searchParams.delete('simpleBoard');history.replaceState(null,'',url.pathname+url.search+url.hash);setNativeOverride(true);}setPage(next); location.hash = next; setActionError(''); };
  const acknowledge = async (id: number) => {
    try { await post(`/alarms/${id}/ack`, {}); await platform.refresh(); } catch (error) { setActionError(errorMessage(error)); }
  };
  if (user === undefined) return <div className="loading-screen" role="status">{translate("Connecting to your workspace…")}</div>;
  if (!user || user.must_change_password) return <AuthForm key={user?.id || 'login'} user={user} onUser={setUser} initialError={startupError} />;
  const current = pages.find(item => item[0] === page) || pages.find(item => item[0] === 'overview')!;
  const { data, loading, error, connection, refresh } = platform;
  return <div className="shell">
    <aside><a className="wordmark" href="#dashboards" aria-label={translate("RallyX home")}>R<span>✦</span><b>RallyX</b></a><small className="brand-caption">{translate("IIoT PLATFORM")}</small><WorkspaceNavigation pages={pages} role={user.role} current={current[0]} alarmCount={data.alarms.length} onNavigate={navigate}/><footer><span className="local-dot" /> {translate("LOCAL OPERATIONS")}<br /><span>{translate("Read-only field integration")}</span><div className="profile"><i>{user.username.slice(0, 1).toUpperCase()}</i><div><strong>{user.username}</strong><small>{translate(user.role)}</small></div><button title={translate("Sign out")} aria-label={translate("Sign out")} onClick={async () => { try { await post('/auth/logout', {}); setUser(null); } catch (error) { setActionError(errorMessage(error)); } }}>↪</button></div></footer></aside>
    <main><header><span className="breadcrumb">{translate("Workspace")}  <span>/</span> <strong>{translate(current[2])}</strong></span><div className="header-right"><LanguageSelector /><span className={`connection ${connection}`}><i />{connection === 'live' ? translate("Live connection") : connection === 'offline' ? translate("Disconnected · last known data") : translate("Connecting realtime")}</span><span className="date-label">{new Date().toLocaleDateString(getLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}</span></div></header>
      <section><div className="page-heading"><div><p className="eyebrow">{translate("MONITOR · UNDERSTAND · ACT")}</p><h1>{translate(current[2])}</h1><p className="muted">{translate(current[3])}</p></div><button className="secondary" onClick={() => { void refresh(); }} disabled={loading}>{translate("↻ Refresh")}</button></div>
        {completionNotice&&<p role="status" className="onboarding-success">{completionNotice}<button onClick={()=>setCompletionNotice('')}>Đóng thông báo</button></p>}{(actionError || (current[0] !== 'dashboards' && error)) && <p className="error" role="alert">{translate(actionError || error)}</p>}
        {connection === 'offline' && <p className="warning">{translate("Realtime connection interrupted. Values are last known readings; checking for a connection.")}</p>}
        {loading&&!dashboardEntry ? <div className="loading-panel" role="status">{translate("Loading platform data…")}</div> : <>
          {current[0] === 'overview' && <Overview data={data} user={user} offline={connection === 'offline'} onAsset={id => { rememberEntity(user.id,'legacy:assets:'+id);setNativeEpoch(n=>n+1);navigate('dashboards'); }} onAddDevice={()=>setQuickWizard(true)} onAlarms={() => navigate('alarms')} onAck={acknowledge} />}
          {current[0] === 'assets' && <Assets data={data} selected={selected} onSelect={setSelected} offline={connection === 'offline'} user={user} onRefresh={refresh} />}
          {current[0] === 'live' && <LiveData data={data} offline={connection === 'offline'} />}
          {current[0] === 'dashboards' && (!nativeOverride&&linkedDashboard()?<><button onClick={()=>navigate('dashboards')}>Mở giám sát native</button><Grafana userID={user.id} allowCreate={false}/></>:<EntityDashboards key={nativeEpoch} user={user} offline={connection==='offline'} onAddDevice={()=>setQuickWizard(true)} onCloneDevice={async id=>{try{setQuickWizard(await request<CloneDevice>('/onboarding/devices/'+encodeURIComponent(id)));}catch(e){setActionError(errorMessage(e));}}}/>)}
          {current[0] === 'legacy-dashboards' && <><button onClick={()=>navigate('dashboards')}>Mở giám sát native</button><Grafana userID={user.id} allowCreate={false}/></>}
          {current[0] === 'widgets' && <DashboardWidgets readOnly offline={connection === 'offline'} />}
          {current[0] === 'history' && <History data={data} />}
          {current[0] === 'alarms' && <Alarms data={data} user={user} onAck={acknowledge} />}
          {current[0] === 'configuration' && <Tags user={user} onRefresh={refresh} />}
          {current[0] === 'rules' && <Rules data={data} user={user} onRefresh={refresh} />}
          {current[0] === 'connections' && <Connections user={user} />}
          {current[0] === 'devices' && <Devices user={user} onRefresh={refresh} />}
          {current[0] === 'templates' && <Templates user={user} />}
          {current[0] === 'system' && <System mode={current[0]} user={user} />}
        </>}
        <div className="page-foot">{translate("RallyX IIoT Platform")}  <span>{translate("Local data. Operational clarity.")}</span></div>
      </section>
      {quickWizard&&<QuickDeviceWizard initialDevice={typeof quickWizard==='object'?quickWizard:undefined} onClose={()=>setQuickWizard(false)} onCreated={(id,summary)=>{setCompletionNotice('Đã tự gán '+(summary?.mapped||0)+'/'+(summary?.total||0)+' đại lượng. Dashboard đã sẵn sàng.');rememberEntity(user.id,id);setNativeEpoch(n=>n+1);navigate('dashboards');}}/>}
    </main>
  </div>;
}
