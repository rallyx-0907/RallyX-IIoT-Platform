import { useEffect, useState } from 'react';
import { request, errorMessage } from '../api/client';
import { duration, Empty, EventsTable, timeLabel } from '../components/DataDisplay';
import type { EventRecord, PlatformData, RuntimeSession, Sample } from '../types/platform';

function localDate(date: Date) { return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function Trend({ samples }: { samples: Sample[] }) {
  const numeric = samples.filter(sample => sample.quality === 'good' && typeof sample.value === 'number');
  if (!numeric.length) return <Empty title="No good-quality numeric samples" detail="Choose an analog tag and a time range with recorded data." />;
  const numbers = numeric.map(sample => Number(sample.value));
  const low = Math.min(...numbers), high = Math.max(...numbers);
  const start = Date.parse(samples[0].ts), end = Date.parse(samples[samples.length - 1].ts);
  const segments: string[][] = [[]];
  samples.forEach(sample => {
    if (sample.quality !== 'good' || typeof sample.value !== 'number') { if (segments[segments.length - 1].length) segments.push([]); return; }
    const x = 45 + (Date.parse(sample.ts) - start) / (end - start || 1) * 570;
    const y = 170 - (sample.value - low) / (high - low || 1) * 135;
    segments[segments.length - 1].push(`${x},${y}`);
  });
  return <div className="trend"><svg viewBox="0 0 650 210" role="img" aria-label="Analog telemetry trend"><defs><linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#28aa83" stopOpacity=".16" /><stop offset="100%" stopColor="#28aa83" stopOpacity="0" /></linearGradient></defs>{[35, 80, 125, 170].map(y => <line key={y} x1="45" x2="615" y1={y} y2={y} stroke="#e6edf2" strokeDasharray="4 4" />)}<text x="0" y="40">{high.toFixed(1)}</text><text x="0" y="174">{low.toFixed(1)}</text>{segments.filter(segment => segment.length).map((segment, index) => <g key={index}><polyline points={`${segment[0].split(',')[0]},170 ${segment.join(' ')} ${segment[segment.length - 1].split(',')[0]},170`} fill="url(#trend-fill)" stroke="none" /><polyline points={segment.join(' ')} fill="none" stroke="#1b9c76" strokeWidth="2.5" />{segment.length === 1 && <circle cx={segment[0].split(',')[0]} cy={segment[0].split(',')[1]} r="3" fill="#1b9c76" />}</g>)}<text x="45" y="200">{new Date(samples[0].ts).toLocaleTimeString()}</text><text x="615" y="200" textAnchor="end">{new Date(samples[samples.length - 1].ts).toLocaleTimeString()}</text></svg></div>;
}

export function History({ data }: { data: PlatformData }) {
  const [assetId, setAssetId] = useState(data.assets[0]?.id || '');
  const tags = data.tags.filter(tag => tag.asset_id === assetId);
  const [tagId, setTagId] = useState('');
  const selectedTag = tags.find(tag => tag.id === tagId) || tags[0];
  const [from, setFrom] = useState(localDate(new Date(Date.now() - 3600000)));
  const [to, setTo] = useState(localDate(new Date()));
  const [bucket, setBucket] = useState('');
  const [samples, setSamples] = useState<Sample[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [sessions, setSessions] = useState<RuntimeSession[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!assetId) return;
    const controller = new AbortController();
    async function load() {
      setBusy(true); setError('');
      try {
        if (!from || !to || new Date(to) <= new Date(from)) throw new Error('Choose a valid start and end time.');
        const range = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), limit: '2000' });
        const [history, events, runtime] = await Promise.all([
          selectedTag ? request<Sample[]>(`/tags/${selectedTag.id}/history?${range}${bucket ? `&bucket=${encodeURIComponent(bucket)}` : ''}`, { signal: controller.signal }) : Promise.resolve([]),
          request<EventRecord[]>(`/assets/${assetId}/events?${range}`, { signal: controller.signal }),
          request<RuntimeSession[]>(`/assets/${assetId}/runtime?${range}`, { signal: controller.signal }),
        ]);
        if (!controller.signal.aborted) { setSamples(history); setEvents(events); setSessions(runtime); }
      } catch (error) { if (!controller.signal.aborted) setError(errorMessage(error)); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }
    void load(); return () => controller.abort();
  }, [assetId, selectedTag?.id, from, to, bucket, revision]);
  function exportCsv() {
    const cell = (value: unknown) => { let text = String(value); if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; };
    const csv = ['timestamp,value,quality', ...samples.map(sample => [sample.ts, sample.value, sample.quality].map(cell).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `rallyx-history-${selectedTag?.id || 'samples'}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <><article className="filters"><label>Asset<select value={assetId} onChange={event => setAssetId(event.target.value)}>{data.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label><label>Tag<select value={selectedTag?.id || ''} onChange={event => setTagId(event.target.value)}>{tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label><label>From<input type="datetime-local" value={from} onChange={event => setFrom(event.target.value)} /></label><label>To<input type="datetime-local" value={to} onChange={event => setTo(event.target.value)} /></label><label>Resolution<select value={bucket} onChange={event => setBucket(event.target.value)}><option value="">Raw samples</option><option>1 minute</option><option>1 hour</option><option>1 day</option></select></label><button className="secondary" disabled={busy} onClick={() => setRevision(revision + 1)}>Apply</button></article>{error && <p className="error" role="alert">{error}</p>}
    <article className="spaced"><div className="panel-heading"><div><h2>{selectedTag?.name || 'Analog trend'}</h2><p className="muted">{busy ? 'Loading history…' : `${samples.length} samples · ${selectedTag?.unit || 'no unit'} · browser timezone`}</p></div><button className="secondary" onClick={exportCsv} disabled={!samples.length || busy}>↓ Export CSV</button></div><Trend samples={samples} /><p className="muted fineprint">Results are limited to 2,000 rows. Narrow the time range or select an aggregate resolution for longer periods. Bad-quality samples create gaps.</p></article>
    <div className="dashboard-bottom"><article><h2>Event timeline</h2><EventsTable events={events} /></article><article><h2>Runtime sessions</h2>{sessions.length ? <div className="table-wrap"><table><thead><tr><th>Type</th><th>Started</th><th>Duration</th></tr></thead><tbody>{sessions.map(session => <tr key={session.id}><td>{session.kind}<small>{session.ended_at ? 'Closed' : 'Open'}</small></td><td>{timeLabel(session.started_at)}</td><td>{duration(session.duration_seconds)}</td></tr>)}</tbody></table></div> : <Empty title="No runtime sessions in this period" />}</article></div></>;
}
