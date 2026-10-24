import { useState, type FormEvent } from 'react';
import { post, errorMessage } from '../api/client';
import { duration, Empty, TagsTable } from '../components/DataDisplay';
import type { PlatformData, User } from '../types/platform';

export function Assets({ data, selected, onSelect, offline, user, onRefresh }: { data: PlatformData; selected: string; onSelect: (id: string) => void; offline: boolean; user: User; onRefresh: () => Promise<void> }) {
  const asset = data.assets.find(asset => asset.id === selected) || data.assets[0];
  const [adding, setAdding] = useState<'site' | 'area' | 'asset'>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try { const body: Record<string, unknown> = { name: form.get('name') }; if (adding === 'asset') Object.assign(body, { area_id: form.get('area_id'), type: form.get('type') }); if (adding === 'area') body.site_id = form.get('site_id'); await post('/' + (adding === 'site' ? 'sites' : adding === 'area' ? 'areas' : 'assets'), body); await onRefresh(); setAdding(undefined); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <><div className="toolbar">{user.role === 'admin' && <><button className="secondary" disabled={busy} onClick={() => setAdding('site')}>+ Add site</button><button className="secondary" disabled={busy || !data.tree.length} onClick={() => setAdding('area')}>+ Add area</button><button className="primary" disabled={busy || !data.tree.some(site => site.areas.length)} onClick={() => setAdding('asset')}>+ Add asset</button></>}</div>
    {adding && <article className="form-panel"><div className="panel-heading"><h2>Add {adding}</h2><button className="secondary" disabled={busy} onClick={() => setAdding(undefined)}>Cancel</button></div>{error && <p role="alert" className="error">{error}</p>}<form onSubmit={create} className="form-grid"><label>Name<input name="name" required maxLength={200} /></label>{adding === 'asset' && <><label>Area<select name="area_id" required>{data.tree.flatMap(site => site.areas.map(area => <option key={area.id} value={area.id}>{site.name} / {area.name}</option>))}</select></label><label>Equipment type<input name="type" defaultValue="equipment" required /></label></>}{adding === 'area' && <label>Site<select name="site_id" required>{data.tree.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>}<button disabled={busy} className="primary">{busy ? 'Saving…' : 'Create ' + adding}</button></form></article>}
    <div className="asset-workspace"><article className="asset-tree"><p className="eyebrow">ASSET HIERARCHY</p>{!data.tree.length && <Empty title="No sites configured" />}{data.tree.map(site => <div key={site.id}><h3>{site.name}</h3>{site.areas.map(area => <div className="tree-area" key={area.id}><strong>{area.name}</strong>{area.assets.map(item => <div key={item.id}><button className={item.id === asset?.id ? 'selected' : ''} onClick={() => onSelect(item.id)}>{item.name}</button>{item.devices.map(device => <details key={device.id} open><summary>{device.name}</summary><ul>{device.tags.map(tag => <li key={tag.id}>{tag.name}<small>{tag.key} · {tag.data_type}</small></li>)}</ul></details>)}</div>)}</div>)}</div>)}</article>
      {asset ? <div><article><div className="panel-heading"><div><p className="eyebrow">{asset.type}</p><h2>{asset.name}</h2></div><span className={`badge badge-${offline ? 'unknown' : asset.operating_state.toLowerCase()}`}>{offline ? 'UNKNOWN' : asset.operating_state}</span></div><p className="muted">{asset.area_name}</p><div className="detail-metrics"><div><small>Runtime today</small><strong>{duration(asset.runtime_today_seconds)}</strong></div><div><small>Start count</small><strong>{asset.start_count}</strong></div><div><small>Fault count</small><strong>{asset.fault_count}</strong></div></div><p className="muted fineprint">Asset ID: {asset.id}</p></article><article className="spaced"><h2>Configured tags</h2><TagsTable tags={data.tags.filter(tag => tag.asset_id === asset.id)} offline={offline} /></article></div> : <article><Empty title="No assets configured" /></article>}
    </div></>;
}
