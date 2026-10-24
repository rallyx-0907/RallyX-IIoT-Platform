import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Templates } from './Templates';
const admin = { id: 'a', username: 'admin', role: 'admin' as const, must_change_password: false };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function backend(fail = false) {
  const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit = {}) => {
    const method = init.method || 'GET'; calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : {} });
    return new Response(JSON.stringify(method === 'GET' ? [{ id: 't', name: 'Recipe', protocol: 'modbus-tcp', version: 4, tag_definitions: [{ key: 'amps', name: 'Current', data_type: 'float32', address: '4', scale: 2, metadata: { register_count: 2 } }] }] : fail ? { error: { message: 'Invalid definition' } } : {}), { status: fail && method !== 'GET' ? 422 : 200 });
  })); return calls;
}
it('saves table tag edits without client versions or updating instances', async () => {
  const calls = backend(); render(<Templates user={admin} />); fireEvent.click(await screen.findByRole('button', { name: 'Edit Recipe' }));
  fireEvent.change(screen.getByLabelText('Tag 1 scale'), { target: { value: '3' } }); fireEvent.click(screen.getByRole('button', { name: 'Save template' })); await screen.findByText('Template saved. Existing devices keep their tags.');
  const saved = calls.find(c => c.method === 'PATCH')!; expect(saved.path).toBe('/api/v1/templates/t'); expect(saved.body).not.toHaveProperty('version');
  expect(saved.body.tag_definitions).toEqual([expect.objectContaining({ key: 'amps', scale: 3, metadata: { register_count: 2 } })]); expect(calls.some(c => c.path.includes('/devices'))).toBe(false);
});
it('creates templates with tag form controls', async () => {
  const calls = backend(); render(<Templates user={admin} />); await screen.findByText('Recipe'); fireEvent.click(screen.getByRole('button', { name: 'Add template' }));
  fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Sensor' } }); fireEvent.change(screen.getByLabelText('Tag 1 key'), { target: { value: 'temperature' } }); fireEvent.change(screen.getByLabelText('Tag 1 name'), { target: { value: 'Temperature' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save template' })); await screen.findByText('Template saved. Existing devices keep their tags.');
  expect(calls.find(c => c.method === 'POST')?.body).toMatchObject({ name: 'Sensor', protocol: 'simulator', tag_definitions: [expect.objectContaining({ key: 'temperature', data_type: 'float32' })] });
});
it('confirms archive and exposes failures', async () => {
  const calls = backend(true); render(<Templates user={admin} />); fireEvent.click(await screen.findByRole('button', { name: 'Archive Recipe' })); expect(calls.some(c => c.method === 'DELETE')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm archive' })); expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Invalid definition'); expect(calls.find(c => c.method === 'DELETE')?.body).toEqual({ confirm: true, history_policy: 'retain' });
});
it('keeps operators read-only', async () => {
  backend(); render(<Templates user={{ ...admin, role: 'operator' }} />); await screen.findByText('Recipe'); expect(screen.queryByRole('button', { name: 'Add template' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Edit Recipe' })).toBeNull();
});
it('rejects duplicate tag keys before sending a template update', async () => {
  const calls = backend(); render(<Templates user={admin} />); fireEvent.click(await screen.findByRole('button', { name: 'Edit Recipe' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add tag definition' }));
  fireEvent.change(screen.getByLabelText('Tag 2 key'), { target: { value: 'amps' } });
  fireEvent.change(screen.getByLabelText('Tag 2 name'), { target: { value: 'Duplicate' } });
  fireEvent.change(screen.getByLabelText('Tag 2 address'), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Tag keys must be unique identifiers.');
  expect(calls.some(c => c.method === 'PATCH')).toBe(false);
});
it('archives a template while retaining existing devices and history', async () => {
  const calls = backend(); render(<Templates user={admin} />); fireEvent.click(await screen.findByRole('button', { name: 'Archive Recipe' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm archive' })); await screen.findByText('Template archived. Existing devices and history retained.');
  expect(calls.find(c => c.method === 'DELETE')?.path).toBe('/api/v1/templates/t');
});
