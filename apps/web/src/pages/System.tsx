import { useEffect, useState } from 'react';
import { request, errorMessage } from '../api/client';
import { Empty, QualityBadge, timeLabel } from '../components/DataDisplay';
import type { User } from '../types/platform';

type Connector = { id: string; name: string; type: string; quality: string; last_seen: string | null };
export function System({ mode, user }: { mode: string; user: User }) {
  const [health, setHealth] = useState<{ database: boolean; mqtt: boolean }>();
  const [version, setVersion] = useState<{ version: string; stage: string }>();
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true; setBusy(true);
    Promise.all([request<{ database: boolean; mqtt: boolean }>('/system/status'), request<{ version: string; stage: string }>('/system/version'), request<Connector[]>('/connectors')])
      .then(([status, version, connectors]) => { if (live) { setHealth(status); setVersion(version); setConnectors(connectors); setError(''); } })
      .catch(error => { if (live) setError(errorMessage(error)); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [revision]);
  return <>{error && <p role="alert" className="error">{error}</p>}<div className="toolbar"><p className="muted">{busy ? 'Checking services…' : 'Service checks reflect the current server connection.'}</p><button className="secondary" disabled={busy} onClick={() => setRevision(revision + 1)}>Test connections</button></div><div className="cards">{(['database', 'mqtt'] as const).map(service => <article key={service}><div className="panel-heading"><p className="eyebrow">{service === 'database' ? 'POSTGRESQL + TIMESCALEDB' : 'MOSQUITTO / MQTT'}</p><span className={`badge badge-${health?.[service] ? 'good' : 'unknown'}`}>{health ? health[service] ? 'Connected' : 'Unavailable' : 'Checking'}</span></div><h2>{service === 'database' ? 'Data storage' : 'Telemetry broker'}</h2><p className="muted">{service === 'database' ? 'Asset configuration and durable operating history.' : 'Normalized messages from simulator and field connectors.'}</p></article>)}</div><article className="spaced"><h2>Field connectors</h2>{connectors.length ? <div className="table-wrap"><table><thead><tr><th>Connector</th><th>Protocol</th><th>Quality</th><th>Last seen</th></tr></thead><tbody>{connectors.map(connector => <tr key={connector.id}><td>{connector.name}</td><td>{connector.type}</td><td><QualityBadge quality={connector.quality} /></td><td>{timeLabel(connector.last_seen)}</td></tr>)}</tbody></table></div> : <Empty title="No connectors configured" />}</article>
    {mode === 'system' && <div className="cards"><article><p className="eyebrow">INSTALLATION</p><h2>RallyX {version?.version || '—'}</h2><p className="muted">{version?.stage || 'Checking version'} · Local deployment<br />Field control: read-only</p>{user.role === 'admin' && <a className="secondary button-link" href="/api/v1/system/diagnostics" download>↓ Download diagnostics</a>}</article><article><p className="eyebrow">RECOVERY & ACCESS</p><h2>Installation administration</h2><p className="muted">Backups and restore are managed by the installation operator. Keep recovery bundles and bootstrap credentials in a secure location.</p><p className="muted">Signed in as <strong>{user.username}</strong> · {user.role}</p></article></div>}
  </>;
}
