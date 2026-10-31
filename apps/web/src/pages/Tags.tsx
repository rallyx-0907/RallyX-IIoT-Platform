import { t as translate } from '../i18n';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorMessage, post, request } from '../api/client';
import type { User } from '../types/platform';
import '../signals.css';

type RecordTag = { id: string; device_id: string; key: string; name: string; data_type: string; [key: string]: unknown };
type Device = { id: string; name: string; connection_id: string; asset_id: string };
type Connection = { id: string; protocol: string };
type Preview = { total: number; rows: { row: number; tag: Record<string, unknown> }[]; errors: { row: number; column: string; message: string }[] };
const numericFields = [['Scale', 'scale', 1], ['Offset', 'offset', 0], ['Deadband', 'deadband', 0], ['Stale after (seconds)', 'stale_seconds', 30]] as const;
const switches = [['Store history', 'store_history'], ['Realtime enabled', 'realtime_enabled'], ['Enabled', 'enabled']] as const;

export function Tags({ user, onRefresh }: { user: User; onRefresh?: () => Promise<void> }) {
  const admin = user.role === 'admin';
  const [tags, setTags] = useState<RecordTag[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [editing, setEditing] = useState<RecordTag | null | undefined>();
  const [deviceID, setDeviceID] = useState('');
  const [filterDevice, setFilterDevice] = useState(()=>new URLSearchParams(location.search).get('device_id')||'');
  const [search, setSearch] = useState(()=>new URLSearchParams(location.search).get('signal')||'');
  const [filterType, setFilterType] = useState('');
  const [page, setPage] = useState(0);
  const [archive, setArchive] = useState<RecordTag>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [readings, setReadings] = useState<{ tag_id: string; raw: unknown; decoded: unknown; scaled: unknown }[]>([]);
  const [csv, setCSV] = useState('');
  const csvVersion = useRef(0);
  const [preview, setPreview] = useState<{ source: string; result: Preview }>();
  async function load() {
    const [nextTags, nextDevices, nextConnections] = await Promise.all([request<RecordTag[]>('/tags'), request<Device[]>('/devices'), request<Connection[]>('/connections')]);
    setTags(nextTags); setDevices(nextDevices); setConnections(nextConnections);
  }
  useEffect(() => { void load().catch(e => setError(errorMessage(e))); }, []);
  const device = devices.find(item => item.id === deviceID);
  const protocol = connections.find(item => item.id === device?.connection_id)?.protocol || '';
  const modbus = protocol.startsWith('modbus-');
  const filtered = tags.filter(tag => (!filterDevice || tag.device_id === filterDevice) && (!filterType || tag.data_type === filterType) && [tag.name, tag.key, tag.address, devices.find(d => d.id === tag.device_id)?.name].some(value => String(value ?? '').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
  const pages = Math.max(1, Math.ceil(filtered.length / 25));
  const currentPage = Math.min(page, pages - 1);
  const visibleTags = filtered.slice(currentPage * 25, (currentPage + 1) * 25);
  async function act(action: () => Promise<void>) {
    if (!admin) return;
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function refresh() { await load(); await onRefresh?.(); }
  function changeCSV(value: string) { csvVersion.current++; setCSV(value); setPreview(undefined); }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void act(async () => {
      const body: Record<string, unknown> = {};
      for (const key of ['name', 'key', 'data_type', 'address', 'unit', 'semantic', 'sample_policy', 'byte_order', 'word_order']) body[key] = form.get(key) || '';
      for (const [, key] of numericFields) body[key] = Number(form.get(key));
      for (const [, key] of switches) body[key] = form.get(key) === 'on';
      if (form.get('function_code')) body.function_code = Number(form.get('function_code'));
      if (form.get('poll_interval_ms')) body.poll_interval_ms = Number(form.get('poll_interval_ms'));
      else if (editing) body.poll_interval_ms = null;
      if (editing) await request(`/tags/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await post('/tags', { ...body, device_id: deviceID, source_type: protocol });
      await refresh(); setEditing(undefined); setMessage('Tag saved.');
    });
  }
  return <>
    <div className="toolbar"><p className="muted">{translate("Device-owned tag mappings. Test read reads saved configuration; field writes are unavailable.")}</p><a href="/api/v1/config/tags.csv" download>{translate("Export tags CSV")}</a>{admin && <button className="primary" onClick={() => { setEditing(null); setDeviceID(filterDevice || devices[0]?.id || ''); setError(''); }}>{translate("Add tag")}</button>}</div>
    <article className="signal-filters"><div className="filters">
      <label>{translate('Filter signals by device')}<select value={filterDevice} onChange={e => { setFilterDevice(e.target.value); setPage(0); }}><option value="">{translate('All devices')}</option>{devices.map(d => <option key={d.id} value={d.id}>{d.name} · {tags.filter(t => t.device_id === d.id).length}</option>)}</select></label>
      <label>{translate('Search signals')}<input type="search" value={search} placeholder={translate('Name, key or address')} onChange={e => { setSearch(e.target.value); setPage(0); }} /></label>
      <label>{translate('Filter signal datatype')}<select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(0); }}><option value="">{translate('All datatypes')}</option>{[...new Set(tags.map(t => t.data_type))].sort().map(type => <option key={type} value={type}>{translate(type)}</option>)}</select></label>
      <button onClick={() => { setFilterDevice(''); setSearch(''); setFilterType(''); setPage(0); }}>{translate('Clear filters')}</button>
    </div><p className="muted" role="status">{translate('Showing {0} of {1} signals', { 0: filtered.length, 1: tags.length })}</p>{!filtered.length && tags.length > 0 && <p>{translate('No signals match these filters.')}</p>}</article>
    {error && <p role="alert" className="error">{translate(error)}</p>}{message && <p role="status">{translate(message)}</p>}
    {admin && editing !== undefined && <article className="form-panel"><div className="panel-heading"><h2>{editing ? translate("Edit tag") : translate("Create tag")}</h2><button onClick={() => setEditing(undefined)}>{translate("Cancel")}</button></div><form className="form-grid" onSubmit={save} key={editing?.id || 'new'}>
      <label>{translate("Device")}<select required disabled={!!editing} value={deviceID} onChange={e => setDeviceID(e.target.value)}><option value="">{translate("Select device")}</option>{devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label>{translate("Source protocol")}<input value={protocol} readOnly /></label>
      <label>{translate("Tag key")}<input name="key" required defaultValue={editing?.key} pattern="[a-zA-Z0-9_-]{1,64}" /></label>
      <label>{translate("Name")}<input name="name" required defaultValue={editing?.name} maxLength={200}/></label>
      <label>{translate("Data type")}<select name="data_type" defaultValue={editing?.data_type || 'float32'}>{['bool','int16','uint16','int32','uint32','float32','float64','string'].map(t => <option key={t} value={t}>{translate(t)}</option>)}</select></label>
      <label>{translate("Address / MQTT value key")}<input name="address" required={modbus} defaultValue={String(editing?.address ?? '')}/></label>
      <label>{translate("Function code")}<select name="function_code" defaultValue={String(editing?.function_code ?? (modbus ? 3 : ''))}><option value="">{translate("Not specified")}</option>{[1,2,3,4].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      {(['byte_order','word_order'] as const).map(key => <label key={key}>{key === 'byte_order' ? translate("Byte order") : translate("Word order")}<select name={key} defaultValue={String(editing?.[key] || 'BE')}><option value="BE">{translate("BE")}</option><option value="LE">{translate("LE")}</option></select></label>)}
      {numericFields.map(([label,key,value]) => <label key={key}>{translate(label)}<input name={key} type="number" step={key === 'stale_seconds' ? '1' : 'any'} min={key === 'stale_seconds' ? 1 : key === 'deadband' ? 0 : undefined} max={key === 'stale_seconds' ? 86400 : undefined} required defaultValue={Number(editing?.[key] ?? value)}/></label>)}
      <label>{translate("Unit")}<input name="unit" maxLength={32} defaultValue={String(editing?.unit || '')}/></label>
      <label>{translate("Poll override (ms)")}<input type="number" name="poll_interval_ms" min="100" max="86400000" step="1" defaultValue={editing?.poll_interval_ms == null ? '' : Number(editing.poll_interval_ms)}/></label>
      <label>{translate("Semantic")}<select name="semantic" defaultValue={String(editing?.semantic || '')}><option value="">{translate("Measurement")}</option><option value="run">{translate("Run state")}</option><option value="fault">{translate("Fault state")}</option></select></label>
      <label>{translate("Sample policy")}<select name="sample_policy" defaultValue={String(editing?.sample_policy || 'all')} onChange={e => { const history = e.currentTarget.form?.elements.namedItem('store_history') as HTMLInputElement | null; if (history) history.checked = e.currentTarget.value !== 'none'; }}><option value="all">{translate("Every sample")}</option><option value="on_change">{translate("On change")}</option><option value="none">{translate("Current state only")}</option></select></label>
      {switches.map(([label,key]) => <label className="inline-label" key={key}><input type="checkbox" name={key} defaultChecked={editing?.[key] !== false} onChange={key === 'store_history' ? e => { const policy = e.currentTarget.form?.elements.namedItem('sample_policy') as HTMLSelectElement | null; if (policy && e.currentTarget.checked && policy.value === 'none') policy.value = 'all'; else if (policy && !e.currentTarget.checked) policy.value = 'none'; } : undefined}/>{translate(label)}</label>)}
      <div className="form-actions"><button className="primary" disabled={busy || !deviceID}>{translate("Save tag")}</button></div>
    </form></article>}
    <article>{!tags.length ? <p className="muted">{translate("No tags configured.")}</p> : <div className="table-wrap"><table><thead><tr><th>{translate("Tag")}</th><th>{translate("Device")}</th><th>{translate("Data type")}</th><th>{translate("History / realtime")}</th><th>{translate("Quality")}</th><th/></tr></thead><tbody>{visibleTags.map(tag => <tr key={tag.id}><td><strong>{tag.name}</strong><small>{tag.key}</small></td><td>{devices.find(d => d.id === tag.device_id)?.name || tag.device_id}</td><td>{translate(tag.data_type)}</td><td>{tag.store_history ? translate("History") : translate("No history")} / {tag.realtime_enabled ? translate("Realtime") : translate("No realtime")}</td><td>{translate(String(tag.quality || 'UNCERTAIN'))}</td><td className="signal-row-actions">{admin && <><button disabled={busy} onClick={() => { setEditing(tag); setDeviceID(tag.device_id); setError(''); }} aria-label={translate("Edit {0}", { "0": tag.name })}>{translate("Edit")}</button><button disabled={busy} aria-label={translate("Test read {0}", { "0": tag.name })} onClick={() => void act(async () => {
      setReadings([]); const owner = devices.find(d => d.id === tag.device_id); if (!owner) throw new Error('Tag device is unavailable.');
      const result = await post<{ readings: typeof readings }>(`/connections/${owner.connection_id}/test-read`, { device_id: owner.id, tag_id: tag.id }); setReadings(result.readings || []);
    })}>{translate("Test read")}</button><button disabled={busy} aria-label={translate("Archive {0}", { "0": tag.name })} onClick={() => setArchive(tag)}>{translate("Archive")} </button></>}</td></tr>)}</tbody></table></div>}</article>
    {pages > 1 && <div className="filters signal-pagination"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{translate('Previous page')}</button><span>{translate('Page {0} of {1}', { 0: currentPage + 1, 1: pages })}</span><button disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>{translate('Next page')}</button></div>}
    {admin && archive && <article><p>{translate("Archive")}  {archive.name}{translate("? History will be retained.")}</p><button disabled={busy} onClick={() => void act(async () => { await request(`/tags/${archive.id}`, { method: 'DELETE', body: JSON.stringify({ confirm: true, history_policy: 'retain' }) }); await refresh(); setArchive(undefined); setMessage('Tag archived. History retained.'); })}>{translate("Confirm archive")}</button><button onClick={() => setArchive(undefined)}>{translate("Cancel archive")}</button></article>}
    {admin && readings.length > 0 && <article aria-label={translate("Test read result")}>{readings.map(r => <div key={r.tag_id}><strong>{tags.find(t => t.id === r.tag_id)?.name || r.tag_id}</strong><p>{translate("Raw:")}  {JSON.stringify(r.raw)}</p><p>{translate("Decoded:")}  {JSON.stringify(r.decoded)}</p><p>{translate("Scaled:")}  {JSON.stringify(r.scaled)}</p></div>)}</article>}
    {admin && <article className="form-panel"><h2>{translate("CSV import")}</h2><p className="muted">{translate("Required columns: device, tag, data_type. Device accepts an ID or unambiguous name. Preview validates every row; import revalidates atomically.")}</p>
      <label>{translate("CSV file")}<input type="file" accept=".csv,text/csv" disabled={busy} onChange={e => { const file=e.target.files?.[0]; if (!file) return; changeCSV(''); const version=csvVersion.current; void file.text().then(text => { if(version===csvVersion.current) changeCSV(text); }).catch(e => setError(errorMessage(e))); }}/></label>
      <label>{translate("CSV content")}<textarea rows={6} value={csv} onChange={e => changeCSV(e.target.value)}/></label>
      <button disabled={busy || !csv.trim()} onClick={() => void act(async () => { const source=csv; const version=csvVersion.current; setPreview(undefined); const result=await post<Preview>('/config/import/preview',{csv:source}); if(version===csvVersion.current) setPreview({source,result}); })}>{translate("Preview CSV")}</button>
      <button disabled={busy || !preview || preview.source !== csv || preview.result.errors.length > 0 || !preview.result.rows.length} onClick={() => void act(async () => { if (!preview || preview.source!==csv || preview.result.errors.length || !preview.result.rows.length) return; const result=await post<{imported:number}>('/config/import',{csv}); setPreview(undefined); await refresh(); setMessage(`Imported ${result.imported} tags.`); })}>{translate("Import CSV")}</button>
      {preview && <div><p>{preview.result.total} {translate("rows;")}  {preview.result.rows.length} {translate("valid.")}</p>{preview.result.errors.map((e,i) => <p className="error" key={i}>{translate("Row")}  {e.row}, {e.column}: {translate(e.message)}</p>)}<div className="table-wrap"><table><thead><tr><th>{translate("CSV row")}</th><th>{translate("Validated tag")}</th></tr></thead><tbody>{preview.result.rows.map(row => <tr key={row.row}><td>{row.row}</td><td><pre>{JSON.stringify(row.tag,null,2)}</pre></td></tr>)}</tbody></table></div></div>}
    </article>}
  </>;
}
