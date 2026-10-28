import { useState, type FormEvent } from 'react';
import { post, errorMessage } from '../api/client';
import { duration, Empty, TagsTable } from '../components/DataDisplay';
import { t } from '../i18n';
import type { PlatformData, TreeDevice, User } from '../types/platform';
import '../hierarchy.css';

function DeviceBranch({ device }: { device: TreeDevice }) {
  const [expanded, setExpanded] = useState(true);
  return <li className="hierarchy-device">
    <span className="hierarchy-level">{t('Device')}</span>
    <button type="button" className="hierarchy-device-toggle" aria-expanded={expanded} aria-controls={`device-tags-${device.id}`} onClick={() => setExpanded(!expanded)}>
      <svg aria-hidden="true" className={`hierarchy-chevron ${expanded ? 'is-expanded' : ''}`} viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m6 3 5 5-5 5" /></svg><span>{device.name}</span>
    </button>
    {expanded && <ul id={`device-tags-${device.id}`} className="hierarchy-tags" aria-label={t('Tags')}>
      {device.tags.map(tag => <li key={tag.id} className="hierarchy-tag"><span className="hierarchy-tag-name">{tag.name}</span><small className="hierarchy-tag-meta">{tag.key} · {tag.data_type}</small></li>)}
      {!device.tags.length && <li className="hierarchy-empty">{t('No tags configured')}</li>}
    </ul>}
  </li>;
}

export function Assets({ data, selected, onSelect, offline, user, onRefresh }: { data: PlatformData; selected: string; onSelect: (id: string) => void; offline: boolean; user: User; onRefresh: () => Promise<void> }) {
  const asset = data.assets.find(asset => asset.id === selected) || data.assets[0];
  const [adding, setAdding] = useState<'site' | 'area' | 'asset'>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const addTitle = adding === 'site' ? t('Add site') : adding === 'area' ? t('Add area') : t('Add asset');
  const createTitle = adding === 'site' ? t('Create site') : adding === 'area' ? t('Create area') : t('Create asset');
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try { const body: Record<string, unknown> = { name: form.get('name') }; if (adding === 'asset') Object.assign(body, { area_id: form.get('area_id'), type: form.get('type') }); if (adding === 'area') body.site_id = form.get('site_id'); await post('/' + (adding === 'site' ? 'sites' : adding === 'area' ? 'areas' : 'assets'), body); await onRefresh(); setAdding(undefined); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <><div className="toolbar">{user.role === 'admin' && <><button className="secondary" disabled={busy} onClick={() => setAdding('site')}>{t('+ Add site')}</button><button className="secondary" disabled={busy || !data.tree.length} onClick={() => setAdding('area')}>{t('+ Add area')}</button><button className="primary" disabled={busy || !data.tree.some(site => site.areas.length)} onClick={() => setAdding('asset')}>{t('+ Add asset')}</button></>}</div>
    {adding && <article className="form-panel"><div className="panel-heading"><h2>{addTitle}</h2><button className="secondary" disabled={busy} onClick={() => setAdding(undefined)}>{t('Cancel')}</button></div>{error && <p role="alert" className="error">{t(error)}</p>}<form onSubmit={create} className="form-grid"><label>{t('Name')}<input name="name" required maxLength={200} /></label>{adding === 'asset' && <><label>{t('Area')}<select name="area_id" required>{data.tree.flatMap(site => site.areas.map(area => <option key={area.id} value={area.id}>{site.name} / {area.name}</option>))}</select></label><label>{t('Equipment type')}<input name="type" defaultValue="equipment" required /></label></>}{adding === 'area' && <label>{t('Site')}<select name="site_id" required>{data.tree.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>}<button disabled={busy} className="primary">{busy ? t('Saving…') : createTitle}</button></form></article>}
    <div className="asset-workspace"><article className="asset-tree hierarchy-panel"><p className="eyebrow">{t('ASSET HIERARCHY')}</p><nav className="hierarchy-navigation" aria-label={t('Asset hierarchy')}>
      {!data.tree.length && <Empty title={t('No sites configured')} />}
      <ul className="hierarchy-sites">{data.tree.map(site => <li className="hierarchy-site" key={site.id}>
        <span className="hierarchy-level">{t('Site')}</span><h3>{site.name}</h3>
        <ul className="hierarchy-areas">{site.areas.map(area => <li className="hierarchy-area" key={area.id}>
          <span className="hierarchy-level">{t('Area')}</span><strong className="hierarchy-area-name">{area.name}</strong>
          <ul className="hierarchy-assets">{area.assets.map(item => <li className="hierarchy-asset" key={item.id}>
            <span className="hierarchy-level">{t('Asset')}</span><button type="button" className={`hierarchy-asset-select ${item.id === (selected || asset?.id) ? 'selected' : ''}`} aria-current={item.id === (selected || asset?.id) ? 'true' : undefined} onClick={() => onSelect(item.id)}>{item.name}</button>
            <ul className="hierarchy-devices">{item.devices.map(device => <DeviceBranch key={device.id} device={device} />)}</ul>
          </li>)}</ul>
        </li>)}</ul>
      </li>)}</ul>
    </nav></article>
      {asset ? <div><article><div className="panel-heading"><div><p className="eyebrow">{asset.type}</p><h2>{asset.name}</h2></div><span className={`badge badge-${offline ? 'unknown' : asset.operating_state.toLowerCase()}`}>{t(offline ? 'UNKNOWN' : asset.operating_state)}</span></div><p className="muted">{asset.area_name}</p><div className="detail-metrics"><div><small>{t('Runtime today')}</small><strong>{duration(asset.runtime_today_seconds)}</strong></div><div><small>{t('Start count')}</small><strong>{asset.start_count}</strong></div><div><small>{t('Fault count')}</small><strong>{asset.fault_count}</strong></div></div><p className="muted fineprint">{t('Asset ID: {id}', { id: asset.id })}</p></article><article className="spaced"><h2>{t('Configured tags')}</h2><TagsTable tags={data.tags.filter(tag => tag.asset_id === asset.id)} offline={offline} /></article></div> : <article><Empty title={t('No assets configured')} /></article>}
    </div></>;
}
