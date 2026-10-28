import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Assets } from './Assets';
import type { PlatformData } from '../types/platform';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('shows hierarchy levels with separate tag metadata and accessible selection and collapse', () => {
  const onSelect = vi.fn();
  const data = { assets: [], tags: [], alarms: [], events: [], rules: [], tree: [{ id: 's', name: 'Plant', areas: [{ id: 'a', name: 'Utilities', assets: [{ id: 'asset', name: 'Compressor', type: 'equipment', enabled: true, devices: [{ id: 'd', name: 'Meter', connection_id: 'c', enabled: true, status: 'CONNECTED', tags: [{ id: 't', key: 'current', name: 'Current', data_type: 'float64', unit: 'A', enabled: true, realtime_enabled: true, store_history: true }] }] }] }] }] } as PlatformData;
  render(<Assets data={data} selected="asset" onSelect={onSelect} offline={false} user={{ id: 'u', username: 'viewer', role: 'viewer', must_change_password: false }} onRefresh={async () => {}} />);
  expect(screen.getByRole('navigation', { name: 'Asset hierarchy' })).toBeTruthy();
  for (const level of ['Site', 'Area', 'Asset', 'Device']) expect(screen.getByText(level)).toBeTruthy();
  const asset = screen.getByRole('button', { name: 'Compressor' });
  expect(asset.getAttribute('aria-current')).toBe('true');
  fireEvent.click(asset);
  expect(onSelect).toHaveBeenCalledWith('asset');
  const tag = screen.getByText('Current');
  expect(tag.textContent).toBe('Current');
  expect(tag.parentElement?.textContent).toContain('current · float64');
  const device = screen.getByRole('button', { name: 'Meter' });
  expect(device.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(device);
  expect(device.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('Current')).toBeNull();
  fireEvent.click(device);
  expect(screen.getByText('Current')).toBeTruthy();
});
it('renders the local device/tag hierarchy and creates an asset in an area', async () => {
  const data = { assets: [], tags: [], alarms: [], events: [], rules: [], tree: [{ id: 's', name: 'Plant', areas: [{ id: 'a', name: 'Utilities', assets: [{ id: 'asset', name: 'Compressor', type: 'equipment', enabled: true, devices: [{ id: 'd', name: 'Meter', connection_id: 'c', enabled: true, status: 'CONNECTED', tags: [{ id: 't', key: 'pressure', name: 'Pressure', data_type: 'float32', unit: 'bar', enabled: true, realtime_enabled: true, store_history: true }] }] }] }] }] } as PlatformData;
  const fetch = vi.fn(async (_path: string, _options: RequestInit) => new Response('{}', { status: 201 }));
  vi.stubGlobal('fetch', fetch);
  render(<Assets data={data} selected="" onSelect={() => {}} offline={false} user={{ id: 'u', username: 'admin', role: 'admin', must_change_password: false }} onRefresh={async () => {}} />);
  expect(screen.getByText('Meter')).toBeTruthy();
  expect(screen.getByText('Pressure')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '+ Add asset' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Cooling' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create asset' }));
  await screen.findByRole('button', { name: '+ Add asset' });
  const body = JSON.parse(String(fetch.mock.calls[0][1].body));
  expect(body).toMatchObject({ area_id: 'a', name: 'Cooling' });
  expect(body).not.toHaveProperty('panel_id');
});

it('can create the initial site without demo data', async () => {
  const fetch = vi.fn(async (_path: string, _options: RequestInit) => new Response('{}', { status: 201 }));
  vi.stubGlobal('fetch', fetch);
  render(<Assets data={{ assets: [], tags: [], alarms: [], events: [], rules: [], tree: [] }} selected="" onSelect={() => {}} offline={false} user={{ id: 'u', username: 'admin', role: 'admin', must_change_password: false }} onRefresh={async () => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '+ Add site' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Factory' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create site' }));
  await screen.findByRole('button', { name: '+ Add site' });
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/sites');
  expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual({ name: 'Factory' });
});
