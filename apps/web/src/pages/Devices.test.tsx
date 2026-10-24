import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Devices } from './Devices';
const admin = { id: 'a', username: 'admin', role: 'admin' as const, must_change_password: false };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function backend(fail = false) {
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit = {}) => {
    const method = init.method || 'GET'; calls.push({ path, method, body: init.body ? JSON.parse(String(init.body)) : {} });
    const lists: Record<string, unknown> = { devices: [{ id: 'd', name: 'Meter', asset_id: 'a', connection_id: 'c', template_id: 't', enabled: true, metadata: { location: 'Bay' } }], assets: [{ id: 'a', name: 'Line', site_id: 's' }], connections: [{ id: 'c', name: 'Link', site_id: 's', protocol: 'simulator', enabled: true }], templates: [{ id: 't', name: 'Meter recipe', protocol: 'simulator', manufacturer: 'Maker', model: 'M', version: 2, tag_definitions: [{ key: 'amps' }] }, { id: 't2', name: 'PLC recipe', protocol: 'modbus-tcp', tag_definitions: [] }] };
    return new Response(JSON.stringify(method === 'GET' ? lists[path.split('/').pop()!] : fail ? { error: { message: 'Invalid device' } } : {}), { status: method !== 'GET' && fail ? 422 : 200 });
  })); return calls;
}
it('creates an instance with a protocol-compatible template', async () => {
  const calls = backend(); render(<Devices user={admin} />); await screen.findByText('Meter');
  fireEvent.click(screen.getByRole('button', { name: 'Add device' }));
  expect(screen.queryByRole('option', { name: /PLC recipe/ })).toBeNull();
  fireEvent.change(screen.getByLabelText('Device name'), { target: { value: 'New meter' } });
  fireEvent.change(screen.getByLabelText('Template'), { target: { value: 't' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save device' })); await screen.findByText('Device saved.');
  expect(calls.find(c => c.method === 'POST')?.body).toMatchObject({ name: 'New meter', asset_id: 'a', connection_id: 'c', template_id: 't', manufacturer: 'Maker', model: 'M' });
});
it('omits immutable fields on edit and preserves metadata while disabling polling', async () => {
  const calls = backend(); render(<Devices user={admin} />); fireEvent.click(await screen.findByRole('button', { name: 'Edit Meter' }));
  fireEvent.click(screen.getByLabelText('Enabled')); fireEvent.click(screen.getByRole('button', { name: 'Save device' })); await screen.findByText('Device saved.');
  const body = calls.find(c => c.method === 'PATCH')?.body;
  expect(body).toMatchObject({ enabled: false, metadata: { location: 'Bay' } }); expect(body).not.toHaveProperty('asset_id'); expect(body).not.toHaveProperty('template_id');
});
it('requires archive confirmation and exposes server errors', async () => {
  const calls = backend(true); render(<Devices user={admin} />); fireEvent.click(await screen.findByRole('button', { name: 'Archive Meter' }));
  expect(calls.some(c => c.method === 'DELETE')).toBe(false); fireEvent.click(screen.getByRole('button', { name: 'Confirm archive' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Invalid device'); expect(calls.find(c => c.method === 'DELETE')?.body).toEqual({ confirm: true, history_policy: 'retain' });
});
it('keeps viewers read-only', async () => {
  backend(); render(<Devices user={{ ...admin, role: 'viewer' }} />); await screen.findByText('Meter');
  expect(screen.queryByRole('button', { name: 'Add device' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Edit Meter' })).toBeNull();
});
it('stores typed generic simulator values with the device metadata', async () => {
  const calls = backend(); render(<Devices user={admin} />); fireEvent.click(await screen.findByRole('button', { name: 'Edit Meter' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add simulator value' }));
  fireEvent.change(screen.getByLabelText('Simulator 1 key'), { target: { value: 'amps' } });
  fireEvent.change(screen.getByLabelText('Simulator 1 value'), { target: { value: '12.5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save device' })); await screen.findByText('Device saved.');
  expect(calls.find(c => c.method === 'PATCH')?.body.metadata).toEqual({ location: 'Bay', simulator_values: { amps: 12.5 } });
});
it('keeps unsaved device edits visible after validation failure', async () => {
  backend(true); render(<Devices user={admin} />); fireEvent.click(await screen.findByRole('button', { name: 'Edit Meter' }));
  fireEvent.change(screen.getByLabelText('Device name'), { target: { value: 'Correctable' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save device' })); await screen.findByRole('alert');
  expect(screen.getByLabelText('Device name')).toHaveProperty('value', 'Correctable');
});
it('archives successfully with retained-history policy', async () => {
  const calls = backend(); render(<Devices user={admin} />); fireEvent.click(await screen.findByRole('button', { name: 'Archive Meter' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm archive' })); await screen.findByText('Device archived. History retained.');
  expect(calls.find(c => c.method === 'DELETE')?.path).toBe('/api/v1/devices/d');
});
