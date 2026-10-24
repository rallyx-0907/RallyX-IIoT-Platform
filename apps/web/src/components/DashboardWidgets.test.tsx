import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DashboardWidgets } from './DashboardWidgets';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const tag = { id: 't', name: 'Temperature', datatype: 'number', data_type: 'float32', store_history: true, realtime_enabled: true, enabled: true, unit: 'C' };
function backend(initial: unknown[] = [], failure = false) {
  let widgets = initial;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    if (failure && method === 'POST') return new Response(JSON.stringify({ error: { message: 'Cannot save widget' } }), { status: 422 });
    if (method === 'POST') widgets = [{ ...tag, ...JSON.parse(String(init.body)), id: 'w', tag_name: tag.name }];
    if (method === 'DELETE') widgets = [];
    return new Response(JSON.stringify(url.endsWith('/tags') ? [tag] : url.includes('/history?') ? [] : widgets));
  }));
}
it('persists pinned widgets and removal across remounts', async () => {
  backend();
  const view = render(<DashboardWidgets />);
  fireEvent.click(await screen.findByRole('button', { name: 'Pin to Dashboard' }));
  await screen.findByRole('button', { name: 'Remove Temperature' });
  view.unmount();
  const second = render(<DashboardWidgets />);
  fireEvent.click(await screen.findByRole('button', { name: 'Remove Temperature' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove Temperature' })).toBeNull());
  second.unmount(); render(<DashboardWidgets />);
  expect(await screen.findByText('No pinned widgets yet.')).toBeTruthy();
});
it('shows save failures and only offers compatible widget types', async () => {
  backend([], true); render(<DashboardWidgets />);
  await screen.findByRole('button', { name: 'Pin to Dashboard' });
  expect(screen.queryByRole('option', { name: 'Status' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Pin to Dashboard' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Cannot save widget');
});
it('marks archived and offline readings stale without presenting a current value', async () => {
  backend([{ ...tag, id: 'w', tag_id: 't', tag_name: tag.name, type: 'value', archived: true, value: 42, quality: 'GOOD', ts: new Date().toISOString() }]);
  render(<DashboardWidgets offline />);
  expect(await screen.findByText(/Archived.*Stale/)).toBeTruthy();
  expect(screen.queryByText('42 C')).toBeNull();
});
it('draws separate trend segments around bad quality and bounds history queries', async () => {
  const widget = { ...tag, id: 'w', tag_id: 't', tag_name: tag.name, type: 'trend', settings: { range_minutes: 20000 } };
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const samples = [
      { ts: '2026-10-24T01:00:00Z', value: 2, quality: 'GOOD' },
      { ts: '2026-10-24T01:01:00Z', value: 90, quality: 'BAD' },
      { ts: '2026-10-24T01:02:00Z', value: 3, quality: 'good' },
    ];
    return new Response(JSON.stringify(url.endsWith('/tags') ? [tag] : url.includes('/history?') ? samples : [widget]));
  }));
  render(<DashboardWidgets />);
  const chart = await screen.findByRole('img', { name: 'Temperature trend' });
  expect(chart.querySelectorAll('polyline')).toHaveLength(2);
  const query = new URL(calls.find(url => url.includes('/history?'))!, 'http://localhost').searchParams;
  expect(query.get('limit')).toBe('1000');
  expect(Date.parse(query.get('to')!) - Date.parse(query.get('from')!)).toBe(10080 * 60000);
});
it('never queries history for nonnumeric or history-disabled widgets', async () => {
  backend([{ ...tag, id: 'w', tag_id: 't', tag_name: tag.name, type: 'trend', store_history: false }]);
  render(<DashboardWidgets />);
  expect(await screen.findByText('Trend unavailable: numeric history must be enabled.')).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/history?'))).toBe(false);
});
