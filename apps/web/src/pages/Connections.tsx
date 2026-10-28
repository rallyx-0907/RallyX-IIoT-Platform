import { t as translate } from '../i18n';
import { useEffect, useState } from 'react';
import { errorMessage, post, request } from '../api/client';
import { Empty, timeLabel } from '../components/DataDisplay';
import type { User } from '../types/platform';

type Protocol = 'simulator' | 'mqtt' | 'modbus-tcp' | 'modbus-rtu';
type Connection = {
  id: string; site_id: string; name: string; protocol: Protocol; enabled: boolean;
  polling_interval_ms: number; timeout_ms: number; retry_policy: Record<string, number>;
  protocol_config: Record<string, unknown>; status: string; last_seen: string | null;
  last_successful_poll?: string | null; has_credentials?: boolean;
};
type Site = { id: string; name: string };
type Draft = Omit<Connection, 'id' | 'status' | 'last_seen'> & { id?: string };
const fresh = (site: string): Draft => ({ site_id: site, name: '', protocol: 'simulator', enabled: true, polling_interval_ms: 1000, timeout_ms: 2000, retry_policy: {}, protocol_config: {} });
const defaults: Record<Protocol, Record<string, unknown>> = {
  simulator: {}, mqtt: { broker_url: 'mqtt://', topic: '' },
  'modbus-tcp': { host: '', port: 502 },
  'modbus-rtu': { serial_port: '/dev/ttyUSB0', baudrate: 9600, data_bits: 8, parity: 'none', stop_bits: 1 },
};

