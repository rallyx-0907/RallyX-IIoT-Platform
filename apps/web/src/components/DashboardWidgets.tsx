import { t as translate, getLocale } from '../i18n';
import { useEffect, useState } from 'react';
import { errorMessage, post, request } from '../api/client';

type Tag = { id: string; name?: string; tag_name?: string; datatype?: string; data_type?: string; unit?: string; store_history?: boolean; realtime_enabled?: boolean; enabled?: boolean; tag_enabled?: boolean; archived?: boolean; deleted_at?: string; stale_seconds?: number; quality?: string; value?: unknown; ts?: string; device_name?: string; asset_name?: string };
type Widget = Tag & { tag_id: string; type: string; title?: string; settings?: { range_minutes?: number; precision?: number; show_unit?: boolean } };
type Sample = { ts: string; value: unknown; quality: string };
const numeric = (tag: Tag) => tag.datatype === 'number' || /^(u?int(16|32|64)?|float(32|64)?|double|number)$/.test(tag.data_type || '');
const boolean = (tag: Tag) => tag.datatype === 'boolean' || ['boolean', 'bool'].includes(tag.data_type || '');

function WidgetTrend({ widget, offline, revision }: { widget: Widget; offline: boolean; revision: number }) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const minutes = Math.max(1, Math.min(10080, Math.trunc(widget.settings?.range_minutes || 60)));
  const allowed = numeric(widget) && widget.store_history === true && !widget.archived;
  useEffect(() => {
    const controller = new AbortController();
    setSamples([]); setError('');
    if (!allowed || offline) return () => controller.abort();
    setBusy(true);
    const to = new Date();
    const query = new URLSearchParams({ from: new Date(to.getTime() - minutes * 60000).toISOString(), to: to.toISOString(), limit: '1000' });
    void request<Sample[]>(`/tags/${encodeURIComponent(widget.tag_id)}/history?${query}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setSamples(result); })
      .catch(reason => { if (!controller.signal.aborted) setError(errorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [widget.tag_id, minutes, allowed, offline, revision]);
  if (!allowed) return <p>{translate("Trend unavailable: numeric history must be enabled.")}</p>;
  if (offline) return <p>{translate("History unavailable while offline.")}</p>;
  if (error) return <p role="alert">{translate(error)}</p>;
  if (busy) return <p>{translate("Loading trend…")}</p>;
  const good = samples.filter(sample => sample.quality?.toUpperCase() === 'GOOD' && typeof sample.value === 'number' && Number.isFinite(sample.value) && Number.isFinite(Date.parse(sample.ts)));
  if (!good.length) return <p>{translate("No good-quality numeric history.")}</p>;
  const low = Math.min(...good.map(sample => Number(sample.value))), high = Math.max(...good.map(sample => Number(sample.value)));
  const times = good.map(sample => Date.parse(sample.ts));
  const start = Math.min(...times), end = Math.max(...times);
  const segments: string[][] = [[]];
  samples.forEach(sample => {
    if (sample.quality?.toUpperCase() !== 'GOOD' || typeof sample.value !== 'number' || !Number.isFinite(sample.value) || !Number.isFinite(Date.parse(sample.ts))) { if (segments.at(-1)!.length) segments.push([]); return; }
    segments.at(-1)!.push(`${10 + (Date.parse(sample.ts) - start) / (end - start || 1) * 280},${90 - (sample.value - low) / (high - low || 1) * 80}`);
  });
  return <><svg viewBox="0 0 300 100" role="img" aria-label={translate("{0} trend", { "0": widget.tag_name || widget.name })}>{segments.filter(segment => segment.length).map((segment, i) => <g key={i}><polyline points={segment.join(' ')} fill="none" stroke="currentColor" strokeWidth="2" />{segment.length === 1 && <circle cx={segment[0].split(',')[0]} cy={segment[0].split(',')[1]} r="3" />}</g>)}</svg><p className="muted">{minutes} {translate("minutes ·")}  {samples.length} {translate("samples · maximum 1,000 · bad quality creates gaps")}</p></>;
}

export function DashboardWidgets({ offline = false }: { offline?: boolean }) {
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagId, setTagId] = useState('');
  const [kind, setKind] = useState('value');
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (offline) return;
    const timer = window.setInterval(() => setRevision(value => value + 1), 15000);
    return () => window.clearInterval(timer);
  }, [offline]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void Promise.all([request<Widget[]>('/dashboard', { signal: controller.signal }), request<Tag[]>('/tags', { signal: controller.signal })])
      .then(([saved, available]) => { if (!controller.signal.aborted) { setWidgets(saved || []); setTags((available || []).filter(tag => !tag.archived && !tag.deleted_at)); } })
      .catch(reason => { if (!controller.signal.aborted) setError(errorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  const selected = tags.find(tag => tag.id === tagId) || tags[0];
  const kinds = ['value', ...(selected && boolean(selected) ? ['status'] : []), ...(selected && numeric(selected) && selected.store_history ? ['trend'] : [])];
  const effectiveKind = kinds.includes(kind) ? kind : 'value';
  async function mutate(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); setRevision(value => value + 1); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }
  return <section aria-label={translate("My dashboard")}><div className="panel-heading"><h2>{translate("My dashboard")}</h2><button className="secondary" disabled={busy || loading} onClick={() => setRevision(value => value + 1)}>{translate("Refresh widgets")}</button></div>
    <form className="filters" onSubmit={event => { event.preventDefault(); if (selected) void mutate(() => post('/dashboard', { tag_id: selected.id, type: effectiveKind, title, position: widgets.length, settings: effectiveKind === 'trend' ? { range_minutes: minutes } : {} })); }}>
      <label>{translate("Pin tag")}<select value={selected?.id || ''} onChange={event => setTagId(event.target.value)}>{tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name || tag.id}</option>)}</select></label>
      <label>{translate("Widget type")}<select value={effectiveKind} onChange={event => setKind(event.target.value)}>{kinds.map(type => <option key={type} value={type}>{translate(type[0].toUpperCase() + type.slice(1))}</option>)}</select></label>
      <label>{translate("Widget title")}<input value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></label>
      {effectiveKind === 'trend' && <label>{translate("Range (minutes)")}<input type="number" min={1} max={10080} step={1} required value={minutes} onChange={event => setMinutes(Number(event.target.value))} /></label>}
      <button disabled={!selected || busy || loading || offline}>{translate("Pin to Dashboard")}</button>
    </form>
    {error && <p className="error" role="alert">{translate(error)}</p>}{loading && <p>{translate("Loading widgets…")}</p>}{!loading && !widgets.length && <p>{translate("No pinned widgets yet.")}</p>}
    <div className="dashboard-bottom">{widgets.map(widget => {
      const name = widget.title || widget.tag_name || widget.name || widget.tag_id;
      const metadata = tags.find(tag => tag.id === widget.tag_id);
      const item = { ...metadata, ...widget };
      const stale = offline || widget.archived || item.tag_enabled === false || item.enabled === false || item.realtime_enabled === false || item.quality?.toUpperCase() !== 'GOOD' || !item.ts || !Number.isFinite(Date.parse(item.ts)) || Date.now() - Date.parse(item.ts) > (item.stale_seconds || 60) * 1000;
      const value = stale || item.value == null ? 'Unavailable' : typeof item.value === 'number' ? Number.isFinite(item.value) ? item.value.toFixed(item.settings?.precision ?? 2) : 'Unavailable' : typeof item.value === 'boolean' ? item.value ? 'On' : 'Off' : String(item.value);
      return <article key={widget.id}><div className="panel-heading"><h3>{name}</h3><button className="secondary" disabled={busy || offline} aria-label={translate("Remove {0}", { "0": name })} onClick={() => void mutate(() => request(`/dashboard/${encodeURIComponent(widget.id)}`, { method: 'DELETE' }))}>{translate("Remove")}</button></div><p className="muted">{[item.asset_name, item.device_name, item.tag_name || item.name].filter(Boolean).join(' / ')}</p><p>{widget.archived ? translate("Archived · ") : ''}{stale ? translate("Stale") : translate("Good")}{offline ? translate(" · Offline") : ''}</p>{widget.type === 'trend' ? <WidgetTrend widget={item} offline={offline} revision={revision} /> : <p className="metric-value">{stale || item.value == null || typeof item.value === 'boolean' ? translate(value) : value}{value !== 'Unavailable' && item.settings?.show_unit !== false && item.unit ? translate(" {0}", { "0": item.unit }) : ''}</p>}<small>{item.ts ? translate("Last update: {0}", { "0": new Date(item.ts).toLocaleString(getLocale()) }) : translate("No recorded update")}</small></article>;
    })}</div>
  </section>;
}
