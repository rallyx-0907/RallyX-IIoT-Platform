import { t as translate, getLocale } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage, post, request } from '../api/client';
import './dashboard.css';

type Tag = { id: string; name?: string; tag_name?: string; semantic?: string; datatype?: string; data_type?: string; unit?: string; store_history?: boolean; realtime_enabled?: boolean; enabled?: boolean; tag_enabled?: boolean; device_enabled?: boolean; asset_enabled?: boolean; archived?: boolean; deleted_at?: string; stale_seconds?: number; quality?: string; value?: unknown; ts?: string; device_id?: string; device_name?: string; asset_name?: string };
type Settings = { range_minutes?: number; precision?: number; show_unit?: boolean; min?: number; max?: number; size?: 'normal' | 'wide'; on_label?: string; off_label?: string };
type Widget = Tag & { id: string; tag_id: string; type: string; title?: string; board_id?: string | null; settings?: Settings; position?: number };
type Board = { id: string; name: string };
type WidgetForm = { kind: string; title: string; range: number; min: number; max: number; precision: number; showUnit: boolean; size: 'normal' | 'wide'; onLabel: string; offLabel: string };
type Sample = { ts: string; value: unknown; quality: string };
const numeric = (tag: Tag) => tag.datatype === 'number' || /^(u?int(16|32|64)?|float(32|64)?|double|number)$/.test(tag.data_type || '');
const boolean = (tag: Tag) => tag.datatype === 'boolean' || ['boolean', 'bool'].includes(tag.data_type || '');
const fresh = (tag: Tag, offline: boolean) => !offline && !tag.archived && tag.enabled !== false && tag.tag_enabled !== false && tag.asset_enabled !== false && tag.device_enabled !== false && tag.realtime_enabled !== false && tag.quality?.toUpperCase() === 'GOOD' && !!tag.ts && Number.isFinite(Date.parse(tag.ts)) && Date.now() - Date.parse(tag.ts) <= (tag.stale_seconds || 60) * 1000;

