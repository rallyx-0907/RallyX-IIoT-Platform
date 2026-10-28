import { t as translate, getLocale } from '../i18n';
import type { Alarm, EventRecord, Tag } from '../types/platform';

export const timeLabel = (value?: string | null) => value ? new Date(value).toLocaleString(getLocale()) : translate('Never received');
export const duration = (seconds: number) => translate('{hours}h {minutes}m', { hours: Math.floor(Math.max(0, seconds) / 3600), minutes: Math.floor(Math.max(0, seconds) % 3600 / 60) });
export function Empty({ title, detail }: { title: string; detail?: string }) { return <div className="empty"><span>◇</span><h3>{translate(title)}</h3>{detail && <p>{translate(detail)}</p>}</div>; }
export function QualityBadge({ quality }: { quality: string }) { return <span className={`badge badge-${quality.toLowerCase()}`}>{translate(quality.toUpperCase())}</span>; }
export function TagsTable({ tags, offline = false }: { tags: Tag[]; offline?: boolean }) {
  if (!tags.length) return <Empty title={translate("No tags configured")} detail="Add tags to an asset to begin receiving telemetry." />;
  return <div className="table-wrap"><table><thead><tr><th>{translate("Tag")}</th><th>{translate("Value")}</th><th>{translate("Unit")}</th><th>{translate("Quality")}</th><th>{translate("Last sample")}</th></tr></thead><tbody>{tags.map(tag => {
    const stale = tag.ts && Date.now() - Date.parse(tag.ts) > tag.stale_seconds * 1000;
    const quality = offline || stale || tag.enabled === false ? 'stale' : tag.quality;
    return <tr key={tag.id}><td><strong>{tag.name}</strong><small>{tag.key}</small></td><td className="mono">{tag.value === undefined || tag.value === null ? '—' : String(tag.value)}</td><td>{tag.unit || '—'}</td><td><QualityBadge quality={quality} /></td><td className="muted">{timeLabel(tag.ts)}</td></tr>;
  })}</tbody></table></div>;
}
export function EventsTable({ events }: { events: EventRecord[] }) {
  if (!events.length) return <Empty title={translate("No events in this period")} />;
  return <div className="table-wrap"><table><thead><tr><th>{translate("Event")}</th><th>{translate("Asset")}</th><th>{translate("Timestamp")}</th></tr></thead><tbody>{events.map(event => <tr key={event.id}><td><span className={`event-dot event-${event.kind}`} />{translate(event.kind.replaceAll('_', ' '))}</td><td>{event.asset_name || event.asset_id}</td><td className="muted">{timeLabel(event.ts)}</td></tr>)}</tbody></table></div>;
}
export function AlarmsTable({ alarms, canAck, onAck }: { alarms: Alarm[]; canAck: boolean; onAck: (id: number) => void }) {
  if (!alarms.length) return <Empty title={translate("No alarms in this view")} detail="Alarm conditions are evaluated by RallyX Core." />;
  return <div className="table-wrap"><table><thead><tr><th>{translate("Condition")}</th><th>{translate("Asset")}</th><th>{translate("Severity")}</th><th>{translate("Activated")}</th><th>{translate("Status")}</th></tr></thead><tbody>{alarms.map(alarm => <tr key={alarm.id}><td><strong>{alarm.rule_name}</strong></td><td>{alarm.asset_name}</td><td><span className={`badge badge-${alarm.severity}`}>{translate(alarm.severity)}</span></td><td className="muted">{timeLabel(alarm.activated_at)}</td><td>{alarm.acknowledged_at ? <span className="muted">{translate("Acknowledged")}</span> : canAck ? <button className="small-button" onClick={() => onAck(alarm.id)}>{translate("Acknowledge")}</button> : translate("Unacknowledged")}{alarm.cleared_at && <small>{translate("Cleared")}  {timeLabel(alarm.cleared_at)}</small>}</td></tr>)}</tbody></table></div>;
}
