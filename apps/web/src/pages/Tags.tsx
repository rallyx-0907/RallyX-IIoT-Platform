import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorMessage, post, request } from '../api/client';
import type { User } from '../types/platform';

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
    <div className="toolbar"><p className="muted">Device-owned tag mappings. Test read reads saved configuration; field writes are unavailable.</p><a href="/api/v1/config/tags.csv" download>Export tags CSV</a>{admin && <button className="primary" onClick={() => { setEditing(null); setDeviceID(devices[0]?.id || ''); setError(''); }}>Add tag</button>}</div>
    {error && <p role="alert" className="error">{error}</p>}{message && <p role="status">{message}</p>}
    {admin && editing !== undefined && <article className="form-panel"><div className="panel-heading"><h2>{editing ? 'Edit tag' : 'Create tag'}</h2><button onClick={() => setEditing(undefined)}>Cancel</button></div><form className="form-grid" onSubmit={save} key={editing?.id || 'new'}>
      <label>Device<select required disabled={!!editing} value={deviceID} onChange={e => setDeviceID(e.target.value)}><option value="">Select device</option>{devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label>Source protocol<input value={protocol} readOnly /></label>
      <label>Tag key<input name="key" required defaultValue={editing?.key} pattern="[a-zA-Z0-9_-]{1,64}" /></label>
      <label>Name<input name="name" required defaultValue={editing?.name} maxLength={200}/></label>
      <label>Data type<select name="data_type" defaultValue={editing?.data_type || 'float32'}>{['bool','int16','uint16','int32','uint32','float32','float64','string'].map(t => <option key={t}>{t}</option>)}</select></label>
      <label>Address / MQTT value key<input name="address" required={modbus} defaultValue={String(editing?.address ?? '')}/></label>
      <label>Function code<select name="function_code" defaultValue={String(editing?.function_code ?? (modbus ? 3 : ''))}><option value="">Not specified</option>{[1,2,3,4].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      {(['byte_order','word_order'] as const).map(key => <label key={key}>{key === 'byte_order' ? 'Byte order' : 'Word order'}<select name={key} defaultValue={String(editing?.[key] || 'BE')}><option>BE</option><option>LE</option></select></label>)}
      {numericFields.map(([label,key,value]) => <label key={key}>{label}<input name={key} type="number" step={key === 'stale_seconds' ? '1' : 'any'} min={key === 'stale_seconds' ? 1 : key === 'deadband' ? 0 : undefined} max={key === 'stale_seconds' ? 86400 : undefined} required defaultValue={Number(editing?.[key] ?? value)}/></label>)}
      <label>Unit<input name="unit" maxLength={32} defaultValue={String(editing?.unit || '')}/></label>
      <label>Poll override (ms)<input type="number" name="poll_interval_ms" min="100" max="86400000" step="1" defaultValue={editing?.poll_interval_ms == null ? '' : Number(editing.poll_interval_ms)}/></label>
      <label>Semantic<select name="semantic" defaultValue={String(editing?.semantic || '')}><option value="">Measurement</option><option value="run">Run state</option><option value="fault">Fault state</option></select></label>
      <label>Sample policy<select name="sample_policy" defaultValue={String(editing?.sample_policy || 'all')} onChange={e => { const history = e.currentTarget.form?.elements.namedItem('store_history') as HTMLInputElement | null; if (history) history.checked = e.currentTarget.value !== 'none'; }}><option value="all">Every sample</option><option value="on_change">On change</option><option value="none">Current state only</option></select></label>
      {switches.map(([label,key]) => <label className="inline-label" key={key}><input type="checkbox" name={key} defaultChecked={editing?.[key] !== false} onChange={key === 'store_history' ? e => { const policy = e.currentTarget.form?.elements.namedItem('sample_policy') as HTMLSelectElement | null; if (policy && e.currentTarget.checked && policy.value === 'none') policy.value = 'all'; else if (policy && !e.currentTarget.checked) policy.value = 'none'; } : undefined}/>{label}</label>)}
      <div className="form-actions"><button className="primary" disabled={busy || !deviceID}>Save tag</button></div>
    </form></article>}
    <article>{!tags.length ? <p className="muted">No tags configured.</p> : <div className="table-wrap"><table><thead><tr><th>Tag</th><th>Device</th><th>Data type</th><th>History / realtime</th><th>Quality</th><th/></tr></thead><tbody>{tags.map(tag => <tr key={tag.id}><td><strong>{tag.name}</strong><small>{tag.key}</small></td><td>{devices.find(d => d.id === tag.device_id)?.name || tag.device_id}</td><td>{tag.data_type}</td><td>{tag.store_history ? 'History' : 'No history'} / {tag.realtime_enabled ? 'Realtime' : 'No realtime'}</td><td>{String(tag.quality || 'UNCERTAIN')}</td><td>{admin && <><button disabled={busy} onClick={() => { setEditing(tag); setDeviceID(tag.device_id); setError(''); }} aria-label={`Edit ${tag.name}`}>Edit</button><button disabled={busy} aria-label={`Test read ${tag.name}`} onClick={() => void act(async () => {
      setReadings([]); const owner = devices.find(d => d.id === tag.device_id); if (!owner) throw new Error('Tag device is unavailable.');
      const result = await post<{ readings: typeof readings }>(`/connections/${owner.connection_id}/test-read`, { device_id: owner.id, tag_id: tag.id }); setReadings(result.readings || []);
    })}>Test read</button><button disabled={busy} aria-label={`Archive ${tag.name}`} onClick={() => setArchive(tag)}>Archive</button></>}</td></tr>)}</tbody></table></div>}</article>
    {admin && archive && <article><p>Archive {archive.name}? History will be retained.</p><button disabled={busy} onClick={() => void act(async () => { await request(`/tags/${archive.id}`, { method: 'DELETE', body: JSON.stringify({ confirm: true, history_policy: 'retain' }) }); await refresh(); setArchive(undefined); setMessage('Tag archived. History retained.'); })}>Confirm archive</button><button onClick={() => setArchive(undefined)}>Cancel archive</button></article>}
    {admin && readings.length > 0 && <article aria-label="Test read result">{readings.map(r => <div key={r.tag_id}><strong>{tags.find(t => t.id === r.tag_id)?.name || r.tag_id}</strong><p>Raw: {JSON.stringify(r.raw)}</p><p>Decoded: {JSON.stringify(r.decoded)}</p><p>Scaled: {JSON.stringify(r.scaled)}</p></div>)}</article>}
    {admin && <article className="form-panel"><h2>CSV import</h2><p className="muted">Required columns: device, tag, data_type. Device accepts an ID or unambiguous name. Preview validates every row; import revalidates atomically.</p>
      <label>CSV file<input type="file" accept=".csv,text/csv" disabled={busy} onChange={e => { const file=e.target.files?.[0]; if (!file) return; changeCSV(''); const version=csvVersion.current; void file.text().then(text => { if(version===csvVersion.current) changeCSV(text); }).catch(e => setError(errorMessage(e))); }}/></label>
      <label>CSV content<textarea rows={6} value={csv} onChange={e => changeCSV(e.target.value)}/></label>
      <button disabled={busy || !csv.trim()} onClick={() => void act(async () => { const source=csv; const version=csvVersion.current; setPreview(undefined); const result=await post<Preview>('/config/import/preview',{csv:source}); if(version===csvVersion.current) setPreview({source,result}); })}>Preview CSV</button>
      <button disabled={busy || !preview || preview.source !== csv || preview.result.errors.length > 0 || !preview.result.rows.length} onClick={() => void act(async () => { if (!preview || preview.source!==csv || preview.result.errors.length || !preview.result.rows.length) return; const result=await post<{imported:number}>('/config/import',{csv}); setPreview(undefined); await refresh(); setMessage(`Imported ${result.imported} tags.`); })}>Import CSV</button>
      {preview && <div><p>{preview.result.total} rows; {preview.result.rows.length} valid.</p>{preview.result.errors.map((e,i) => <p className="error" key={i}>Row {e.row}, {e.column}: {e.message}</p>)}<div className="table-wrap"><table><thead><tr><th>CSV row</th><th>Validated tag</th></tr></thead><tbody>{preview.result.rows.map(row => <tr key={row.row}><td>{row.row}</td><td><pre>{JSON.stringify(row.tag,null,2)}</pre></td></tr>)}</tbody></table></div></div>}
    </article>}
  </>;
}
