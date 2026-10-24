import type { Quality } from '../components/StatusBadge';

export type User = { id: string; username: string; role: 'admin' | 'operator' | 'viewer'; must_change_password: boolean };
export type Asset = { id: string; name: string; area_id: string; type: string; enabled: boolean; site_id: string; area_name: string; operating_state: 'RUN' | 'STOP' | 'FAULT' | 'UNKNOWN' | 'DISABLED'; start_count: number; fault_count: number; runtime_today_seconds: number; last_telemetry: string | null };
export type Tag = { id: string; asset_id: string; device_id: string; device_name?: string; key: string; name: string; datatype: string; data_type?: string; unit: string; scale: number; semantic: string; sample_policy: string; stale_seconds: number; mapping: Record<string, unknown>; enabled?: boolean; store_history?: boolean; realtime_enabled?: boolean; value?: boolean | number | string; quality: Quality; ts?: string };
export type Alarm = { id: number; asset_id: string; asset_name: string; rule_name: string; severity: string; activated_at: string; acknowledged_at: string | null; cleared_at: string | null };
export type EventRecord = { id: number; asset_id: string; asset_name: string; kind: string; ts: string };
export type Rule = { id: string; tag_id: string; name: string; type: string; threshold: number | null; hysteresis: number; stale_seconds: number; severity: string; enabled: boolean };
export type TreeTag = Pick<Tag, 'id' | 'key' | 'name' | 'unit' | 'data_type' | 'enabled' | 'realtime_enabled' | 'store_history'>;
export type TreeDevice = { id: string; name: string; connection_id: string; status: string; enabled: boolean; tags: TreeTag[] };
export type Site = { id: string; name: string; areas: { id: string; name: string; assets: { id: string; name: string; type: string; enabled: boolean; devices: TreeDevice[] }[] }[] };
export type PlatformData = { assets: Asset[]; tags: Tag[]; alarms: Alarm[]; events: EventRecord[]; rules: Rule[]; tree: Site[] };
export type Sample = { ts: string; value: number | boolean | string; quality: Quality };
export type RuntimeSession = { id: number; kind: string; started_at: string; ended_at: string | null; duration_seconds: number };
