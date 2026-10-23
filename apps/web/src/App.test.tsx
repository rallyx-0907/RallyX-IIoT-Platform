import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from './App';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const response = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
class OfflineSocket { onopen = null; onmessage = null; onclose = null; onerror = null; close() {} }

it('shows login and a visible authentication failure', async () => {
  vi.stubGlobal('fetch', vi.fn(() => response({ error: { message: 'Invalid username or password' } }, 401)));
  render(<App />);
  await screen.findByRole('heading', { name: 'Sign in to RallyX' });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'operator' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'incorrect-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
});

it('renders an empty configuration without inventing equipment', async () => {
  vi.stubGlobal('WebSocket', OfflineSocket);
  vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/auth/me')
    ? response({ id: 'viewer', username: 'viewer', role: 'viewer', must_change_password: false })
    : response([])));
  render(<App />);
  expect(await screen.findByText('No assets configured')).toBeTruthy();
  expect(screen.queryByText('Motor 01')).toBeNull();
});

it('keeps API failures visible instead of showing successful empty data', async () => {
  vi.stubGlobal('WebSocket', OfflineSocket);
  vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/auth/me')
    ? response({ id: 'viewer', username: 'viewer', role: 'viewer', must_change_password: false })
    : response({ error: { message: 'Database unavailable' } }, 503)));
  render(<App />);
  expect(await screen.findByText('Database unavailable')).toBeTruthy();
});
