import { useEffect, useState } from 'react';
import { request, errorMessage } from '../api/client';
import { AlarmsTable } from '../components/DataDisplay';
import type { Alarm, PlatformData, User } from '../types/platform';

export function Alarms({ data, user, onAck }: { data: PlatformData; user: User; onAck: (id: number) => void }) {
  const [history, setHistory] = useState(false);
  const [asset, setAsset] = useState('');
  const [records, setRecords] = useState<Alarm[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { if (!history) return; let live = true; request<Alarm[]>('/alarms/history?limit=2000').then(result => { if (live) { setRecords(result); setError(''); } }).catch(error => { if (live) setError(errorMessage(error)); }); return () => { live = false; }; }, [history]);
  return <article><div className="panel-heading"><div className="tabs"><button className={!history ? 'active' : ''} onClick={() => setHistory(false)}>Active <span>{data.alarms.length}</span></button><button className={history ? 'active' : ''} onClick={() => setHistory(true)}>History · last 24h</button></div><select aria-label="Filter alarms by asset" value={asset} onChange={event => setAsset(event.target.value)}><option value="">All assets</option>{data.assets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>{error && <p className="error" role="alert">{error}</p>}<AlarmsTable alarms={(history ? records : data.alarms).filter(item => !asset || item.asset_id === asset)} canAck={!history && user.role !== 'viewer'} onAck={onAck} /></article>;
}
