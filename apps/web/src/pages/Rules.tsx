import { t as translate } from '../i18n';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { errorMessage, request } from '../api/client';
import { Empty } from '../components/DataDisplay';
import type { PlatformData, User } from '../types/platform';
import '../rules.css';

type Operator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'is_true' | 'is_false' | 'stale_for';
type Condition = { id?: string; tag_id: string; operator: Operator; value?: unknown; threshold?: number; duration_ms?: number; hysteresis: number };
type RuleRecord = { id: string; name: string; description?: string; enabled: boolean; severity: string; logic: 'all' | 'any'; activation_delay_ms: number; clear_delay_ms: number; message_template?: string; conditions: Condition[]; state: string; pending_since?: string };
type Draft = Omit<RuleRecord, 'id' | 'state' | 'pending_since'> & { id?: string };
type WritableRule = Pick<RuleRecord, 'name' | 'description' | 'enabled' | 'severity' | 'logic' | 'activation_delay_ms' | 'clear_delay_ms' | 'message_template' | 'conditions'>;
type Result = { known: boolean; matched: boolean; logic: string; conditions: { tag_id: string; known: boolean; matched: boolean; reason: string; value?: unknown; quality?: string; timestamp?: string }[]; snapshot?: Record<string, unknown> };
const operators: Operator[] = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'is_true', 'is_false', 'stale_for'];
const numeric = new Set(['number', 'numeric', 'float', 'integer', 'int', 'double', 'float32', 'float64', 'int16', 'int32', 'int64', 'uint16', 'uint32', 'uint64']);
const bool = new Set(['boolean', 'bool']);
function compatible(type: string, op: Operator) { return op === 'stale_for' || (numeric.has(type.toLowerCase()) ? ['gt','gte','lt','lte','eq','neq'].includes(op) : bool.has(type.toLowerCase()) ? ['eq','neq','is_true','is_false'].includes(op) : ['eq','neq'].includes(op)); }
const fresh = (): Draft => ({ name: '', description: '', enabled: false, severity: 'warning', logic: 'all', activation_delay_ms: 0, clear_delay_ms: 0, message_template: '', conditions: [] });
const seconds = (value: number) => Math.max(0, Math.round(value * 1000));
const formatSeconds = (value?: number) => value === undefined ? 0 : value / 1000;

