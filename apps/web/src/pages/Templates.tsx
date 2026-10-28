import { t as translate } from '../i18n';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorMessage, request } from '../api/client';
import { Empty } from '../components/DataDisplay';
import type { User } from '../types/platform';

type Definition = { key: string; name: string; data_type: string; address?: string; unit?: string; scale?: number; offset?: number; function_code?: number; byte_order?: string; word_order?: string; deadband?: number; poll_interval_ms?: number; stale_seconds?: number; semantic?: string; store_history?: boolean; realtime_enabled?: boolean; enabled?: boolean; [key: string]: unknown };
type Template = { id?: string; name: string; manufacturer?: string; model?: string; protocol: string; description?: string; version?: number; tag_definitions: Definition[] };
const newTag = (): Definition => ({ key: '', name: '', data_type: 'float32', address: '', unit: '', scale: 1, offset: 0, deadband: 0, poll_interval_ms: 1000, stale_seconds: 30, byte_order: 'BE', word_order: 'BE', function_code: 3, semantic: '', store_history: true, realtime_enabled: true, enabled: true });

export function Templates({ user }: { user: User }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [draft, setDraft] = useState<Template>();
  const [archive, setArchive] = useState<Template>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const mounted = useRef(true);
  const admin = user.role === 'admin';
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true; setLoading(true);
    request<Template[]>('/templates').then(data => { if (active) { setTemplates(data); setError(''); } }).catch(error => { if (active) setError(errorMessage(error)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  const edit = (template?: Template) => {
    setDraft(template ? { ...template, tag_definitions: template.tag_definitions.map(tag => ({ ...tag })) } : { name: '', protocol: 'simulator', tag_definitions: [newTag()] });
    setArchive(undefined); setError(''); setNotice('');
  };
  const change = (key: keyof Template, value: unknown) => setDraft(old => old && ({ ...old, [key]: value }));
  const tagChange = (index: number, key: string, value: unknown) => setDraft(old => old && ({ ...old, tag_definitions: old.tag_definitions.map((tag, i) => i === index ? { ...tag, [key]: value } : tag) }));
  async function save(event: FormEvent) {
    event.preventDefault(); if (!draft || busy || !admin) return; setError(''); setNotice('');
    const keys = new Set<string>();
    if (!draft.tag_definitions.length) { setError('Add at least one tag definition.'); return; }
    for (const tag of draft.tag_definitions) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tag.key) || keys.has(tag.key)) { setError('Tag keys must be unique identifiers.'); return; } keys.add(tag.key);
      if (tag.semantic && tag.data_type !== 'bool') { setError('Run and fault semantics require bool tags.'); return; }
    }
    const body = { name: draft.name.trim(), manufacturer: draft.manufacturer || '', model: draft.model || '', protocol: draft.protocol, description: draft.description || '', tag_definitions: draft.tag_definitions };
    setBusy(true);
    try {
      await request(`/templates${draft.id ? `/${encodeURIComponent(draft.id)}` : ''}`, { method: draft.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      if (!mounted.current) return; setDraft(undefined); setNotice('Template saved. Existing devices keep their tags.'); setRevision(n => n + 1);
    } catch (error) { if (mounted.current) setError(errorMessage(error)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function archiveTemplate() {
    if (!archive?.id || busy || !admin) return; setBusy(true); setError(''); setNotice('');
    try {
      await request(`/templates/${encodeURIComponent(archive.id)}`, { method: 'DELETE', body: JSON.stringify({ confirm: true, history_policy: 'retain' }) });
      if (!mounted.current) return; setArchive(undefined); setNotice('Template archived. Existing devices and history retained.'); setRevision(n => n + 1);
    } catch (error) { if (mounted.current) setError(errorMessage(error)); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <>
    <div className="toolbar"><p className="muted">{translate("Templates copy tag definitions into new devices. Editing a template creates a new version and leaves existing instances unchanged.")}</p>{admin && <button className="primary" disabled={busy || loading} onClick={() => edit()}>{translate("Add template")}</button>}</div>
    {error && <div className="error-banner" role="alert">{translate(error)}</div>}{notice && <p role="status">{translate(notice)}</p>}{loading && <p role="status">{translate("Loading templates...")}</p>}
    {archive && admin && <article role="dialog" aria-label={translate("Archive template")}><h2>{translate("Archive")}  {archive.name}?</h2><p>{translate("This prevents new instances. Existing devices, their tags and history are retained.")}</p><button disabled={busy} onClick={archiveTemplate}>{translate("Confirm archive")}</button><button disabled={busy} onClick={() => setArchive(undefined)}>{translate("Cancel")}</button></article>}
    {draft && admin && <article><h2>{draft.id ? translate("Edit template") : translate("Add template")}</h2><form onSubmit={save}><fieldset disabled={busy}><div className="form-grid">
      <label>{translate("Template name")}<input required maxLength={200} value={draft.name} onChange={e => change('name', e.target.value)} /></label>
      <label>{translate("Manufacturer")}<input maxLength={4000} value={draft.manufacturer || ''} onChange={e => change('manufacturer', e.target.value)} /></label>
      <label>{translate("Model")}<input maxLength={4000} value={draft.model || ''} onChange={e => change('model', e.target.value)} /></label>
      <label>{translate("Protocol")}<select disabled={!!draft.id} value={draft.protocol} onChange={e => change('protocol', e.target.value)}>{['simulator', 'mqtt', 'modbus-tcp', 'modbus-rtu'].map(protocol => <option key={protocol} value={protocol}>{translate(protocol)}</option>)}</select></label>
      <label className="wide">{translate("Description")}<textarea maxLength={4000} value={draft.description || ''} onChange={e => change('description', e.target.value)} /></label>
      {draft.id && <p>{translate("Current version:")}  {draft.version}{translate(". The server assigns the next version when saved. Existing instances retain their cloned definitions.")}</p>}
    </div><h3>{translate("Tag definitions")}</h3><div className="table-wrap"><table><thead><tr><th>{translate("Key / name")}</th><th>{translate("Type / address")}</th><th>{translate("Decoding")}</th><th>{translate("Sampling")}</th><th /></tr></thead><tbody>{draft.tag_definitions.map((tag, i) => <tr key={i}>
      <td><label>{translate("Key")}<input aria-label={translate("Tag {0} key", { "0": i + 1 })} required pattern="[a-zA-Z0-9_-]{1,64}" value={tag.key} onChange={e => tagChange(i, 'key', e.target.value)} /></label><label>{translate("Name")}<input aria-label={translate("Tag {0} name", { "0": i + 1 })} required maxLength={200} value={tag.name} onChange={e => tagChange(i, 'name', e.target.value)} /></label><label>{translate("Unit")}<input aria-label={translate("Tag {0} unit", { "0": i + 1 })} maxLength={32} value={tag.unit || ''} onChange={e => tagChange(i, 'unit', e.target.value)} /></label></td>
      <td><label>{translate("Data type")}<select aria-label={translate("Tag {0} data type", { "0": i + 1 })} value={tag.data_type} onChange={e => tagChange(i, 'data_type', e.target.value)}>{['bool', 'int16', 'uint16', 'int32', 'uint32', 'float32', 'float64', 'string'].map(type => <option key={type} value={type}>{translate(type)}</option>)}</select></label><label>{translate("Address")}<input aria-label={translate("Tag {0} address", { "0": i + 1 })} required={draft.protocol.startsWith('modbus')} value={tag.address || ''} onChange={e => tagChange(i, 'address', e.target.value)} /></label>{draft.protocol.startsWith('modbus') && <label>{translate("Function code")}<select aria-label={translate("Tag {0} function code", { "0": i + 1 })} value={tag.function_code ?? 3} onChange={e => tagChange(i, 'function_code', Number(e.target.value))}>{[1, 2, 3, 4].map(code => <option key={code} value={code}>{translate(code)}</option>)}</select></label>}<label>{translate("Semantic")}<select aria-label={translate("Tag {0} semantic", { "0": i + 1 })} value={tag.semantic || ''} onChange={e => tagChange(i, 'semantic', e.target.value)}><option value="">{translate("Measurement")}</option><option value="run">{translate("Run state")}</option><option value="fault">{translate("Fault state")}</option></select></label></td>
      <td>{(['scale', 'offset', 'deadband'] as const).map(key => <label key={key}>{translate(key)}<input aria-label={translate(`Tag {0} ${key}`, { "0": i + 1 })} type="number" step="any" required min={key === 'deadband' ? 0 : undefined} value={tag[key] ?? (key === 'scale' ? 1 : 0)} onChange={e => tagChange(i, key, e.target.valueAsNumber)} /></label>)}{(['byte_order', 'word_order'] as const).map(key => <label key={key}>{key === 'byte_order' ? translate("Byte order") : translate("Word order")}<select aria-label={translate(`Tag {0} ${key}`, { "0": i + 1 })} value={tag[key] || 'BE'} onChange={e => tagChange(i, key, e.target.value)}><option value="BE">{translate("BE")}</option><option value="LE">{translate("LE")}</option></select></label>)}</td>
      <td><label>{translate("Poll interval (ms)")}<input aria-label={translate("Tag {0} poll interval", { "0": i + 1 })} required type="number" min={100} max={86400000} value={tag.poll_interval_ms ?? 1000} onChange={e => tagChange(i, 'poll_interval_ms', e.target.valueAsNumber)} /></label><label>{translate("Stale after (seconds)")}<input aria-label={translate("Tag {0} stale seconds", { "0": i + 1 })} required type="number" min={1} max={86400} value={tag.stale_seconds ?? 30} onChange={e => tagChange(i, 'stale_seconds', e.target.valueAsNumber)} /></label>{(['enabled', 'store_history', 'realtime_enabled'] as const).map(key => <label className="inline-label" key={key}><input aria-label={translate(`Tag {0} ${key}`, { "0": i + 1 })} type="checkbox" checked={tag[key] ?? true} onChange={e => { tagChange(i, key, e.target.checked); if (key === 'store_history' && 'sample_policy' in tag) tagChange(i, 'sample_policy', e.target.checked ? 'all' : 'none'); }} />{key === 'store_history' ? translate("Store history") : key === 'realtime_enabled' ? translate("Realtime") : translate("Enabled")}</label>)}</td>
      <td><button type="button" onClick={() => change('tag_definitions', draft.tag_definitions.filter((_, n) => n !== i))}>{translate("Remove tag")}  {i + 1}</button></td>
    </tr>)}</tbody></table></div><button type="button" disabled={draft.tag_definitions.length >= 1000} onClick={() => change('tag_definitions', [...draft.tag_definitions, newTag()])}>{translate("Add tag definition")}</button>
    <div className="form-actions"><button className="primary" disabled={loading}>{translate("Save template")}</button><button type="button" onClick={() => setDraft(undefined)}>{translate("Cancel")}</button></div></fieldset></form></article>}
    <article>{!loading && !templates.length ? <Empty title={translate("No templates configured")} /> : <div className="table-wrap"><table><thead><tr><th>{translate("Template")}</th><th>{translate("Manufacturer / model")}</th><th>{translate("Protocol")}</th><th>{translate("Version")}</th><th>{translate("Tags")}</th><th /></tr></thead><tbody>{templates.map(template => <tr key={template.id}><td><strong>{template.name}</strong><small>{template.description}</small></td><td>{[template.manufacturer, template.model].filter(Boolean).join(' ') || '—'}</td><td>{translate(template.protocol)}</td><td>{template.version}</td><td>{template.tag_definitions.length}</td><td>{admin && <><button className="small-button" disabled={busy || loading} aria-label={translate("Edit {0}", { "0": template.name })} onClick={() => edit(template)}>{translate("Edit")}</button><button className="small-button" disabled={busy || loading} aria-label={translate("Archive {0}", { "0": template.name })} onClick={() => { setArchive(template); setDraft(undefined); setError(''); }}>{translate("Archive")} </button></>}</td></tr>)}</tbody></table></div>}</article>
  </>;
}
