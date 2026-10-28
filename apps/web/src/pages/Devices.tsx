import { t as translate } from '../i18n';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorMessage, request } from '../api/client';
import { Empty } from '../components/DataDisplay';
import type { User } from '../types/platform';

type Connection = { id: string; name: string; site_id: string; protocol: string; enabled: boolean };
type Asset = { id: string; name: string; site_id: string };
type Template = { id: string; name: string; protocol: string; manufacturer?: string; model?: string; version: number; tag_definitions: unknown[] };
type Device = { id?: string; name: string; asset_id: string; connection_id: string; template_id?: string; template_version?: number; manufacturer?: string; model?: string; serial_number?: string; protocol_device_address?: string; enabled: boolean; status?: string; metadata: Record<string, unknown> };
type ValueRow = { key: string; type: string; value: string };

export function Devices({ user, onRefresh }: { user: User; onRefresh?: () => Promise<void> }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [draft, setDraft] = useState<Device>();
  const [values, setValues] = useState<ValueRow[]>([]);
  const [archive, setArchive] = useState<Device>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const mounted = useRef(true);
  const admin = user.role === 'admin';
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true; setLoading(true);
    Promise.all([request<Device[]>('/devices'), request<Connection[]>('/connections'), request<Asset[]>('/assets'), request<Template[]>('/templates')])
      .then(([devices, connections, assets, templates]) => { if (active) { setDevices(devices); setConnections(connections); setAssets(assets); setTemplates(templates); setError(''); } })
      .catch(error => { if (active) setError(errorMessage(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  const connection = connections.find(c => c.id === draft?.connection_id);
  const edit = (device?: Device) => {
    const first = connections.find(c => assets.some(a => a.site_id === c.site_id));
    setDraft(device ? { ...device, metadata: { ...device.metadata } } : { name: '', connection_id: first?.id || '', asset_id: assets.find(a => a.site_id === first?.site_id)?.id || '', enabled: true, metadata: {} });
    const configured = device?.metadata?.simulator_values;
    setValues(configured && typeof configured === 'object' && !Array.isArray(configured) ? Object.entries(configured).map(([key, value]) => ({ key, type: typeof value, value: String(value) })) : []);
    setArchive(undefined); setError(''); setNotice('');
  };
  const change = (key: keyof Device, value: unknown) => setDraft(old => old && ({ ...old, [key]: value }));
  async function save(event: FormEvent) {
    event.preventDefault(); if (!draft || busy || !admin) return;
    setError(''); setNotice('');
    const metadata = { ...draft.metadata };
    if (connection?.protocol === 'simulator') {
      const result: Record<string, unknown> = {};
      for (const row of values) {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(row.key) || Object.hasOwn(result, row.key)) { setError('Simulator keys must be unique identifiers.'); return; }
        const value = row.type === 'number' ? Number(row.value) : row.type === 'boolean' ? row.value === 'true' : row.value;
        if (row.type === 'number' && (!row.value.trim() || !Number.isFinite(value))) { setError('Simulator numbers must be finite.'); return; }
        result[row.key] = value;
      }
      if (values.length || metadata.simulator_values) metadata.simulator_values = result;
    }
    const body: Record<string, unknown> = { name: draft.name.trim(), connection_id: draft.connection_id, manufacturer: draft.manufacturer || '', model: draft.model || '', serial_number: draft.serial_number || '', enabled: draft.enabled, metadata };
    if (draft.protocol_device_address?.trim()) body.protocol_device_address = draft.protocol_device_address.trim();
    else if (connection?.protocol === 'modbus-tcp' || connection?.protocol === 'modbus-rtu') { setError('A Modbus unit/slave address is required.'); return; }
    else body.protocol_device_address = '';
    if (!draft.id) { body.asset_id = draft.asset_id; if (draft.template_id) body.template_id = draft.template_id; }
    setBusy(true);
    try {
      await request(`/devices${draft.id ? `/${encodeURIComponent(draft.id)}` : ''}`, { method: draft.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      if (!mounted.current) return;
      setDraft(undefined); setNotice('Device saved.'); setRevision(n => n + 1);
      if (onRefresh) await onRefresh();
    } catch (error) { if (mounted.current) setError(errorMessage(error)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function archiveDevice() {
    if (!archive?.id || busy || !admin) return; setBusy(true); setError(''); setNotice('');
    try {
      await request(`/devices/${encodeURIComponent(archive.id)}`, { method: 'DELETE', body: JSON.stringify({ confirm: true, history_policy: 'retain' }) });
      if (!mounted.current) return;
      setArchive(undefined); setNotice('Device archived. History retained.'); setRevision(n => n + 1); if (onRefresh) await onRefresh();
    } catch (error) { if (mounted.current) setError(errorMessage(error)); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <>
    <div className="toolbar"><p className="muted">{translate("Devices belong to an asset and use an existing connection. Disabling stops polling and retains history.")}</p>{admin && <button className="primary" disabled={busy || loading || !connections.length || !assets.length} onClick={() => edit()}>{translate("Add device")}</button>}</div>
    {error && <div className="error-banner" role="alert">{translate(error)}</div>}{notice && <p role="status">{translate(notice)}</p>}
    {loading && <p role="status">{translate("Loading devices...")}</p>}
    {!loading && (!assets.length || !connections.length) && <p>{translate("Create an asset and a connection before adding a device.")}</p>}
    {archive && admin && <article role="dialog" aria-label={translate("Archive device")}><h2>{translate("Archive")}  {archive.name}?</h2><p>{translate("Polling will stop. Existing tags and history are retained.")}</p><button disabled={busy} onClick={archiveDevice}>{translate("Confirm archive")}</button><button disabled={busy} onClick={() => setArchive(undefined)}>{translate("Cancel")}</button></article>}
    {draft && admin && <article className="spaced"><h2>{draft.id ? translate("Edit device") : translate("Add device")}</h2><form className="form-grid" onSubmit={save}><fieldset disabled={busy} className="wide">
      <label>{translate("Device name")}<input required maxLength={200} value={draft.name} onChange={e => change('name', e.target.value)} /></label>
      <label>{translate("Connection")}<select required value={draft.connection_id} onChange={e => { const c = connections.find(c => c.id === e.target.value)!; setDraft({ ...draft, connection_id: c.id, template_id: draft.id ? draft.template_id : undefined, asset_id: draft.id ? draft.asset_id : assets.find(a => a.site_id === c.site_id)?.id || '' }); }}>{connections.filter(c => !draft.id || c.site_id === assets.find(a => a.id === draft.asset_id)?.site_id).map(c => <option key={c.id} value={c.id}>{c.name} ({translate(c.protocol)}{c.enabled ? '' : translate(", disabled")})</option>)}</select></label>
      <label>{translate("Asset")}<select required disabled={!!draft.id} value={draft.asset_id} onChange={e => change('asset_id', e.target.value)}><option value="">{translate("Select asset")}</option>{assets.filter(a => a.site_id === connection?.site_id).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      {!draft.id ? <label>{translate("Template")}<select value={draft.template_id || ''} onChange={e => { const template = templates.find(t => t.id === e.target.value); setDraft({ ...draft, template_id: template?.id, manufacturer: template?.manufacturer || '', model: template?.model || '' }); }}><option value="">{translate("Manual configuration")}</option>{templates.filter(t => t.protocol === connection?.protocol).map(t => <option key={t.id} value={t.id}>{t.name} {translate("(v")}{t.version}, {t.tag_definitions.length} {translate("tags)")}</option>)}</select></label> : <p>{translate("Asset and template assignment are fixed. Template version:")}  {draft.template_version || translate('Manual')}.</p>}
      {draft.template_id && !draft.id && <p>{translate("Template tags are copied into this device. Later template edits do not change them.")}</p>}
      <label>{translate("Protocol device address / slave ID")}<input value={draft.protocol_device_address || ''} onChange={e => change('protocol_device_address', e.target.value)} /></label>
      <label>{translate("Manufacturer")}<input maxLength={4000} value={draft.manufacturer || ''} onChange={e => change('manufacturer', e.target.value)} /></label>
      <label>{translate("Model")}<input maxLength={4000} value={draft.model || ''} onChange={e => change('model', e.target.value)} /></label>
      <label>{translate("Serial number")}<input maxLength={4000} value={draft.serial_number || ''} onChange={e => change('serial_number', e.target.value)} /></label>
      <label className="inline-label"><input type="checkbox" checked={draft.enabled} onChange={e => change('enabled', e.target.checked)} />{translate("Enabled")}</label>
      {connection?.protocol === 'simulator' && <div className="simulator-values"><h3>{translate("Simulator values")}</h3><p>{translate("Optional per-tag values override the connection defaults.")}</p>{values.map((row, i) => <div className="form-grid" key={i}><label>{translate('Simulator {0} key', {0: i + 1})}<input required value={row.key} onChange={e => setValues(values.map((v, n) => n === i ? { ...v, key: e.target.value } : v))} /></label><label>{translate('Simulator {0} type', {0: i + 1})}<select value={row.type} onChange={e => setValues(values.map((v, n) => n === i ? { ...v, type: e.target.value, value: e.target.value === 'boolean' ? 'false' : '' } : v))}><option value="number">{translate("number")}</option><option value="boolean">{translate("boolean")}</option><option value="string">{translate("string")}</option></select></label><label>{translate('Simulator {0} value', {0: i + 1})}{row.type === 'boolean' ? <select value={row.value} onChange={e => setValues(values.map((v, n) => n === i ? { ...v, value: e.target.value } : v))}><option value="true">{translate("true")}</option><option value="false">{translate("false")}</option></select> : <input type={row.type === 'number' ? 'number' : 'text'} step="any" value={row.value} onChange={e => setValues(values.map((v, n) => n === i ? { ...v, value: e.target.value } : v))} />}</label><button type="button" onClick={() => setValues(values.filter((_, n) => n !== i))}>{translate("Remove value")}  {i + 1}</button></div>)}<button type="button" onClick={() => setValues([...values, { key: '', type: 'number', value: '0' }])}>{translate("Add simulator value")}</button></div>}
      <div className="form-actions"><button className="primary" disabled={loading || !draft.asset_id || !draft.connection_id}>{translate("Save device")}</button><button type="button" onClick={() => setDraft(undefined)}>{translate("Cancel")}</button></div>
    </fieldset></form></article>}
    <article>{!loading && !devices.length ? <Empty title={translate("No devices configured")} /> : <div className="table-wrap"><table><thead><tr><th>{translate("Device")}</th><th>{translate("Asset")}</th><th>{translate("Connection")}</th><th>{translate("Model")}</th><th>{translate("Status")}</th><th /></tr></thead><tbody>{devices.map(d => <tr key={d.id}><td><strong>{d.name}</strong><small>{d.protocol_device_address}</small></td><td>{assets.find(a => a.id === d.asset_id)?.name || d.asset_id}</td><td>{connections.find(c => c.id === d.connection_id)?.name || d.connection_id}</td><td>{[d.manufacturer, d.model].filter(Boolean).join(' ') || '—'}</td><td>{translate(d.enabled ? d.status || 'UNKNOWN' : 'DISABLED')}</td><td>{admin && <><button className="small-button" disabled={busy || loading} onClick={() => edit(d)} aria-label={translate("Edit {0}", { "0": d.name })}>{translate("Edit")}</button><button className="small-button" disabled={busy || loading} onClick={() => { setArchive(d); setDraft(undefined); setError(''); }} aria-label={translate("Archive {0}", { "0": d.name })}>{translate("Archive")} </button></>}</td></tr>)}</tbody></table></div>}</article>
  </>;
}
