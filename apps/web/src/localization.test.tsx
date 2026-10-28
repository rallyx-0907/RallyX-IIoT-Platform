import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from './App';
import { setLanguage, t } from './i18n';
import { Devices } from './pages/Devices';
import { LiveData } from './pages/LiveData';
import { AlarmsTable } from './components/DataDisplay';
import type { PlatformData } from './types/platform';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLanguage('en'); });
const admin = { id: 'a', username: 'admin', role: 'admin' as const, must_change_password: false };

it('switches login labels without losing an entered account name', async () => {
  setLanguage('vi');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Authentication required' } }), { status: 401 })));
  render(<App />);
  await screen.findByRole('heading', { name: t('Sign in to RallyX') });
  const input = screen.getByLabelText(t('Username')) as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'Bơm vận hành' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Ngôn ngữ / Language' }), { target: { value: 'en' } });
  expect(await screen.findByRole('heading', { name: 'Sign in to RallyX' })).toBeTruthy();
  expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('Bơm vận hành');
});

it('uses Vietnamese state and quality labels without translating configured names or values', () => {
  setLanguage('vi');
  const tag = { asset_id: 'a', device_id: 'd', device_name: 'Running', quality: 'GOOD', ts: new Date().toISOString(), stale_seconds: 30 };
  const data = { assets: [{ id: 'a', name: 'Current' }], tags: [
    { ...tag, id: 'r', name: 'Run', key: 'run', semantic: 'run', value: true },
    { ...tag, id: 's', name: 'Custom text', key: 'text', value: 'Stopped' },
  ] } as unknown as PlatformData;
  render(<LiveData data={data} offline={false} />);
  const region = screen.getByRole('region', { name: 'Running' });
  expect(within(region).getByText('Current')).toBeTruthy();
  expect(within(region).getByText('Stopped')).toBeTruthy();
  expect(within(region).getAllByText(t('Running')).length).toBeGreaterThan(0);
  expect(within(region).getAllByText(t('GOOD')).length).toBeGreaterThan(0);
});

it('posts machine boolean and number values from translated simulator controls', async () => {
  setLanguage('vi');
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const lists: Record<string, unknown> = {
    devices: [{ id: 'd', name: 'Current', asset_id: 'a', connection_id: 'c', enabled: true, metadata: {} }],
    assets: [{ id: 'a', name: 'Run', site_id: 's' }],
    connections: [{ id: 'c', name: 'Link', site_id: 's', protocol: 'simulator', enabled: true }], templates: [],
  };
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit = {}) => {
    if (init.method) calls.push({ path, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(init.method ? {} : lists[path.split('/').pop()!]), { status: 200 });
  }));
  render(<Devices user={admin} />);
  fireEvent.click(await screen.findByRole('button', { name: t('Edit {0}', { 0: 'Current' }) }));
  fireEvent.click(screen.getByRole('button', { name: t('Add simulator value') }));
  fireEvent.change(screen.getByLabelText(t('Simulator {0} key', { 0: 1 })), { target: { value: 'run' } });
  const type = screen.getByLabelText(t('Simulator {0} type', { 0: 1 })) as HTMLSelectElement;
  expect(within(type).getByRole('option', { name: t('boolean') }).getAttribute('value')).toBe('boolean');
  fireEvent.change(type, { target: { value: 'boolean' } });
  fireEvent.change(screen.getByLabelText(t('Simulator {0} value', { 0: 1 })), { target: { value: 'true' } });
  fireEvent.click(screen.getByRole('button', { name: t('Add simulator value') }));
  fireEvent.change(screen.getByLabelText(t('Simulator {0} key', { 0: 2 })), { target: { value: 'current' } });
  fireEvent.change(screen.getByLabelText(t('Simulator {0} value', { 0: 2 })), { target: { value: '12.5' } });
  fireEvent.click(screen.getByRole('button', { name: t('Save device') }));
  await screen.findByText(t('Device saved.'));
  expect(calls[0].body).toMatchObject({ name: 'Current', metadata: { simulator_values: { run: true, current: 12.5 } } });
});

it('translates severity text while retaining the severity colour class', () => {
  setLanguage('vi');
  render(<AlarmsTable alarms={[{ id: 1, asset_id: 'a', asset_name: 'Critical Pump', rule_name: 'High current', severity: 'critical', activated_at: new Date().toISOString(), acknowledged_at: null, cleared_at: null }]} canAck={false} onAck={() => {}} />);
  expect(screen.getByText(t('critical')).className).toContain('badge-critical');
  expect(screen.getByText('Critical Pump')).toBeTruthy();
});
