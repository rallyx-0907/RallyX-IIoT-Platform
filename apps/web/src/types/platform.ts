import type { Quality } from '../components/StatusBadge';

export type User = { id: string; username: string; role: 'admin' | 'operator' | 'viewer'; must_change_password: boolean };
export type Asset = { id: string; name: string; panel_id: string; type: string; enabled: boolean; site_id: string; area_name: string; panel_name: string; operating_state: 'RUN' | 'STOP' | 'FAULT' | 'UNKNOWN'; start_count: number; fault_count: number; runtime_today_seconds: number; last_telemetry: string | null };
export type Tag = { id: string; asset_id: string; key: string; name: string; datatype: string; unit: string; scale: number; semantic: string; sample_policy: string; stale_seconds: number; mapping: Record<string, unknown>; value?: boolean | number | string; quality: Quality; ts?: string };
export type Alarm = { id: number; asset_id: string; asset_name: string; rule_name: string; severity: string; activated_at: string; acknowledged_at: string | null; cleared_at: string | null };
export type EventRecord = { id: number; asset_id: string; asset_name: string; kind: string; ts: string };
export type Rule = { id: string; tag_id: string; name: string; type: string; threshold: number | null; hysteresis: number; stale_seconds: number; severity: string; enabled: boolean };
export type Site = { id: string; name: string; areas: { id: string; name: string; panels: { id: string; name: string; assets: Asset[] }[] }[] };
export type PlatformData = { assets: Asset[]; tags: Tag[]; alarms: Alarm[]; events: EventRecord[]; rules: Rule[]; tree: Site[] };
export type Sample = { ts: string; value: number | boolean | string; quality: Quality };
export type RuntimeSession = { id: number; kind: string; started_at: string; ended_at: string | null; duration_seconds: number };
