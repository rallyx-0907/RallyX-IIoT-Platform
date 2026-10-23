import { useState, type FormEvent } from 'react';
import { errorMessage, post, request } from '../api/client';
import { Empty } from '../components/DataDisplay';
import type { PlatformData, Rule, Tag, User } from '../types/platform';

export function Configuration({ mode, data, user, onRefresh }: { mode: string; data: PlatformData; user: User; onRefresh: () => Promise<void> }) {
  const rules = mode === 'rules';
  const [editing, setEditing] = useState<Tag | Rule | null>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const body: Record<string, unknown> = { name: form.get('name') };
      if (rules) {
        Object.assign(body, { type: form.get('type'), severity: form.get('severity'), enabled: form.get('enabled') === 'on', hysteresis: Number(form.get('hysteresis')), stale_seconds: Number(form.get('stale_seconds')) });
        if (form.get('type') === 'high' || form.get('type') === 'low') body.threshold = Number(form.get('threshold'));
        if (!editing) body.tag_id = form.get('tag_id');
      } else {
        Object.assign(body, { unit: form.get('unit'), scale: Number(form.get('scale')), sample_policy: form.get('sample_policy'), stale_seconds: Number(form.get('stale_seconds')), mapping: JSON.parse(String(form.get('mapping'))) });
        if (!editing) Object.assign(body, { asset_id: form.get('asset_id'), key: form.get('key'), datatype: form.get('datatype'), semantic: form.get('semantic') });
      }
      const path = rules ? '/rules' : '/tags';
      if (editing) await request(`${path}/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) }); else await post(path, body);
      await onRefresh(); setEditing(undefined);
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  const tag = !rules && editing ? editing as Tag : undefined;
  const rule = rules && editing ? editing as Rule : undefined;
  return <><div className="toolbar"><p className="muted">{rules ? 'Rules are evaluated and persisted by RallyX Core.' : 'Mappings define how normalized telemetry resolves to registered tags.'}</p>{user.role === 'admin' && <button className="primary" onClick={() => { setEditing(null); setError(''); }}>+ Add {rules ? 'rule' : 'tag'}</button>}</div>
    {editing !== undefined && <article className="form-panel"><div className="panel-heading"><h2>{editing ? 'Edit' : 'Create'} {rules ? 'rule' : 'tag'}</h2><button className="text-button" onClick={() => setEditing(undefined)}>Cancel</button></div>{error && <p className="error" role="alert">{error}</p>}<form onSubmit={save} className="form-grid" key={editing?.id || 'new'}><label>Name<input name="name" defaultValue={editing?.name} required maxLength={200} /></label>
      {rules ? <><label>Tag<select name="tag_id" defaultValue={rule?.tag_id} disabled={!!editing} required>{data.tags.map(item => <option key={item.id} value={item.id}>{data.assets.find(asset => asset.id === item.asset_id)?.name} / {item.name}</option>)}</select></label><label>Rule type<select name="type" defaultValue={rule?.type || 'fault'}><option value="fault">Boolean fault</option><option value="high">High threshold</option><option value="low">Low threshold</option><option value="stale">Communication stale</option></select></label><label>Threshold<input type="number" step="any" name="threshold" defaultValue={rule?.threshold ?? 0} /></label><label>Hysteresis<input type="number" step="any" min="0" name="hysteresis" defaultValue={rule?.hysteresis || 0} required /></label><label>Severity<select name="severity" defaultValue={rule?.severity || 'warning'}><option>info</option><option>warning</option><option>critical</option></select></label><label className="inline-label"><input type="checkbox" name="enabled" defaultChecked={rule?.enabled ?? true} />Enabled</label></> : <><label>Asset<select name="asset_id" defaultValue={tag?.asset_id} disabled={!!editing} required>{data.assets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Tag key<input name="key" defaultValue={tag?.key} disabled={!!editing} pattern="[a-zA-Z0-9_-]{1,64}" required /></label><label>Datatype<select name="datatype" defaultValue={tag?.datatype || 'number'} disabled={!!editing}><option>number</option><option>boolean</option><option>string</option></select></label><label>Semantic<select name="semantic" defaultValue={tag?.semantic || ''} disabled={!!editing}><option value="">Measurement</option><option value="run">Run state (boolean)</option><option value="fault">Fault state (boolean)</option></select></label><label>Unit<input name="unit" maxLength={32} defaultValue={tag?.unit || ''} /></label><label>Scale<input name="scale" type="number" step="any" defaultValue={tag?.scale ?? 1} required /></label><label>Sample policy<select name="sample_policy" defaultValue={tag?.sample_policy || 'all'}><option value="all">Every sample</option><option value="on_change">On change</option><option value="none">Current state only</option></select></label><label className="wide">Mapping (JSON object)<textarea name="mapping" defaultValue={JSON.stringify(tag?.mapping || {}, null, 2)} rows={4} required /></label></>}
      <label>Stale after (seconds)<input name="stale_seconds" type="number" min="1" max="86400" defaultValue={(rule || tag)?.stale_seconds || 30} required /></label><div className="form-actions"><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save configuration'}</button></div></form></article>}
    <article>{rules ? !data.rules.length ? <Empty title="No rules configured" /> : <div className="table-wrap"><table><thead><tr><th>Rule</th><th>Type</th><th>Threshold</th><th>Severity</th><th>Status</th><th /></tr></thead><tbody>{data.rules.map(item => <tr key={item.id}><td><strong>{item.name}</strong><small>{data.tags.find(tag => tag.id === item.tag_id)?.name}</small></td><td>{item.type}</td><td>{item.threshold ?? '—'}</td><td><span className={`badge badge-${item.severity}`}>{item.severity}</span></td><td>{item.enabled ? 'Enabled' : 'Disabled'}</td><td>{user.role === 'admin' && <button className="small-button" onClick={() => { setEditing(item); setError(''); }}>Edit</button>}</td></tr>)}</tbody></table></div> : !data.tags.length ? <Empty title="No tags configured" /> : <div className="table-wrap"><table><thead><tr><th>Tag</th><th>Asset</th><th>Datatype</th><th>Unit</th><th>Sampling</th><th /></tr></thead><tbody>{data.tags.map(item => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.key}</small></td><td>{data.assets.find(asset => asset.id === item.asset_id)?.name}</td><td>{item.datatype}</td><td>{item.unit || '—'}</td><td>{item.sample_policy}</td><td>{user.role === 'admin' && <button className="small-button" onClick={() => { setEditing(item); setError(''); }}>Edit</button>}</td></tr>)}</tbody></table></div>}</article>
  </>;
}