export function Rules({ data, user, onRefresh }: { data: PlatformData; user: User; onRefresh: () => Promise<void> }) {
  const [rules, setRules] = useState<RuleRecord[]>([]);
  const [draft, setDraft] = useState<Draft>();
  const [archive, setArchive] = useState<RuleRecord>();
  const [testResult, setTestResult] = useState<Result>();
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [revision, setRevision] = useState(0);
  const admin = user.role === 'admin';
  const tags = useMemo(() => data.tags.map(tag => {
    const asset = data.assets.find(item => item.id === tag.asset_id);
    const dtype = tag.datatype || tag.data_type || 'string';
    return { ...tag, dtype, label: [asset?.name || tag.asset_id, tag.device_name || tag.device_id, tag.name].filter(Boolean).join(' / ') };
  }), [data.tags, data.assets]);
  useEffect(() => { let active = true; setLoading(true); request<RuleRecord[]>('/rules').then(value => { if (active) { setRules(value); setError(''); } }).catch(e => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [revision, data.rules]);
  const update = (key: keyof Draft, value: unknown) => setDraft(old => old && ({ ...old, [key]: value }));
  const edit = (rule?: RuleRecord, duplicate = false) => { setDraft(rule ? { ...rule, id: duplicate ? undefined : rule.id, enabled: duplicate ? false : rule.enabled, name: duplicate ? `${rule.name} (${translate('copy')})` : rule.name, conditions: rule.conditions.map(c => ({ ...c })) } : fresh()); setArchive(undefined); setError(''); setNotice(''); setTestResult(undefined); };
  const conditionChange = (index: number, patch: Partial<Condition>) => update('conditions', draft!.conditions.map((condition, i) => i === index ? { ...condition, ...patch } : condition));
  const selectedType = (condition: Condition) => tags.find(tag => tag.id === condition.tag_id)?.dtype || 'string';
  function payload(): WritableRule {
    if (!draft) throw new Error(translate('Create a rule first.'));
    const conditions = draft.conditions.map(condition => {
      const tag = tags.find(item => item.id === condition.tag_id);
      if (!tag) throw new Error(translate('Choose a valid tag for every condition.'));
      if (!compatible(tag.dtype, condition.operator)) throw new Error(translate('The selected operator does not match the tag datatype.'));
      const item: Condition = { tag_id: condition.tag_id, operator: condition.operator, hysteresis: Number(condition.hysteresis) || 0 };
      if (condition.operator === 'stale_for') item.duration_ms = Number(condition.duration_ms);
      else if (['gt','gte','lt','lte'].includes(condition.operator)) item.threshold = Number(condition.threshold);
      else if (['eq','neq'].includes(condition.operator)) item.value = bool.has(tag.dtype.toLowerCase()) ? condition.value === true || condition.value === 'true' : numeric.has(tag.dtype.toLowerCase()) ? Number(condition.value) : condition.value;
      if (item.hysteresis < 0 || !Number.isFinite(item.hysteresis)) throw new Error(translate('Hysteresis must be a nonnegative number.'));
      if (item.operator === 'stale_for') { if (!Number.isFinite(item.duration_ms) || item.duration_ms! < 1) throw new Error(translate('Stale duration must be greater than zero.')); item.hysteresis = 0; }
      if ('threshold' in item && !Number.isFinite(item.threshold)) throw new Error(translate('Enter a finite threshold.'));
      if (['eq','neq','is_true','is_false'].includes(item.operator)) item.hysteresis = 0;
      return item;
    });
    if (!draft.name.trim()) throw new Error(translate('Rule name is required.'));
    if (!conditions.length) throw new Error(translate('Add at least one condition.'));
    return { name: draft.name.trim(), description: draft.description?.trim() || '', enabled: draft.enabled, severity: draft.severity, logic: draft.logic, activation_delay_ms: Number(draft.activation_delay_ms), clear_delay_ms: Number(draft.clear_delay_ms), message_template: draft.message_template || '', conditions };
  }
  async function testRule() { if (!draft || busy) return; setBusy(true); setError(''); setTestResult(undefined); try { const result = await request<Result>('/rules/test', { method: 'POST', body: JSON.stringify(payload()) }); setTestResult(result); setNotice(translate('Test completed.')); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  async function save(event: FormEvent) { event.preventDefault(); if (!draft || busy || !admin) return; setBusy(true); setError(''); setNotice(''); try { const body = payload(); await request(`/rules${draft.id ? `/${encodeURIComponent(draft.id)}` : ''}`, { method: draft.id ? 'PATCH' : 'POST', body: JSON.stringify(body) }); setDraft(undefined); setNotice(translate('Rule saved.')); setRevision(value => value + 1); await onRefresh(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  async function toggle(rule: RuleRecord) { if (busy || !admin) return; setBusy(true); setError(''); try { const body: WritableRule = { name: rule.name, description: rule.description || '', enabled: !rule.enabled, severity: rule.severity, logic: rule.logic, activation_delay_ms: rule.activation_delay_ms, clear_delay_ms: rule.clear_delay_ms, message_template: rule.message_template || '', conditions: rule.conditions.map(({ tag_id, operator, value, threshold, duration_ms, hysteresis }) => ({ tag_id, operator, ...(value !== undefined ? { value } : {}), ...(threshold !== undefined ? { threshold } : {}), ...(duration_ms !== undefined ? { duration_ms } : {}), hysteresis })) }; await request(`/rules/${encodeURIComponent(rule.id)}`, { method: 'PATCH', body: JSON.stringify(body) }); setRevision(n => n + 1); await onRefresh(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  async function archiveRule() { if (!archive || busy || !admin) return; setBusy(true); setError(''); try { await request(`/rules/${encodeURIComponent(archive.id)}`, { method: 'DELETE', body: JSON.stringify({ confirm: true, history_policy: 'retain' }) }); setArchive(undefined); setNotice(translate('Rule archived. History retained.')); setRevision(n => n + 1); await onRefresh(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  const stateKey: Record<string, string> = { inactive: 'Inactive', pending_active: 'Pending activation', active: 'Active', pending_clear: 'Pending clear' };
  return <section className="rules-page">
    <div className="toolbar"><p className="muted">{translate('Build rules from tag conditions, test against a current snapshot, and review live evaluation state.')}</p>{admin && <button className="primary" disabled={loading || busy} onClick={() => edit()}>{translate('Add rule')}</button>}</div>
    {error && <p className="error-banner" role="alert">{translate(error)}</p>}{notice && <p role="status">{notice}</p>}{loading && <p role="status">{translate('Loading rules...')}</p>}
    {archive && admin && <article className="rule-confirm" role="dialog" aria-label={translate('Archive rule')}><h2>{translate('Archive')} {archive.name}?</h2><p>{translate('The rule definition will be archived and its alarm history retained.')}</p><button className="primary" disabled={busy} onClick={archiveRule}>{translate('Confirm archive')}</button><button onClick={() => setArchive(undefined)}>{translate('Cancel')}</button></article>}
    {draft && admin && <article className="rule-editor"><div className="panel-heading"><h2>{draft.id ? translate('Edit rule') : translate('Create rule')}</h2><button className="text-button" onClick={() => setDraft(undefined)}>{translate('Cancel')}</button></div>
      <form onSubmit={save} className="rule-form"><div className="rule-fields">
        <label>{translate('Rule name')}<input required maxLength={200} value={draft.name} onChange={e => update('name', e.target.value)} /></label>
        <label>{translate('Severity')}<select value={draft.severity} onChange={e => update('severity', e.target.value)}><option value="info">{translate('info')}</option><option value="warning">{translate('warning')}</option><option value="critical">{translate('critical')}</option></select></label>
        <label className="rule-wide">{translate('Description')}<textarea rows={2} value={draft.description || ''} onChange={e => update('description', e.target.value)} /></label>
        <label>{translate('Condition logic')}<select value={draft.logic} onChange={e => update('logic', e.target.value)}><option value="all">{translate('Match all conditions')}</option><option value="any">{translate('Match any condition')}</option></select></label>
        <label className="rule-check"><input type="checkbox" checked={draft.enabled} onChange={e => update('enabled', e.target.checked)} />{translate('Enabled')}</label>
        <label>{translate('Activation delay (seconds)')}<input type="number" min="0" step="any" value={formatSeconds(draft.activation_delay_ms)} onChange={e => update('activation_delay_ms', seconds(Number(e.target.value)))} /></label>
        <label>{translate('Clear delay (seconds)')}<input type="number" min="0" step="any" value={formatSeconds(draft.clear_delay_ms)} onChange={e => update('clear_delay_ms', seconds(Number(e.target.value)))} /></label>
        <label className="rule-wide">{translate('Message template')}<input value={draft.message_template || ''} onChange={e => update('message_template', e.target.value)} placeholder={translate('Optional alarm message')} /></label>
      </div>
      <div className="rule-conditions-heading"><h3>{translate('Conditions')}</h3><button type="button" onClick={() => update('conditions', [...draft.conditions, { tag_id: '', operator: 'gt', threshold: 0, hysteresis: 0 }])}>{translate('Add condition')}</button></div>
      {!draft.conditions.length && <p className="muted">{translate('Add one or more conditions to define when this rule matches.')}</p>}
      {draft.conditions.map((condition, index) => <div className="rule-condition" key={condition.id || index}>
        <label>{translate('Tag')}<select value={condition.tag_id} onChange={e => conditionChange(index, { tag_id: e.target.value, operator: numeric.has(tags.find(t => t.id === e.target.value)?.dtype.toLowerCase() || '') ? 'gt' : bool.has(tags.find(t => t.id === e.target.value)?.dtype.toLowerCase() || '') ? 'is_true' : 'eq', value: '', threshold: 0, hysteresis: 0 })}><option value="">{translate('Select tag')}</option>{tags.map(tag => <option value={tag.id} key={tag.id}>{tag.label}</option>)}</select></label>
        <label>{translate('Operator')}<select value={condition.operator} onChange={e => conditionChange(index, { operator: e.target.value as Operator, hysteresis: 0 })}>{operators.filter(op => compatible(selectedType(condition), op)).map(op => <option value={op} key={op}>{translate(op)}</option>)}</select></label>
        {condition.operator === 'stale_for' ? <label>{translate('Stale for (seconds)')}<input type="number" min="0.001" step="any" value={formatSeconds(condition.duration_ms)} onChange={e => conditionChange(index, { duration_ms: seconds(Number(e.target.value)) })} /></label> : ['gt','gte','lt','lte'].includes(condition.operator) ? <label>{translate('Threshold')}<input aria-label={translate('Operand')} type="number" step="any" value={condition.threshold ?? ''} onChange={e => conditionChange(index, { threshold: Number(e.target.value) })} /></label> : ['eq','neq'].includes(condition.operator) ? <label>{translate('Value')}{bool.has(selectedType(condition).toLowerCase()) ? <select value={String(condition.value ?? false)} onChange={e => conditionChange(index, { value: e.target.value })}><option value="true">{translate('true')}</option><option value="false">{translate('false')}</option></select> : <input aria-label={translate('Operand')} type={numeric.has(selectedType(condition).toLowerCase()) ? 'number' : 'text'} step={numeric.has(selectedType(condition).toLowerCase()) ? 'any' : undefined} value={String(condition.value ?? '')} onChange={e => conditionChange(index, { value: e.target.value })} />}</label> : <label>{translate('Value')}<span className="rule-fixed-value">{translate('No operand required')}</span></label>}
        <label>{translate('Hysteresis')}<input type="number" min="0" step="any" disabled={!['gt','gte','lt','lte'].includes(condition.operator)} value={condition.hysteresis} onChange={e => conditionChange(index, { hysteresis: Number(e.target.value) })} /></label>
        <button type="button" className="text-button" aria-label={translate('Remove condition {0}', { 0: index + 1 })} onClick={() => update('conditions', draft.conditions.filter((_, i) => i !== index))}>{translate('Remove')}</button>
      </div>)}
      <div className="rule-actions"><button type="button" disabled={busy || !draft.conditions.length} onClick={testRule}>{translate('Test rule')}</button><button type="submit" className="primary" disabled={busy}>{busy ? translate('Saving...') : translate('Save rule')}</button></div></form>
      {testResult && <div className="rule-test-result" role="status"><strong>{translate('Test result')}: {testResult.known ? testResult.matched ? translate('Match') : translate('No match') : translate('Unknown')}</strong>{testResult.conditions.map((item, i) => <p key={`${item.tag_id}-${i}`}>{tags.find(tag => tag.id === item.tag_id)?.label || item.tag_id}: {item.known ? item.matched ? translate('Match') : translate('No match') : translate('Unknown')} · {translate(item.reason)}{item.value !== undefined ? ` · ${String(item.value)}` : ''}{item.quality ? ` · ${item.quality}` : ''}</p>)}</div>}
    </article>}
    <article>{!loading && !rules.length ? <Empty title={translate('No rules configured')} /> : <div className="table-wrap"><table className="rules-table"><thead><tr><th>{translate('Rule')}</th><th>{translate('Conditions')}</th><th>{translate('Severity')}</th><th>{translate('Enabled')}</th><th>{translate('Runtime state')}</th><th /></tr></thead><tbody>{rules.map(rule => <tr key={rule.id}><td><strong>{rule.name}</strong>{rule.description && <small>{rule.description}</small>}</td><td>{translate(rule.logic === 'all' ? 'All of {0} conditions' : 'Any of {0} conditions', { 0: rule.conditions?.length || 0 })}<small>{(rule.conditions || []).map(c => `${tags.find(t => t.id === c.tag_id)?.label || c.tag_id} ${translate(c.operator)}`).join(' · ')}</small></td><td><span className={`badge badge-${rule.severity}`}>{translate(rule.severity)}</span></td><td>{rule.enabled ? translate('Enabled') : translate('Disabled')}</td><td><span className={`rule-state rule-state-${rule.state}`}>{translate(stateKey[rule.state] || rule.state)}</span>{rule.pending_since && (rule.state === 'pending_active' || rule.state === 'pending_clear') && <small>{translate('Pending since')} {rule.pending_since}</small>}</td><td className="rule-row-actions">{admin && <><button className="small-button" disabled={busy} onClick={() => edit(rule)}>{translate('Edit')}</button><button className="small-button" disabled={busy} onClick={() => edit(rule, true)}>{translate('Duplicate')}</button><button className="small-button" disabled={busy} onClick={() => toggle(rule)}>{translate(rule.enabled ? 'Disable' : 'Enable')}</button><button className="small-button" disabled={busy} onClick={() => setArchive(rule)}>{translate('Archive')}</button></>}</td></tr>)}</tbody></table></div>}</article>
  </section>;
}
