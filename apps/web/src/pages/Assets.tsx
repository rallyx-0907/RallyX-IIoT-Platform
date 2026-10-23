import { useState, type FormEvent } from 'react';
import { post, errorMessage } from '../api/client';
import { duration, Empty, TagsTable } from '../components/DataDisplay';
import type { PlatformData, User } from '../types/platform';

export function Assets({ data, selected, onSelect, offline, user, onRefresh }: { data: PlatformData; selected: string; onSelect: (id: string) => void; offline: boolean; user: User; onRefresh: () => Promise<void> }) {
  const asset = data.assets.find(asset => asset.id === selected) || data.assets[0];
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget); try { await post('/assets', { panel_id: form.get('panel_id'), name: form.get('name'), type: form.get('type') }); await onRefresh(); setAdding(false); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }
  return <><div className="toolbar">{user.role === 'admin' && <button className="primary" onClick={() => setAdding(!adding)}>+ Add asset</button>}</div>
    {adding && <article className="form-panel"><h2>Add equipment</h2>{error && <p role="alert" className="error">{error}</p>}<form onSubmit={create} className="form-grid"><label>Name<input name="name" required maxLength={200} /></label><label>Panel<select name="panel_id" required>{data.tree.flatMap(site => site.areas.flatMap(area => area.panels.map(panel => <option key={panel.id} value={panel.id}>{site.name} / {area.name} / {panel.name}</option>)))}</select></label><label>Equipment type<input name="type" defaultValue="equipment" required /></label><button disabled={busy} className="primary">{busy ? 'Saving…' : 'Create asset'}</button></form></article>}
    <div className="asset-workspace"><article className="asset-tree"><p className="eyebrow">ASSET HIERARCHY</p>{!data.tree.length && <Empty title="No sites configured" />}{data.tree.map(site => <div key={site.id}><h3>▧ {site.name}</h3>{site.areas.map(area => <div className="tree-area" key={area.id}><strong>{area.name}</strong>{area.panels.map(panel => <div key={panel.id}><p>{panel.name}</p>{panel.assets.map(item => <button key={item.id} className={item.id === asset?.id ? 'selected' : ''} onClick={() => onSelect(item.id)}>◇ {item.name}</button>)}</div>)}</div>)}</div>)}</article>
      {asset ? <div><article><div className="panel-heading"><div><p className="eyebrow">{asset.type}</p><h2>{asset.name}</h2></div><span className={`badge badge-${offline ? 'unknown' : asset.operating_state.toLowerCase()}`}>{offline ? 'UNKNOWN' : asset.operating_state}</span></div><p className="muted">{asset.area_name} / {asset.panel_name}</p><div className="detail-metrics"><div><small>Runtime today</small><strong>{duration(asset.runtime_today_seconds)}</strong></div><div><small>Start count</small><strong>{asset.start_count}</strong></div><div><small>Fault count</small><strong>{asset.fault_count}</strong></div></div><p className="muted fineprint">Asset ID: {asset.id}</p></article><article className="spaced"><h2>Configured tags</h2><TagsTable tags={data.tags.filter(tag => tag.asset_id === asset.id)} offline={offline} /></article></div> : <article><Empty title="No assets configured" /></article>}
    </div></>;
}
