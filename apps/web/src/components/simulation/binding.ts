import type { Tag } from '../../types/platform';
import type { ControlBinding, ResolvedBinding, SimulationMode, SimulationValue } from '../../types/simulation';

export type ResolveOptions = { mode: SimulationMode; previewValues?: Record<string, SimulationValue>; offline?: boolean; now?: number };
const unavailable = (reason: string, quality = 'UNKNOWN'): ResolvedBinding => ({ available: false, value: undefined, conditionMatched: undefined, quality, reason });
export function resolveBinding(binding: ControlBinding | undefined, tags: ReadonlyMap<string, Tag>, options: ResolveOptions): ResolvedBinding {
  if (!binding) return unavailable('Chưa chọn tín hiệu');
  const tag = tags.get(binding.tagId);
  if (!tag) return unavailable('Không tìm thấy tín hiệu');
  let value: SimulationValue | undefined;
  if (options.mode === 'preview') {
    if (!Object.prototype.hasOwnProperty.call(options.previewValues ?? {}, binding.tagId)) return unavailable('Chưa nhập giá trị xem thử');
    value = options.previewValues![binding.tagId];
  } else {
    if (options.offline) return unavailable('Mất kết nối / đang kết nối lại');
    const flags = tag as Tag & { device_enabled?: boolean; asset_enabled?: boolean };
    if (tag.enabled === false || tag.realtime_enabled === false || flags.device_enabled === false || flags.asset_enabled === false) return unavailable('Tín hiệu hoặc thiết bị đã tắt');
    if (String(tag.quality).toUpperCase() !== 'GOOD') return unavailable('Chất lượng tín hiệu không tốt', String(tag.quality).toUpperCase());
    const timestamp = tag.ts ? Date.parse(tag.ts) : NaN;
    if (!Number.isFinite(timestamp)) return unavailable('Chưa có thời điểm cập nhật');
    if ((options.now ?? Date.now()) - timestamp > Math.max(1, tag.stale_seconds || 30) * 1000) return unavailable('Dữ liệu quá hạn', 'STALE');
    value = tag.value;
  }
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return unavailable('Giá trị không hợp lệ');
  const compare = binding.compareValue;
  let matched: boolean;
  switch (binding.operator) {
    case 'direct': matched = typeof value === 'boolean' ? value : typeof value === 'number' ? value !== 0 : value.length > 0; break;
    case '==': matched = value === compare; break;
    case '!=': matched = value !== compare; break;
    case '>': case '>=': case '<': case '<=':
      if (typeof value !== 'number' || typeof compare !== 'number' || !Number.isFinite(compare)) return unavailable('Phép so sánh cần giá trị số');
      matched = binding.operator === '>' ? value > compare : binding.operator === '>=' ? value >= compare : binding.operator === '<' ? value < compare : value <= compare; break;
    default: return unavailable('Phép so sánh không được hỗ trợ');
  }
  return { available: true, value, conditionMatched: matched, quality: options.mode === 'preview' ? 'PREVIEW' : 'GOOD' };
}