export function Connections({ user }: { user: User }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [draft, setDraft] = useState<Draft>();
  const [archive, setArchive] = useState<Connection>();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const admin = user.role === 'admin';
  useEffect(() => {
    let active = true;
    setBusy(true);
    Promise.all([request<Connection[]>('/connections'), request<Site[]>('/sites')])
      .then(([connections, sites]) => { if (active) { setConnections(connections); setSites(sites); setError(''); } })
      .catch(error => { if (active) setError(errorMessage(error)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [revision]);
  const edit = (connection?: Connection) => {
    setArchive(undefined);
    setDraft(connection ? { ...connection, protocol_config: { ...connection.protocol_config } } : fresh(sites[0]?.id || ''));
    setUsername(''); setPassword(''); setError(''); setNotice('');
  };
  const config = (key: string, value: unknown) => setDraft(old => old && ({ ...old, protocol_config: { ...old.protocol_config, [key]: value } }));
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft || busy) return;
    setBusy(true); setError(''); setNotice('');
    const body: Record<string, unknown> = {
      site_id: draft.site_id, name: draft.name, protocol: draft.protocol, enabled: draft.enabled,
      polling_interval_ms: draft.polling_interval_ms, timeout_ms: draft.timeout_ms,
      retry_policy: draft.retry_policy, protocol_config: draft.protocol_config,
    };
    if (username || password) body.credentials = { username, password };
    try {
      await request(`/connections${draft.id ? `/${encodeURIComponent(draft.id)}` : ''}`, { method: draft.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      setDraft(undefined); setUsername(''); setPassword(''); setNotice('Connection saved.'); setRevision(value => value + 1);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const test = async (connection: Connection) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await post<{ connected?: boolean }>(`/connections/${encodeURIComponent(connection.id)}/test`, {});
      setNotice(`${connection.name}: ${result.connected ? 'connection successful.' : 'connection unavailable.'}`);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const confirmArchive = async () => {
    if (!archive || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await request(`/connections/${encodeURIComponent(archive.id)}`, { method: 'DELETE', body: JSON.stringify({ confirm: true, history_policy: 'retain' }) });
      setArchive(undefined); setNotice('Connection archived. History retained.'); setRevision(value => value + 1);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const field = (label: string, key: string, type = 'text', minimum?: number, maximum?: number) => <label>{translate(label)}<input type={type} required min={minimum} max={maximum} step={type === 'number' ? 1 : undefined} value={String(draft?.protocol_config[key] ?? '')} onChange={event => config(key, type === 'number' ? Number(event.target.value) : event.target.value)} /></label>;
  return <>
    {error && <p className="error" role="alert">{translate(error)}</p>}
    {notice && <p role="status">{translate(notice)}</p>}
    <article><div className="panel-heading"><div><h2>{translate("Connections")}</h2><p className="muted">{translate("Configure read-only field links. Changes are picked up automatically by connectivity workers.")}</p></div><div className="toolbar"><button className="secondary" disabled={busy} onClick={() => setRevision(value => value + 1)}>{translate("Refresh connections")}</button>{admin && <button className="primary" disabled={busy || sites.length === 0} onClick={() => edit()}>{translate("Add connection")}</button>}</div></div>
      {busy && <p role="status">{translate("Checking connections…")}</p>}
      {!connections.length ? <Empty title={translate("No connections configured")} /> : <div className="table-wrap"><table><thead><tr><th>{translate("Connection")}</th><th>{translate("Protocol")}</th><th>{translate("Status")}</th><th>{translate("Last seen")}</th><th>{translate("Last successful poll")}</th>{admin && <th>{translate("Actions")}</th>}</tr></thead><tbody>{connections.map(connection => <tr key={connection.id}><td>{connection.name}</td><td>{translate(connection.protocol)}</td><td><span className={`badge badge-${!connection.enabled ? 'unknown' : connection.status === 'CONNECTED' ? 'good' : 'bad'}`}>{translate(connection.enabled ? connection.status || 'UNKNOWN' : 'DISABLED')}</span></td><td>{timeLabel(connection.last_seen)}</td><td>{timeLabel(connection.last_successful_poll || null)}</td>{admin && <td><button className="secondary" aria-label={translate("Edit {0}", { "0": connection.name })} disabled={busy} onClick={() => edit(connection)}>{translate("Edit")}</button> <button className="secondary" aria-label={translate("Test {0}", { "0": connection.name })} disabled={busy || !connection.enabled} onClick={() => { void test(connection); }}>{translate("Test Connection")}</button> <button className="secondary" aria-label={translate("Archive {0}", { "0": connection.name })} disabled={busy} onClick={() => { setDraft(undefined); setUsername(''); setPassword(''); setNotice(''); setError(''); setArchive(connection); }}>{translate("Archive")} </button></td>}</tr>)}</tbody></table></div>}
    </article>
    {admin && archive && <article className="spaced" role="region" aria-label={translate("Confirm connection archive")}><h2>{translate("Archive")}  {archive.name}?</h2><p>{translate("History is retained. Move or archive devices using this connection first.")}</p><div className="toolbar"><button className="primary" disabled={busy} onClick={() => { void confirmArchive(); }}>{translate("Confirm archive")}</button><button className="secondary" disabled={busy} onClick={() => setArchive(undefined)}>{translate("Cancel archive")}</button></div></article>}
    {admin && draft && <article className="spaced"><h2>{draft.id ? translate("Edit connection") : translate("Add connection")}</h2><form onSubmit={save}><fieldset disabled={busy} className="connection-fields"><div className="form-grid">
      <label>{translate("Connection name")}<input required maxLength={200} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>{translate("Site")}<select required disabled={!!draft.id} value={draft.site_id} onChange={event => setDraft({ ...draft, site_id: event.target.value })}>{sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
      <label>{translate("Protocol")}<select disabled={!!draft.id} value={draft.protocol} onChange={event => { const protocol = event.target.value as Protocol; setDraft({ ...draft, protocol, protocol_config: { ...defaults[protocol] } }); setUsername(''); setPassword(''); }}><option value="simulator">{translate("Simulator")} </option><option value="mqtt">{translate("MQTT")}</option><option value="modbus-tcp">{translate("Modbus TCP")}</option><option value="modbus-rtu">{translate("Modbus RTU")}</option></select></label>
      <label>{translate("Polling interval (ms)")}<input required type="number" min={100} max={86400000} value={draft.polling_interval_ms} onChange={event => setDraft({ ...draft, polling_interval_ms: Number(event.target.value) })} /></label>
      <label>{translate("Timeout (ms)")}<input required type="number" min={100} max={60000} value={draft.timeout_ms} onChange={event => setDraft({ ...draft, timeout_ms: Number(event.target.value) })} /></label>
      <label>{translate("Enabled")}<select value={String(draft.enabled)} onChange={event => setDraft({ ...draft, enabled: event.target.value === 'true' })}><option value="true">{translate("Enabled")}</option><option value="false">{translate("Disabled")}</option></select></label>
      {draft.protocol === 'modbus-tcp' && <>{field('Host', 'host')}{field('Port', 'port', 'number', 1, 65535)}</>}
      {draft.protocol === 'modbus-rtu' && <>{field('Serial port', 'serial_port')}{field('Baudrate', 'baudrate', 'number', 1200, 230400)}{field('Data bits', 'data_bits', 'number', 7, 8)}{field('Stop bits', 'stop_bits', 'number', 1, 2)}<label>{translate("Parity")}<select value={String(draft.protocol_config.parity)} onChange={event => config('parity', event.target.value)}>{['none', 'even', 'odd'].map(value => <option key={value} value={value}>{translate(value)}</option>)}</select></label></>}
      {draft.protocol === 'mqtt' && <>{field('Broker URL', 'broker_url')}{field('Topic subscription', 'topic')}<label>{translate("MQTT username")}<input autoComplete="off" value={username} onChange={event => setUsername(event.target.value)} /></label><label>{translate("MQTT password")}<input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label></>}
    </div>{draft.protocol === 'mqtt' && <p className="muted">{translate("Credentials are write-only. Leave both fields blank to retain saved credentials.")}</p>}
      {draft.protocol === 'simulator' && <p className="muted">{translate("Simulator values are configured per device. Saving a link does not create a device or tags.")}</p>}
      <div className="toolbar"><button className="primary" type="submit">{translate("Save connection")}</button><button className="secondary" type="button" onClick={() => { setDraft(undefined); setPassword(''); setUsername(''); }}>{translate("Cancel")}</button></div>
    </fieldset></form></article>}
  </>;
}
