import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { LiveData } from './LiveData';
import type { PlatformData } from '../types/platform';

afterEach(() => { cleanup(); vi.useRealTimers(); });
it('shows only realtime enabled tags and filters by device', () => {
  const data = { assets: [{ id: 'a', name: 'Cooling' }], tags: [
    { id: 't1', asset_id: 'a', device_id: 'd1', device_name: 'Inlet', key: 'temp', name: 'Inlet temperature', quality: 'GOOD', value: 10, realtime_enabled: true, enabled: true },
    { id: 't2', asset_id: 'a', device_id: 'd2', device_name: 'Outlet', key: 'temp', name: 'Outlet temperature', quality: 'GOOD', value: 20, ts: new Date().toISOString(), stale_seconds: 30, realtime_enabled: true, enabled: true },
    { id: 't3', asset_id: 'a', device_id: 'd2', key: 'private', name: 'Hidden signal', quality: 'GOOD', realtime_enabled: false, enabled: true },
  ] } as unknown as PlatformData;
  render(<LiveData data={data} offline={false} />);
  expect(screen.queryByText('Hidden signal')).toBeNull();
  fireEvent.change(screen.getByLabelText('Filter by device'), { target: { value: 'd2' } });
  expect(screen.queryByText('Inlet temperature')).toBeNull();
  expect(screen.getByText('Outlet temperature')).toBeTruthy();
  expect(screen.getByText('GOOD').className).toContain('badge-good');
});

function readings(overrides: Record<string, unknown> = {}) {
  const tag = { asset_id: 'a', device_id: 'd', device_name: 'Pump drive', quality: 'GOOD', ts: new Date().toISOString(), stale_seconds: 30, enabled: true, ...overrides };
  return { assets: [{ id: 'a', name: 'Cooling pump' }], alarms: [], tags: [
    { ...tag, id: 'run', key: 'run', name: 'Motor run', semantic: 'run', value: true },
    { ...tag, id: 'fault', key: 'fault', name: 'Drive fault', semantic: 'fault', value: false },
    { ...tag, id: 'amps', key: 'amps', name: 'Motor current', unit: 'A', value: 12.4 },
  ] } as unknown as PlatformData;
}

it('groups readings by equipment and explains boolean operating states', () => {
  render(<LiveData data={readings()} offline={false} />);
  const device = screen.getByRole('region', { name: 'Pump drive' });
  expect(within(device).getByText('Cooling pump')).toBeTruthy();
  expect(within(device).getAllByText('Running').length).toBeGreaterThan(0);
  expect(within(device).getByText('No fault')).toBeTruthy();
  expect(within(device).getByText('12.4')).toBeTruthy();
  expect(within(device).queryByText('false')).toBeNull();
});

it('prioritizes an active fault and uses a distinct labelled fault appearance', () => {
  const data = readings(); data.tags[1].value = true;
  render(<LiveData data={data} offline={false} />);
  expect(screen.getByText('Fault active').closest('.live-reading')?.className).toContain('tone-fault');
  expect(screen.getByRole('region', { name: 'Pump drive' }).className).toContain('tone-fault');
});

it.each([
  ['BAD', false, new Date().toISOString()],
  ['GOOD', true, new Date().toISOString()],
  ['GOOD', false, new Date(Date.now() - 60000).toISOString()],
  ['GOOD', false, undefined],
  ['GOOD', false, 'invalid timestamp'],
])('does not claim a healthy state for quality %s offline=%s ts=%s', (quality, offline, ts) => {
  render(<LiveData data={readings({ quality, ts })} offline={offline} />);
  expect(screen.queryByText('Running')).toBeNull();
  expect(screen.queryByText('No fault')).toBeNull();
  expect(screen.getAllByText('Last known').length).toBeGreaterThan(0);
});

it('does not infer a state from missing readings or generic boolean signals', () => {
  const data = readings(); data.tags[0].value = undefined; data.tags[1].semantic = '';
  render(<LiveData data={data} offline={false} />);
  expect(screen.queryByText('Running')).toBeNull();
  expect(screen.getByText('No reading')).toBeTruthy();
  expect(screen.getByText('OFF')).toBeTruthy();
});

it('marks samples stale as time passes even without a new response', () => {
  vi.useFakeTimers();
  render(<LiveData data={readings({ stale_seconds: 2 })} offline={false} />);
  expect(screen.getAllByText('Running').length).toBeGreaterThan(0);
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.queryByText('Running')).toBeNull();
  expect(screen.getAllByText('STALE').length).toBeGreaterThan(0);
});

it('offers raw signal details only when requested and retains filtering', () => {
  render(<LiveData data={readings()} offline={false} />);
  expect(screen.queryByRole('table')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show signal details' }));
  expect(within(screen.getByRole('table')).getByText('Motor current')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Hide signal details' }));
  expect(screen.queryByRole('table')).toBeNull();
});
