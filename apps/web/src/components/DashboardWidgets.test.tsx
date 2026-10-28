import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DashboardWidgets } from './DashboardWidgets';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const tag = { id: 't', name: 'Temperature', datatype: 'number', data_type: 'float32', store_history: true, realtime_enabled: true, enabled: true, unit: 'C' };
function backend(initial: unknown[] = [], failure = false, availableTags: Array<{ id: string; name?: string; datatype?: string; data_type?: string; store_history?: boolean; realtime_enabled?: boolean; enabled?: boolean; unit?: string }> = [tag]) {
  let widgets = initial as Record<string, unknown>[];
  let boards: { id: string; name: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    if (url.endsWith('/dashboard/boards')) {
      if (method === 'POST') { const body = JSON.parse(String(init.body)) as Record<string, string>; boards = [...boards, { id: 'b1', name: body.name || '' }]; return new Response(JSON.stringify(boards.at(-1))); }
      if (method === 'PATCH') { const body = JSON.parse(String(init.body)) as Partial<BoardMock>; boards = boards.map(board => board.id === 'b1' ? { ...board, ...body } : board); }
      return new Response(JSON.stringify(boards));
    }
    if (failure && method === 'POST') return new Response(JSON.stringify({ error: { message: 'Cannot save widget' } }), { status: 422 });
    if (method === 'POST') widgets = [{ ...tag, ...JSON.parse(String(init.body)), id: 'w', tag_name: tag.name }];
    if (method === 'PATCH') widgets = widgets.map(widget => ({ ...widget, ...JSON.parse(String(init.body)) }));
    if (method === 'DELETE') widgets = [];
    return new Response(JSON.stringify(url.endsWith('/tags') ? availableTags : url.includes('/history?') ? [] : widgets));
  }));
}
type BoardMock = { id: string; name: string };
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

it('creates and selects a named dashboard while keeping the legacy dashboard selectable', async () => {
  backend(); const view = render(<DashboardWidgets />);
  const selector = await screen.findByLabelText('Dashboard');
  fireEvent.change(selector, { target: { value: '__create__' } });
  fireEvent.change(screen.getByLabelText('Dashboard name'), { target: { value: 'Boiler room' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create dashboard' }));
  await waitFor(() => expect((screen.getByLabelText('Dashboard') as HTMLSelectElement).value).toBe('b1'));
  expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith('/dashboard/boards') && init?.method === 'POST')).toBe(true);
  view.unmount(); render(<DashboardWidgets />);
  await waitFor(() => expect((screen.getByLabelText('Dashboard') as HTMLSelectElement).value).toBe('b1'));
  fireEvent.click(await screen.findByRole('button', { name: 'Rename dashboard' }));
  fireEvent.change(screen.getByLabelText('Dashboard name'), { target: { value: 'Boiler room east' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save dashboard' }));
  await waitFor(() => expect(screen.getByRole('option', { name: 'Boiler room east' })).toBeTruthy());
  expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith('/dashboard/boards/b1') && init?.method === 'PATCH')).toBe(true);
  fireEvent.change(screen.getByLabelText('Dashboard'), { target: { value: '' } });
  expect((screen.getByLabelText('Dashboard') as HTMLSelectElement).value).toBe('');
});

it('edits an existing widget and saves gauge bounds and precision', async () => {
  const widget = { ...tag, id: 'w', tag_id: 't', tag_name: tag.name, type: 'value', title: 'Temperature' };
  backend([widget]); render(<DashboardWidgets />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Temperature' }));
  fireEvent.change(screen.getByLabelText('Widget type'), { target: { value: 'gauge' } });
  fireEvent.change(screen.getByLabelText('Minimum'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Maximum'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('Precision'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save widget' }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith('/dashboard/w') && init?.method === 'PATCH')).toBe(true));
  const call = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith('/dashboard/w') && init?.method === 'PATCH')!;
  const payload = JSON.parse(String(call[1]?.body));
  expect(payload.type).toBe('gauge');
  expect(payload.settings).toMatchObject({ min: 0, max: 100, precision: 1 });
});

it('rejects invalid numeric gauge bounds before saving', async () => {
  backend(); render(<DashboardWidgets />);
  fireEvent.change(await screen.findByLabelText('Widget type'), { target: { value: 'gauge' } });
  fireEvent.change(screen.getByLabelText('Minimum'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('Maximum'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pin to Dashboard' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Minimum must be less than maximum.');
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

it('offers status only for Boolean tags and numeric charts only for numeric tags', async () => {
  const binary = { id: 'run', name: 'Run', datatype: 'boolean', data_type: 'bool', store_history: true, realtime_enabled: true, enabled: true };
  backend([], false, [tag, binary]); render(<DashboardWidgets />);
  const tagPicker = await screen.findByLabelText('Pin tag');
  fireEvent.change(tagPicker, { target: { value: 't' } });
  expect(screen.getByRole('option', { name: 'Gauge' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'Trend' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: 'Status' })).toBeNull();
  fireEvent.change(tagPicker, { target: { value: 'run' } });
  expect(screen.getByRole('option', { name: 'Status' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: 'Gauge' })).toBeNull();
  expect(screen.queryByRole('option', { name: 'Trend' })).toBeNull();
});

it('does not retarget an edited widget when its selected tag disappears on refresh', async () => {
  const widget = { ...tag, id: 'w', tag_id: 't', tag_name: tag.name, type: 'value' };
  const other = { ...tag, id: 'other', name: 'Other temperature' };
  let removed = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const tags = removed ? [other] : [tag, other];
    return new Response(JSON.stringify(url.endsWith('/tags') ? tags : url.endsWith('/dashboard/boards') ? [] : [widget]));
  }));
  render(<DashboardWidgets />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Temperature' }));
  removed = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh widgets' }));
  await waitFor(() => expect((screen.getByLabelText('Pin tag') as HTMLSelectElement).value).toBe('t'));
  expect((screen.getByRole('button', { name: 'Save widget' }) as HTMLButtonElement).disabled).toBe(true);
});

it('disables editing archived widgets', async () => {
  const widget = { ...tag, id: 'w', tag_id: 't', tag_name: tag.name, type: 'value', archived: true };
  backend([widget]); render(<DashboardWidgets />);
  expect((await screen.findByRole('button', { name: 'Edit Temperature' }) as HTMLButtonElement).disabled).toBe(true);
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
