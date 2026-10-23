export type Quality = 'good' | 'bad' | 'stale' | 'unknown';

export function StatusBadge({ value, quality }: { value?: boolean; quality: Quality }) {
  const label = quality !== 'good' ? quality.toUpperCase() : value === undefined ? 'UNKNOWN' : value ? 'RUN' : 'STOP';
  return <span className={`badge badge-${label.toLowerCase()}`}>{label}</span>;
}
