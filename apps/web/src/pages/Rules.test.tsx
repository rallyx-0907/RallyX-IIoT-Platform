import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Rules } from './Rules';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const user = { id: 'admin', username: 'admin', role: 'admin' as const, must_change_password: false };
const data = { assets: [{ id: 'a', name: 'Boiler', area_name: 'Utilities' }], tags: [
  { id: 't1', asset_id: 'a', device_id: 'd', device_name: 'PLC 1', name: 'Temperature', key: 'temp', datatype: 'number', unit: '°C' },
  { id: 't2', asset_id: 'a', device_id: 'd', device_name: 'PLC 1', name: 'Running', key: 'run', datatype: 'boolean', unit: '' },
], rules: [], alarms: [], events: [], tree: [] } as never;
const existingRule = { id: 'r1', name: 'Hot boiler', description: 'Watch temperature', enabled: true, severity: 'critical', logic: 'all', activation_delay_ms: 2500, clear_delay_ms: 4000, message_template: 'Too hot', conditions: [{ id: 'condition-1', tag_id: 't1', operator: 'gt', threshold: 90, hysteresis: 2, value: 'legacy-value', duration_ms: 6000 }], state: 'pending_active', pending_since: '2026-10-28T09:00:00Z', last_error: 'old error', type: 'high', threshold: 70, tag_id: 'old-tag', created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-21T00:00:00Z' };
function backend(fail = false) {
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit = {}) => {
    const method = init.method || 'GET'; calls.push({ path, method, body: init.body ? JSON.parse(String(init.body)) : {} });
    let payload: unknown = path.endsWith('/rules') ? [existingRule] : [];
    if (path.endsWith('/test')) payload = { known: true, matched: false, logic: 'all', conditions: [], snapshot: {} };
    else if (method === 'POST' || method === 'PATCH') payload = { id: 'r1' };
    else if (method === 'DELETE') payload = {};
    return new Response(JSON.stringify(fail && method === 'POST' ? { error: { message: 'Rejected rule' } } : payload), { status: fail && method === 'POST' ? 422 : 200 });
  }));
  return calls;
}

it('creates full multi-condition payloads and tests without saving', async () => {
  const calls = backend(); const refresh = vi.fn(async () => {});
  render(<Rules data={data} user={user} onRefresh={refresh} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add rule' }));
  fireEvent.change(screen.getByLabelText('Rule name'), { target: { value: 'Boiler hot while running' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
  const selects = screen.getAllByLabelText('Tag'); fireEvent.change(selects[0], { target: { value: 't1' } });
  fireEvent.change(screen.getByLabelText('Operator'), { target: { value: 'gt' } });
  fireEvent.change(screen.getByLabelText('Operand'), { target: { value: '85' } });
  fireEvent.click(screen.getByRole('button', { name: 'Test rule' }));
  await screen.findByText('Test completed.');
  expect(calls.filter(c => c.method !== 'GET')).toHaveLength(1);
  expect(calls.at(-1)?.path).toBe('/api/v1/rules/test');
  expect(calls.at(-1)?.body).toMatchObject({ name: 'Boiler hot while running', conditions: [{ tag_id: 't1', operator: 'gt', threshold: 85 }] });
  fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
  await waitFor(() => expect(calls.some(c => c.method === 'POST' && c.path === '/api/v1/rules')).toBe(true));
  expect(refresh).toHaveBeenCalled();
});

it('sends only writable fields when editing a record with runtime and legacy metadata', async () => {
  const calls = backend();
  render(<Rules data={data} user={user} onRefresh={vi.fn(async () => {})} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
  await waitFor(() => expect(calls.some(c => c.method === 'PATCH')).toBe(true));
  const update = calls.find(c => c.method === 'PATCH')!;
  expect(update.path).toBe('/api/v1/rules/r1');
  expect(Object.keys(update.body).sort()).toEqual(['activation_delay_ms', 'clear_delay_ms', 'conditions', 'description', 'enabled', 'logic', 'message_template', 'name', 'severity'].sort());
  expect(update.body).not.toHaveProperty('id');
  expect(update.body).not.toHaveProperty('state');
  expect(update.body).not.toHaveProperty('pending_since');
  expect(update.body).not.toHaveProperty('last_error');
  expect(update.body).not.toHaveProperty('type');
  expect(update.body).not.toHaveProperty('tag_id');
  expect(update.body).not.toHaveProperty('created_at');
  expect(update.body.conditions).toEqual([{ tag_id: 't1', operator: 'gt', threshold: 90, hysteresis: 2 }]);
});

it('restricts mutations to admins and reports API validation failures', async () => {
  const calls = backend(true);
  render(<Rules data={data} user={{ ...user, role: 'viewer' }} onRefresh={vi.fn(async () => {})} />);
  await waitFor(() => expect(calls.some(c => c.path.endsWith('/rules'))).toBe(true));
  expect(screen.queryByRole('button', { name: 'Add rule' })).toBeNull();
  expect(calls.every(c => c.method === 'GET')).toBe(true);
  cleanup(); vi.unstubAllGlobals();
  backend(true); render(<Rules data={data} user={user} onRefresh={vi.fn(async () => {})} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add rule' }));
  fireEvent.change(screen.getByLabelText('Rule name'), { target: { value: 'Bad rule' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
  fireEvent.change(screen.getByLabelText('Tag'), { target: { value: 't1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Rejected rule');
});
