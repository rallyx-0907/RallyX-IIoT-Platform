import type { CSSProperties } from 'react';
import type { ControlInstance, ResolvedBinding, SelectorPosition } from '../../types/simulation';
import './selectorSwitch.css';

export function validSelectorPositions(value: unknown): value is SelectorPosition[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) return false;
  const type = typeof value[0]?.value;
  if (!['number', 'boolean', 'string'].includes(type) || type === 'boolean' && value.length !== 2) return false;
  return value.every((p, i) => p && typeof p.label === 'string' && typeof p.value === type && (type !== 'number' || Number.isFinite(p.value)) && value.findIndex(other => other?.value === p.value) === i);
}
const bounded = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const safeColor = (value: unknown, fallback: string) => typeof value === 'string' && /^(#[0-9a-f]{3,8}|[a-z]{1,24})$/i.test(value) ? value : fallback;

export function SelectorSwitch({ control, resolved }: { control: ControlInstance; resolved?: ResolvedBinding }) {
  const p = control.properties ?? {};
  const positions = validSelectorPositions(p.positions) ? p.positions : [];
  const index = resolved?.available && !['BAD', 'STALE', 'OFFLINE', 'MISSING'].includes(resolved.quality.toUpperCase()) ? positions.findIndex(position => position.value === resolved.value) : -1;
  const selected = positions[index];
  const active = safeColor(p.activeColor, '#16a34a'), inactive = safeColor(p.inactiveColor, '#64748b');
  const angle = index < 0 ? 0 : p.orientation === 'vertical' ? -45 - index * (90 / (positions.length - 1)) : positions.length === 2 ? -45 + index * 90 : -60 + index * 60;
  const density = control.width < 64 || control.height < 64 ? 'minimal' : control.width < 150 || control.height < 145 ? 'compact' : 'normal';
  const label = typeof p.label === 'string' ? p.label : '';
  const style = { '--selector-text-size': bounded(p.textSize, 14, 8, 32) + 'px', '--selector-knob-size': bounded(p.knobSize, 72, 24, 120) + 'px', '--selector-active': active, '--selector-inactive': inactive } as CSSProperties;
  return <div className="simulation-selector" style={style} data-density={density} data-orientation={p.orientation === 'vertical' ? 'vertical' : 'horizontal'} data-state={selected ? 'selected' : 'unknown'} title={resolved?.reason ?? (selected ? selected.label : 'Không có dữ liệu phù hợp')}>
    <strong className="simulation-selector-label" title={label}>{label}</strong>
    <div className="simulation-selector-positions">{positions.map((position, i) => <span key={i} data-selected={i === index} title={position.label}>{position.label}</span>)}</div>
    <div className="simulation-selector-drawing"><svg viewBox="0 0 120 120" preserveAspectRatio="xMidYMid meet" role="img" aria-label={selected ? selected.label : 'Không xác định'}>
      <circle cx="60" cy="60" r="55" fill="#cbd5e1" stroke="#475569" strokeWidth="3" />
      <circle cx="60" cy="60" r="43" fill="#1e293b" stroke={selected ? active : inactive} strokeWidth="4" />
      {selected ? <g transform={`rotate(${angle} 60 60)`}><rect x={p.knobStyle === 'lever' ? 54 : 48} y="19" width={p.knobStyle === 'lever' ? 12 : 24} height="74" rx="6" fill="#475569" stroke="#94a3b8" strokeWidth="2" /><path d="M60 21 L60 40" stroke={active} strokeWidth="6" strokeLinecap="round" /></g> : <text x="60" y="76" textAnchor="middle" fontSize="48" fill="#e2e8f0">?</text>}
    </svg></div>
    <div className="simulation-selector-status" title={selected?.label ?? 'Không xác định'}>{selected?.label ?? 'Không xác định'}</div>
  </div>;
}
