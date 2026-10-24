import { useState } from 'react';
import { TagsTable } from '../components/DataDisplay';
import type { PlatformData } from '../types/platform';

export function LiveData({ data, offline }: { data: PlatformData; offline: boolean }) {
  const [assetId, setAssetId] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const visible = data.tags.filter(tag => tag.realtime_enabled !== false && tag.enabled !== false && (!assetId || tag.asset_id === assetId));
  const devices = new Map(visible.map(tag => [tag.device_id, tag.device_name || tag.device_id]));
  return <article><div className="panel-heading"><h2>Field telemetry</h2><div className="toolbar"><label>Filter by asset<select value={assetId} onChange={event => { setAssetId(event.target.value); setDeviceId(''); }}><option value="">All assets</option>{data.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label><label>Filter by device<select value={deviceId} onChange={event => setDeviceId(event.target.value)}><option value="">All devices</option>{Array.from(devices).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div></div><TagsTable tags={visible.filter(tag => !deviceId || tag.device_id === deviceId)} offline={offline} /></article>;
}
