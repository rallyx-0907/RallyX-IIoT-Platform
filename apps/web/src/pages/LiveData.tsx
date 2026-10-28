import { t as translate } from '../i18n';
import { useEffect, useState } from 'react';
import { Empty, QualityBadge, TagsTable, timeLabel } from '../components/DataDisplay';
import type { PlatformData, Tag } from '../types/platform';

type Tone = 'good' | 'stopped' | 'fault' | 'unknown' | 'signal';

function qualityOf(tag: Tag, offline: boolean, now: number) {
  if (offline) return 'STALE';
  if (tag.value === undefined || tag.value === null || !tag.ts || !Number.isFinite(Date.parse(tag.ts))) return 'UNKNOWN';
  if (now - Date.parse(tag.ts) > tag.stale_seconds * 1000) return 'STALE';
  return tag.quality.toUpperCase();
}

function reading(tag: Tag, quality: string): { label: string; tone: Tone } {
  if (tag.value === undefined || tag.value === null) return { label: translate('No reading'), tone: 'unknown' };
  if (quality !== 'GOOD') return { label: String(tag.value), tone: 'unknown' };
  if (typeof tag.value === 'boolean') {
    if (tag.semantic === 'fault') return { label: translate(tag.value ? 'Fault active' : 'No fault'), tone: tag.value ? 'fault' : 'good' };
    if (tag.semantic === 'run') return { label: translate(tag.value ? 'Running' : 'Stopped'), tone: tag.value ? 'good' : 'stopped' };
    return { label: translate(tag.value ? 'ON' : 'OFF'), tone: 'signal' };
  }
  return { label: String(tag.value), tone: 'signal' };
}

function deviceState(tags: Tag[], offline: boolean, now: number): { label: string; tone: Tone } {
  const fresh = tags.filter(tag => qualityOf(tag, offline, now) === 'GOOD');
  if (fresh.some(tag => tag.semantic === 'fault' && tag.value === true)) return { label: translate('Fault'), tone: 'fault' };
  if (fresh.length !== tags.length) return { label: translate('Check data'), tone: 'unknown' };
  const run = fresh.find(tag => tag.semantic === 'run' && typeof tag.value === 'boolean');
  if (run) return { label: translate(run.value ? 'Running' : 'Stopped'), tone: run.value ? 'good' : 'stopped' };
  return { label: translate('Receiving data'), tone: 'signal' };
}

export function LiveData({ data, offline }: { data: PlatformData; offline: boolean }) {
  const [assetId, setAssetId] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [now, setNow] = useState(Date.now);
  const [technical, setTechnical] = useState(false);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const visible = data.tags.filter(tag => tag.realtime_enabled !== false && tag.enabled !== false && (!assetId || tag.asset_id === assetId));
  const devices = new Map(visible.map(tag => [tag.device_id, tag.device_name || tag.device_id]));
  const filtered = visible.filter(tag => !deviceId || tag.device_id === deviceId);
  const groups = new Map<string, Tag[]>();
  for (const tag of filtered) {
    const key = JSON.stringify([tag.asset_id, tag.device_id]);
    const group = groups.get(key);
    if (group) group.push(tag); else groups.set(key, [tag]);
  }
  const good = filtered.filter(tag => qualityOf(tag, offline, now) === 'GOOD').length;
  return <div className="live-monitor">
    <article className="live-toolbar"><div><h2>{translate("Equipment monitor")}</h2><p className="muted">{translate("Operating states and measurements, grouped by device.")}</p></div><div className="filters">
      <label>{translate("Filter by asset")}<select value={assetId} onChange={event => { setAssetId(event.target.value); setDeviceId(''); }}><option value="">{translate("All assets")}</option>{data.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
      <label>{translate("Filter by device")}<select value={deviceId} onChange={event => setDeviceId(event.target.value)}><option value="">{translate("All devices")}</option>{Array.from(devices).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    </div></article>
    <div className="live-summary" aria-label={translate("Monitoring summary")}><span><strong>{groups.size}</strong> {translate("devices shown")}</span><span className="summary-good"><i /> <strong>{good}</strong> {translate("fresh signals")}</span><span className={good < filtered.length ? 'summary-warning' : ''}><strong>{filtered.length - good}</strong> {translate("signals need attention")}</span><span className="muted">{offline ? translate("Disconnected · last known readings") : translate("Updates automatically")}</span></div>
    {!filtered.length ? <article><Empty title={translate("No tags configured")} detail="No realtime signals match these filters. Enable tags or choose another device." /></article> : <div className="live-devices">{Array.from(groups, ([key, tags]) => {
      const first = tags[0];
      const name = first.device_name || first.device_id;
      const asset = data.assets.find(asset => asset.id === first.asset_id);
      const state = deviceState(tags, offline, now);
      return <article key={key} role="region" aria-label={name} className={`live-device tone-${state.tone}`}>
        <div className="live-device-heading"><div><p className="live-asset">{asset?.name || first.asset_id}</p><h2>{name}</h2></div><span className={`operating-state tone-${state.tone}`}><i />{state.label}</span></div>
        <div className="live-readings">{tags.map(tag => {
          const quality = qualityOf(tag, offline, now);
          const value = reading(tag, quality);
          return <div key={tag.id} className={`live-reading tone-${value.tone}`}>
            <div className="live-reading-heading"><h3>{tag.name}</h3><QualityBadge quality={quality} /></div>
            <div className="live-value"><strong>{value.label}</strong>{tag.unit && <span>{tag.unit}</span>}</div>
            {quality !== 'GOOD' && tag.value !== undefined && tag.value !== null && <span className="last-known">{translate("Last known")}</span>}
            <div className="live-reading-foot"><span>{tag.key}</span><time dateTime={tag.ts && Number.isFinite(Date.parse(tag.ts)) ? tag.ts : undefined}>{tag.ts && Number.isFinite(Date.parse(tag.ts)) ? timeLabel(tag.ts) : translate("Never received")}</time></div>
          </div>;
        })}</div>
      </article>;
    })}</div>}
    {filtered.length > 0 && <div className="live-details"><button type="button" className="secondary" aria-expanded={technical} onClick={() => setTechnical(!technical)}>{technical ? translate("Hide signal details") : translate("Show signal details")}</button>{technical && <article className="spaced"><h2>{translate("Signal details")}</h2><TagsTable tags={filtered} offline={offline} /></article>}</div>}
  </div>;
}
