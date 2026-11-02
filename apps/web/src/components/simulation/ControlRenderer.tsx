import { SelectorSwitch } from './SelectorSwitch';
import type { CSSProperties } from 'react';
import type { ControlInstance, ResolvedBinding } from '../../types/simulation';
import { safeImageSource } from './registry';
import './analogGauge.css';
import './indicatorLamp.css';

const base: CSSProperties = { width: '100%', height: '100%', boxSizing: 'border-box', overflow: 'hidden' };
const center: CSSProperties = { ...base, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 };
const number = (value: unknown, fallback: number, min = -1000000, max = 1000000) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const color = (value: unknown, fallback: string) => typeof value === 'string' && /^(#[0-9a-f]{3,8}|[a-z]{1,24})$/i.test(value) ? value : fallback;
function displayValue(resolved: ResolvedBinding | undefined, precision: unknown) {
  if (!resolved?.available || resolved.value === undefined || typeof resolved.value === 'number' && !Number.isFinite(resolved.value)) return '—';
  return typeof resolved.value === 'number' ? resolved.value.toFixed(number(precision, 1, 0, 6)) : typeof resolved.value === 'boolean' ? resolved.value ? 'BẬT' : 'TẮT' : resolved.value;
}
export function ControlRenderer({ control, resolved }: { control: ControlInstance; resolved?: ResolvedBinding }) {
  const p = control.properties ?? {};
  const title = resolved?.available ? resolved.quality === 'PREVIEW' ? 'Giá trị xem thử · chưa phải dữ liệu thực' : 'Dữ liệu trực tiếp' : resolved?.reason ?? 'Chưa chọn tín hiệu';
  const available = Boolean(resolved?.available);
  switch (control.type) {
    case 'selector-switch': return <SelectorSwitch control={control} resolved={resolved} />;
    case 'text': return <div style={{ ...center, alignItems: 'stretch', fontSize: number(p.fontSize, 20, 8, 200), fontWeight: ['400', '600', '700'].includes(String(p.fontWeight)) ? String(p.fontWeight) : '600', textAlign: ['left', 'center', 'right'].includes(String(p.textAlign)) ? p.textAlign as CSSProperties['textAlign'] : 'center', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text(p.text, 'Nhãn văn bản')}</div>;
    case 'indicator-lamp': {
      const on = resolved?.conditionMatched === true;
      const lampColor = color(on ? p.onColor : p.offColor, on ? '#16a34a' : '#64748b');
      const blinking = available && on && p.mode === 'blink';
      const lampStyle = { '--lamp-period': number(p.blinkPeriodMs, 1000, 200, 5000) + 'ms', '--lamp-on': color(p.onColor, '#16a34a'), '--lamp-off': color(p.offColor, '#64748b') } as CSSProperties;
      const density = control.height < 50 || control.width < 45 ? 'minimal' : control.height < 85 ? 'compact' : 'normal';
      return <div className="simulation-lamp" style={lampStyle} data-density={density} title={title} data-blinking={blinking} data-state={!available ? 'unavailable' : on ? 'on' : 'off'}>
        <div className="simulation-lamp-drawing"><svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" role="img" aria-label={!available ? 'Đèn không có dữ liệu' : on ? 'Đèn bật' : 'Đèn tắt'}>
          <circle cx="50" cy="50" r="39" fill={available ? lampColor : '#cbd5e1'} stroke="#334155" strokeWidth="3" strokeDasharray={!available || p.borderStyle === 'dashed' ? '5 3' : undefined} strokeOpacity={p.borderStyle === 'none' ? 0 : 1} style={{ filter: available && on ? 'drop-shadow(0 0 4px ' + lampColor + ')' : undefined }} />
          {!available && <text x="50" y="50" dy=".35em" textAnchor="middle" fill="#0f172a" fontSize="32" fontWeight="800">?</text>}
        </svg></div>
        <strong className="simulation-lamp-label" title={text(p.label)}>{text(p.label)}</strong>
        <small className="simulation-lamp-status">{available ? blinking ? 'NHẤP NHÁY' : on ? 'BẬT' : 'TẮT' : 'Không có dữ liệu'}</small>
      </div>;
    }
    case 'analog-gauge': {
      const min = number(p.min, 0, -1e15, 1e15), max = number(p.max, 100, -1e15, 1e15);
      const numeric = available && typeof resolved?.value === 'number' && Number.isFinite(resolved.value) && max > min;
      const fraction = numeric ? Math.max(0, Math.min(1, (resolved.value as number - min) / (max - min))) : 0;
      const angle = Math.PI * (1 - fraction);
      const needleX = 100 + 65 * Math.cos(angle), needleY = 85 - 65 * Math.sin(angle);
      const density = control.height < 64 || control.width < 72 ? 'minimal' : control.height < 140 || control.width < 130 ? 'compact' : 'normal';
      // Match the aspect-fitted SVG viewport so range labels stay under its ends.
      // Reserve header 22 + footer 36 + padding/gaps 16 + range row/gap 18 px.
      const plotWidth = Math.max(0, Math.min(control.width - 8, (control.height - 92) * 200 / 110));
      return <div className="simulation-gauge" data-density={density} title={title}>
        <strong className="simulation-gauge-label" title={text(p.label)}>{text(p.label)}</strong>
        <div className="simulation-gauge-drawing">
          <svg viewBox="0 -8 200 110" preserveAspectRatio="xMidYMid meet" role="img" aria-label={numeric ? 'Đồng hồ ' + displayValue(resolved, p.precision) : 'Đồng hồ không có dữ liệu'}>
            <path d="M 25 85 A 75 75 0 0 1 175 85" fill="none" stroke="#cbd5e1" strokeWidth="12" />
            <path d="M 25 85 A 75 75 0 0 1 175 85" fill="none" stroke={numeric ? '#0d9488' : '#94a3b8'} strokeWidth="6" />
            {numeric && <><line x1="100" y1="85" x2={needleX} y2={needleY} stroke="#e11d48" strokeWidth="4" /><circle cx="100" cy="85" r="7" fill="#334155" /></>}
          </svg>
          <div className="simulation-gauge-range" style={{ width: plotWidth }}><span title={String(min)}>{min}</span><span title={String(max)}>{max}</span></div>
        </div>
        <div className="simulation-gauge-value"><strong title={numeric ? displayValue(resolved, p.precision) + ' ' + text(p.unit) : 'Không có dữ liệu số'}>{numeric ? displayValue(resolved, p.precision) : '—'} <small>{text(p.unit)}</small></strong>{!numeric && <small className="simulation-gauge-unavailable">Không có dữ liệu số</small>}</div>
      </div>;
    }
    case 'numeric-value': return <div style={center} title={title}><span style={{ fontSize: 14 }}>{text(p.label)}</span><strong style={{ fontSize: 26, color: available ? '#0f766e' : '#64748b', overflowWrap: 'anywhere' }}>{available ? text(p.prefix) : ''}{displayValue(resolved, p.precision)}{available ? text(p.suffix) : ''} <small style={{ fontSize: 14 }}>{text(p.unit)}</small></strong>{!available && <small>Không có dữ liệu</small>}</div>;
    case 'rectangle': return <div style={{ ...base, backgroundColor: color(p.fill, '#e2e8f0'), border: number(p.borderWidth, 1, 0, 30) + 'px solid ' + color(p.borderColor, '#64748b'), borderRadius: number(p.borderRadius, 8, 0, 200) }} />;
    case 'line': return <svg width="100%" height="100%" viewBox={'0 0 ' + control.width + ' ' + control.height} preserveAspectRatio="none" aria-label="Đường thẳng"><line x1="0" y1={control.height / 2} x2={control.width} y2={control.height / 2} stroke={color(p.stroke, '#475569')} strokeWidth={number(p.strokeWidth, 2, 1, 30)} strokeDasharray={p.lineStyle === 'dashed' ? '10 6' : p.lineStyle === 'dotted' ? '2 5' : undefined} /></svg>;
    case 'image': {
      const source = safeImageSource(p.source);
      return source ? <img draggable={false} alt="Hình ảnh sơ đồ" src={source} style={{ ...base, objectFit: ['contain', 'cover', 'fill'].includes(String(p.objectFit)) ? p.objectFit as CSSProperties['objectFit'] : 'contain', opacity: number(p.opacity, 1, 0, 1) }} /> : <div style={{ ...center, border: '1px dashed #94a3b8', color: '#64748b', fontSize: 13 }}>Chọn ảnh cục bộ<br />/assets/ hoặc /images/</div>;
    }
    default: return <div style={{ ...center, background: '#fef3c7', fontSize: 13 }}>Thành phần chưa được hỗ trợ</div>;
  }
}
