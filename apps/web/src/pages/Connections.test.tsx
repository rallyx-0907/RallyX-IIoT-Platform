import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Connections } from './Connections';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const admin = { id: 'a', username: 'admin', role: 'admin' as const, must_change_password: false };
const connection = { id: 'c', site_id: 's', name: 'Field link', protocol: 'modbus-tcp', enabled: true, polling_interval_ms: 1000, timeout_ms: 2000, retry_policy: {}, protocol_config: { host: '192.0.2.1', port: 502 }, status: 'CONNECTED', last_seen: '2026-10-24T01:00:00Z', has_credentials: true };
function backend(failSave = false) {
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    calls.push({ path, method, body: init.body ? JSON.parse(String(init.body)) : {} });
    let result: unknown = path.endsWith('/sites') ? [{ id: 's', name: 'Factory' }] : [connection];
    let status = 200;
    if (method !== 'GET') {
      result = path.endsWith('/test') ? { connected: true } : connection;
      if (failSave && method === 'PATCH') { status = 422; result = { error: { message: 'Invalid host' } }; }
    }
    return new Response(JSON.stringify(result), { status });
  }));
  return calls;
}

it('lets administrators edit a connection while retaining write-only credentials', async () => {
  const calls = backend();
  render(<Connections user={admin} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Field link' }));
  fireEvent.change(screen.getByLabelText('Host'), { target: { value: '192.0.2.2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
  await screen.findByText('Connection saved.');
  const saved = calls.find(call => call.method === 'PATCH')!;
  expect(saved.path).toBe('/api/v1/connections/c');
  expect(saved.body.protocol_config).toEqual({ host: '192.0.2.2', port: 502 });
  expect(saved.body).not.toHaveProperty('credentials');
  expect(saved.body).not.toHaveProperty('id');
});

it('shows diagnostic results and server validation failures', async () => {
  backend(true);
  render(<Connections user={admin} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Test Field link' }));
  expect(await screen.findByText('Field link: connection successful.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Field link' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Invalid host');
  expect(screen.getByRole('button', { name: 'Save connection' })).toBeTruthy();
});

it('keeps configuration and diagnostics read-only for viewers', async () => {
  const calls = backend();
  render(<Connections user={{ ...admin, role: 'viewer' }} />);
  await screen.findByText('Field link');
  expect(screen.queryByRole('button', { name: 'Add connection' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Test Field link' })).toBeNull();
  await waitFor(() => expect(calls.every(call => call.method === 'GET')).toBe(true));
});

it('creates a connection using the selected protocol and site', async () => {
  const calls = backend();
  render(<Connections user={admin} />);
  await screen.findByText('Field link');
  fireEvent.click(screen.getByRole('button', { name: 'Add connection' }));
  fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'New PLC' } });
  fireEvent.change(screen.getByLabelText('Protocol'), { target: { value: 'modbus-tcp' } });
  fireEvent.change(screen.getByLabelText('Host'), { target: { value: '192.0.2.20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
  await screen.findByText('Connection saved.');
  const saved = calls.find(call => call.method === 'POST')!;
  expect(saved.body).toMatchObject({ name: 'New PLC', site_id: 's', protocol: 'modbus-tcp', protocol_config: { host: '192.0.2.20', port: 502 } });
});

it('archives only after explicit confirmation and retains history', async () => {
  const calls = backend();
  render(<Connections user={admin} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Archive Field link' }));
  expect(calls.some(call => call.method === 'DELETE')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm archive' }));
  await screen.findByText('Connection archived. History retained.');
  expect(calls.find(call => call.method === 'DELETE')).toMatchObject({ path: '/api/v1/connections/c', body: { confirm: true, history_policy: 'retain' } });
});