function WidgetTrend({ widget, offline, revision }: { widget: Widget; offline: boolean; revision: number }) {
  const [samples, setSamples] = useState<Sample[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const minutes = Math.max(1, Math.min(10080, Math.trunc(widget.settings?.range_minutes || 60)));
  const allowed = numeric(widget) && widget.store_history === true && !widget.archived;
  useEffect(() => {
    const controller = new AbortController(); setSamples([]); setError('');
    if (!allowed || offline) return () => controller.abort();
    setBusy(true); const to = new Date(); const query = new URLSearchParams({ from: new Date(to.getTime() - minutes * 60000).toISOString(), to: to.toISOString(), limit: '1000' });
    void request<Sample[]>(`/tags/${encodeURIComponent(widget.tag_id)}/history?${query}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setSamples(result); }).catch(reason => { if (!controller.signal.aborted) setError(errorMessage(reason)); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [widget.tag_id, minutes, allowed, offline, revision]);
  if (!allowed) return <p>{translate('Trend unavailable: numeric history must be enabled.')}</p>;
  if (offline) return <p>{translate('History unavailable while offline.')}</p>;
  if (error) return <p role="alert">{translate(error)}</p>;
  if (busy) return <p>{translate('Loading trend…')}</p>;
  const good = samples.filter(sample => sample.quality?.toUpperCase() === 'GOOD' && typeof sample.value === 'number' && Number.isFinite(sample.value) && Number.isFinite(Date.parse(sample.ts)));
  if (!good.length) return <p>{translate('No good-quality numeric history.')}</p>;
  const low = Math.min(...good.map(sample => Number(sample.value))), high = Math.max(...good.map(sample => Number(sample.value)));
  const times = good.map(sample => Date.parse(sample.ts)); const start = Math.min(...times), end = Math.max(...times); const segments: string[][] = [[]];
  samples.forEach(sample => { if (sample.quality?.toUpperCase() !== 'GOOD' || typeof sample.value !== 'number' || !Number.isFinite(sample.value) || !Number.isFinite(Date.parse(sample.ts))) { if (segments.at(-1)!.length) segments.push([]); return; } segments.at(-1)!.push(`${10 + (Date.parse(sample.ts) - start) / (end - start || 1) * 280},${90 - (sample.value - low) / (high - low || 1) * 80}`); });
  return <><svg viewBox="0 0 300 100" role="img" aria-label={translate('{0} trend', { 0: widget.tag_name || widget.name })}>{segments.filter(segment => segment.length).map((segment, i) => <g key={i}><polyline points={segment.join(' ')} fill="none" stroke="currentColor" strokeWidth="2" />{segment.length === 1 && <circle cx={segment[0].split(',')[0]} cy={segment[0].split(',')[1]} r="3" />}</g>)}</svg><div className="dashboard-trend-axis"><span>{low.toLocaleString(getLocale(), { maximumFractionDigits: 6 })} – {high.toLocaleString(getLocale(), { maximumFractionDigits: 6 })}{widget.unit ? ` ${widget.unit}` : ''}</span><span>{new Date(start).toLocaleTimeString(getLocale())} – {new Date(end).toLocaleTimeString(getLocale())}</span></div><p className="muted">{minutes} {translate('minutes ·')} {samples.length} {translate('samples · maximum 1,000 · bad quality creates gaps')}</p></>;
}

function Gauge({ value, min, max, level, unit, precision }: { value: number; min: number; max: number; level: boolean; unit?: string; precision: number }) {
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const outOfRange = value < min || value > max;
  if (level) return <div className="dashboard-gauge level" role="img" aria-label={`${value} ${unit || ''}`}><div className="level-tank"><div className="level-fill" style={{ height: `${ratio * 100}%` }} /></div><strong>{value.toFixed(precision)}{unit ? ` ${unit}` : ''}</strong><small>{min} — {max}</small>{outOfRange && <small>{translate('Out of configured range')}</small>}</div>;
  const arcLength = Math.PI * 80;
  return <div className="dashboard-gauge dial" role="img" aria-label={`${value} ${unit || ''}`}><svg viewBox="0 0 200 120" aria-hidden="true"><path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#dce3ec" strokeWidth="14" strokeLinecap="round" /><path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#25855a" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${ratio * arcLength} ${arcLength}`} /></svg><strong>{value.toFixed(precision)}{unit ? ` ${unit}` : ''}</strong><small>{min} — {max}</small>{outOfRange && <small>{translate('Out of configured range')}</small>}</div>;
}

const defaults: WidgetForm = { kind: 'value', title: '', range: 60, min: 0, max: 100, precision: 2, showUnit: true, size: 'normal', onLabel: '', offLabel: '' };
const boardStorageKey = 'rallyx.dashboard.selected';
function savedBoard() { try { return localStorage.getItem(boardStorageKey) || ''; } catch { return ''; } }

export function DashboardWidgets({ offline = false }: { offline?: boolean }) {
  const [widgets, setWidgets] = useState<Widget[]>([]); const [tags, setTags] = useState<Tag[]>([]); const [boards, setBoards] = useState<Board[]>([]);
  const [boardId, setBoardId] = useState(savedBoard); const [boardName, setBoardName] = useState(''); const [boardMode, setBoardMode] = useState<'none' | 'create' | 'rename'>('none');
  const [tagId, setTagId] = useState(''); const [deviceId, setDeviceId] = useState(''); const [pointSearch, setPointSearch] = useState(''); const [form, setForm] = useState(defaults); const [editingId, setEditingId] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [revision, setRevision] = useState(0);
  useEffect(() => { if (offline) return; const timer = window.setInterval(() => setRevision(value => value + 1), 3000); return () => window.clearInterval(timer); }, [offline]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true);
    void Promise.all([request<Widget[]>('/dashboard', { signal: controller.signal }), request<Tag[]>('/tags', { signal: controller.signal }), request<Board[]>('/dashboard/boards', { signal: controller.signal })])
      .then(([saved, available, savedBoards]) => { if (!controller.signal.aborted) { setWidgets(saved || []); setTags((available || []).filter(tag => !tag.archived && !tag.deleted_at)); setBoards(savedBoards || []); } })
      .catch(reason => { if (!controller.signal.aborted) setError(errorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (loading) return;
    if (!boards.length && !boardId) return;
    const valid = !boardId || boards.some(board => board.id === boardId);
    if (!valid) setBoardId('');
  }, [boards, loading]);
  useEffect(() => { try { localStorage.setItem(boardStorageKey, boardId); } catch { /* Board selection remains usable without browser storage. */ } }, [boardId]);
  const devices = useMemo(() => [...new Map(tags.filter(tag => tag.device_id || tag.device_name).map(tag => [tag.device_id || tag.device_name!, { id: tag.device_id || tag.device_name!, name: tag.device_name || tag.device_id! }])).values()], [tags]);
  const candidates = useMemo(() => tags.filter(tag => (!deviceId || tag.device_id === deviceId || tag.device_name === deviceId) && `${tag.name || ''} ${tag.tag_name || ''} ${tag.device_name || ''} ${tag.asset_name || ''}`.toLocaleLowerCase().includes(pointSearch.trim().toLocaleLowerCase())), [tags, deviceId, pointSearch]);
  useEffect(() => { if (tagId && !editingId && !candidates.some(tag => tag.id === tagId)) setTagId(''); }, [tagId, editingId, candidates]);
  const selected = editingId ? candidates.find(tag => tag.id === tagId) : candidates.find(tag => tag.id === tagId) || candidates[0];
  const kinds = ['value', ...(selected && boolean(selected) ? ['status'] : []), ...(selected && numeric(selected) ? ['gauge', 'level', ...(selected.store_history ? ['trend'] : [])] : [])];
  const effectiveKind = kinds.includes(form.kind) ? form.kind : 'value';
  const visible = widgets.filter(widget => (widget.board_id || '') === boardId).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
  async function mutate(action: () => Promise<unknown>) { setBusy(true); setError(''); try { await action(); setRevision(value => value + 1); return true; } catch (reason) { setError(errorMessage(reason)); return false; } finally { setBusy(false); } }
  function resetForm() { setEditingId(''); setForm(defaults); setTagId(''); }
  function submitWidget(event: React.FormEvent) {
    event.preventDefault(); if (!selected) return;
    if (['gauge', 'level'].includes(effectiveKind) && (!Number.isFinite(form.min) || !Number.isFinite(form.max) || form.min >= form.max)) { setError(translate('Minimum must be less than maximum.')); return; }
    if (effectiveKind === 'trend' && (!numeric(selected) || !selected.store_history)) { setError(translate('Trend requires numeric history.')); return; }
    const settings: Settings = { precision: form.precision, show_unit: form.showUnit, size: form.size };
    if (['gauge', 'level'].includes(effectiveKind)) { settings.min = form.min; settings.max = form.max; }
    if (effectiveKind === 'trend') settings.range_minutes = form.range;
    if (effectiveKind === 'status') { settings.on_label = form.onLabel; settings.off_label = form.offLabel; }
    const payload = { tag_id: selected.id, type: effectiveKind, title: form.title, board_id: boardId || null, position: editingId ? visible.findIndex(widget => widget.id === editingId) : visible.length, settings };
    void mutate(() => editingId ? request(`/dashboard/${encodeURIComponent(editingId)}`, { method: 'PATCH', body: JSON.stringify(payload) }) : post('/dashboard', payload)).then(saved => { if (saved) resetForm(); });
  }
  function edit(widget: Widget) {
    const settings = widget.settings || {}; const tag = tags.find(item => item.id === widget.tag_id);
    setEditingId(widget.id); setPointSearch(''); setTagId(widget.tag_id); setDeviceId(tag?.device_id || tag?.device_name || '');
    setForm({ kind: widget.type, title: widget.title || '', range: settings.range_minutes || 60, min: settings.min ?? 0, max: settings.max ?? 100, precision: settings.precision ?? 2, showUnit: settings.show_unit !== false, size: settings.size || 'normal', onLabel: settings.on_label || '', offLabel: settings.off_label || '' });
  }
  async function saveBoard() {
    const name = boardName.trim(); if (!name) return;
    await mutate(async () => {
      if (boardMode === 'create') { const created = await post<Board>('/dashboard/boards', { name }); setBoards(current => [...current, created]); setBoardId(created.id); }
      else { const current = boards.find(board => board.id === boardId); if (current) { await request(`/dashboard/boards/${encodeURIComponent(current.id)}`, { method: 'PATCH', body: JSON.stringify({ name }) }); setBoards(all => all.map(board => board.id === current.id ? { ...board, name } : board)); } }
      setBoardName(''); setBoardMode('none');
    });
  }
  async function move(widget: Widget, direction: number) {
    const index = visible.findIndex(item => item.id === widget.id); const target = visible[index + direction]; if (!target) return;
    const next = visible.slice(); [next[index], next[index + direction]] = [next[index + direction], next[index]];
    await mutate(async () => { for (const [position, item] of next.entries()) await request(`/dashboard/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify({ position }) }); });
  }
  return <section className="dashboard-customizer" aria-label={translate('My dashboard')}>
    <div className="panel-heading"><h2>{translate('My dashboard')}</h2><button className="secondary" disabled={busy || loading} onClick={() => setRevision(value => value + 1)}>{translate('Refresh widgets')}</button></div>
    <div className="dashboard-board-bar"><label>{translate('Dashboard')}<select value={boardMode === 'create' ? '__create__' : boardId} onChange={event => { if (event.target.value === '__create__') { setBoardMode('create'); setBoardName(''); } else { setBoardMode('none'); resetForm(); setBoardId(event.target.value); } }} aria-label={translate('Dashboard')}><option key="default" value="">{translate('Default dashboard')}</option>{boards.map(board => <option key={board.id} value={board.id}>{board.name}</option>)}<option key="create" value="__create__">{translate('Create dashboard…')}</option></select></label>
      {boardMode === 'none' && <button type="button" className="secondary" onClick={() => { setBoardName(''); setBoardMode('create'); }}>{translate('Create dashboard…')}</button>}
      {boardMode === 'none' && boardId && <button className="secondary" onClick={() => { setBoardName(boards.find(board => board.id === boardId)?.name || ''); setBoardMode('rename'); }}>{translate('Rename dashboard')}</button>}
      {boardMode !== 'none' && <form onSubmit={event => { event.preventDefault(); void saveBoard(); }}><label>{translate('Dashboard name')}<input maxLength={80} required value={boardName} onChange={event => setBoardName(event.target.value)} /></label><button disabled={busy}>{translate(boardMode === 'create' ? 'Create dashboard' : 'Save dashboard')}</button><button type="button" className="secondary" onClick={() => { setBoardMode('none'); setBoardName(''); }}>{translate('Cancel')}</button></form>}
    </div>
    <form className="filters dashboard-builder" onSubmit={submitWidget}>
      <label>{translate('Filter by device')}<select value={deviceId} onChange={event => { setDeviceId(event.target.value); setTagId(''); }}><option value="">{translate('All devices')}</option>{devices.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label>
      <label>{translate('Search signals')}<input value={pointSearch} onChange={event => { setPointSearch(event.target.value); setTagId(''); }} /></label>
      <label>{translate('Pin tag')}<select value={editingId ? tagId : tagId || selected?.id || ''} onChange={event => setTagId(event.target.value)}>{editingId && tagId && !selected && <option value={tagId}>{translate('Selected signal unavailable: {0}', { 0: widgets.find(widget => widget.id === editingId)?.tag_name || tagId })}</option>}{candidates.map(tag => <option key={tag.id} value={tag.id}>{tag.device_name ? `${tag.device_name} / ` : ''}{tag.name || tag.id}</option>)}</select></label>
      {editingId && !selected && <p className="dashboard-stale">{translate('Selected signal is unavailable. Choose a signal to continue.')}</p>}
      <label>{translate('Widget type')}<select value={effectiveKind} onChange={event => setForm(value => ({ ...value, kind: event.target.value }))}>{kinds.map(type => <option key={type} value={type}>{translate(type[0].toUpperCase() + type.slice(1))}</option>)}</select></label>
      <label>{translate('Widget title')}<input value={form.title} maxLength={200} onChange={event => setForm(value => ({ ...value, title: event.target.value }))} /></label>
      {effectiveKind === 'trend' && <label>{translate('Range (minutes)')}<input type="number" min={1} max={10080} step={1} required value={form.range} onChange={event => setForm(value => ({ ...value, range: Number(event.target.value) }))} /></label>}
      {['gauge', 'level'].includes(effectiveKind) && <><label>{translate('Minimum')}<input type="number" step="any" value={form.min} onChange={event => setForm(value => ({ ...value, min: Number(event.target.value) }))} /></label><label>{translate('Maximum')}<input type="number" step="any" value={form.max} onChange={event => setForm(value => ({ ...value, max: Number(event.target.value) }))} /></label></>}
      <label>{translate('Precision')}<input type="number" min={0} max={6} step={1} value={form.precision} onChange={event => setForm(value => ({ ...value, precision: Number(event.target.value) }))} /></label>
      <label className="dashboard-check"><input type="checkbox" checked={form.showUnit} onChange={event => setForm(value => ({ ...value, showUnit: event.target.checked }))} />{translate('Show unit')}</label>
      <label>{translate('Widget width')}<select value={form.size} onChange={event => setForm(value => ({ ...value, size: event.target.value as 'normal' | 'wide' }))}><option value="normal">{translate('Normal')}</option><option value="wide">{translate('Wide')}</option></select></label>
      {effectiveKind === 'status' && <><label>{translate('On label')}<input value={form.onLabel} maxLength={60} onChange={event => setForm(value => ({ ...value, onLabel: event.target.value }))} /></label><label>{translate('Off label')}<input value={form.offLabel} maxLength={60} onChange={event => setForm(value => ({ ...value, offLabel: event.target.value }))} /></label></>}
      <div className="dashboard-form-actions"><button disabled={!selected || busy || loading || offline}>{translate(editingId ? 'Save widget' : 'Pin to Dashboard')}</button>{editingId && <button type="button" className="secondary" onClick={resetForm}>{translate('Cancel')}</button>}</div>
    </form>
    {error && <p className="error" role="alert">{translate(error)}</p>}{loading && <p>{translate('Loading widgets…')}</p>}{!loading && !visible.length && <p>{translate('No pinned widgets yet.')}</p>}
    <div className="dashboard-bottom">{visible.map((widget, index) => {
      const name = widget.title || widget.tag_name || widget.name || widget.tag_id; const metadata = tags.find(tag => tag.id === widget.tag_id); const item = { ...metadata, ...widget } as Widget;
      const stale = !fresh(item, offline); const raw = item.value; const numericValue = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
      const semanticLabel = item.semantic === 'fault' ? raw === true ? 'Fault active' : 'No fault' : item.semantic === 'run' ? raw === true ? 'Running' : 'Stopped' : raw === true ? 'On' : 'Off';
      const stateLabel = typeof raw === 'boolean' ? raw ? item.settings?.on_label || translate(semanticLabel) : item.settings?.off_label || translate(semanticLabel) : '';
      const formatted = stale || raw == null || typeof raw === 'number' && numericValue === null ? translate('Unavailable') : numericValue !== null ? numericValue.toFixed(Math.max(0, Math.min(8, item.settings?.precision ?? 2))) : typeof raw === 'boolean' ? stateLabel : String(raw);
      const stateClass = typeof raw === 'boolean' && !stale ? raw && item.semantic === 'fault' ? 'is-fault' : raw ? 'is-on' : 'is-off' : '';
      const boundsValid = Number.isFinite(item.settings?.min) && Number.isFinite(item.settings?.max) && Number(item.settings?.min) < Number(item.settings?.max);
      return <article className={`dashboard-widget ${item.settings?.size === 'wide' ? 'wide' : ''}`} key={widget.id}><div className="panel-heading"><h3>{name}</h3><div className="dashboard-actions"><button className="secondary" disabled={busy || offline || index === 0} aria-label={translate('Move {0} up', { 0: name })} onClick={() => void move(widget, -1)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 14 6-6 6 6" /></svg></button><button className="secondary" disabled={busy || offline || index === visible.length - 1} aria-label={translate('Move {0} down', { 0: name })} onClick={() => void move(widget, 1)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 10 6 6 6-6" /></svg></button><button className="secondary" disabled={busy || offline || widget.archived || !metadata} aria-label={translate('Edit {0}', { 0: name })} onClick={() => edit(widget)}>{translate('Edit')}</button><button className="secondary" disabled={busy || offline} aria-label={translate('Remove {0}', { 0: name })} onClick={() => void mutate(() => request(`/dashboard/${encodeURIComponent(widget.id)}`, { method: 'DELETE' }))}>{translate('Remove')}</button></div></div>
        <p className="muted">{[item.asset_name, item.device_name, item.tag_name || item.name].filter(Boolean).join(' / ')}</p><p className={stale ? 'dashboard-stale' : ''}>{widget.archived ? `${translate('Archived · ')} ` : ''}{stale ? translate('Stale') : translate('Good')}{offline ? ` ${translate('· Offline')}` : ''}</p>
        {widget.type === 'trend' ? <WidgetTrend widget={item} offline={offline} revision={revision} /> : widget.type === 'status' ? <p className={`dashboard-status ${stateClass}`}>{stale ? translate('Unavailable') : stateLabel}</p> : ['gauge', 'level'].includes(widget.type) ? !stale && numericValue !== null && boundsValid ? <Gauge value={numericValue} min={Number(item.settings!.min)} max={Number(item.settings!.max)} level={widget.type === 'level'} unit={item.settings?.show_unit === false ? undefined : item.unit} precision={Math.max(0, Math.min(6, item.settings?.precision ?? 2))} /> : <p className="metric-value">{stale ? translate('Unavailable') : translate('Numeric bounds unavailable')}</p> : <p className={`metric-value ${stateClass}`}>{formatted}{!stale && raw != null && numericValue !== null && item.settings?.show_unit !== false && item.unit ? translate(' {0}', { 0: item.unit }) : ''}</p>}
        <small>{item.ts ? translate('Last update: {0}', { 0: new Date(item.ts).toLocaleString(getLocale()) }) : translate('No recorded update')}</small></article>;
    })}</div>
  </section>;
}
