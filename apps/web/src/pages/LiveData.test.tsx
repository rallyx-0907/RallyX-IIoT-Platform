import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LiveData } from './LiveData';
import type { PlatformData } from '../types/platform';

afterEach(cleanup);
it('shows only realtime enabled tags and filters by device', () => {
  const data = { assets: [{ id: 'a', name: 'Cooling' }], tags: [
    { id: 't1', asset_id: 'a', device_id: 'd1', device_name: 'Inlet', key: 'temp', name: 'Inlet temperature', quality: 'GOOD', value: 10, realtime_enabled: true, enabled: true },
    { id: 't2', asset_id: 'a', device_id: 'd2', device_name: 'Outlet', key: 'temp', name: 'Outlet temperature', quality: 'GOOD', value: 20, realtime_enabled: true, enabled: true },
    { id: 't3', asset_id: 'a', device_id: 'd2', key: 'private', name: 'Hidden signal', quality: 'GOOD', realtime_enabled: false, enabled: true },
  ] } as unknown as PlatformData;
  render(<LiveData data={data} offline={false} />);
  expect(screen.queryByText('Hidden signal')).toBeNull();
  fireEvent.change(screen.getByLabelText('Filter by device'), { target: { value: 'd2' } });
  expect(screen.queryByText('Inlet temperature')).toBeNull();
  expect(screen.getByText('Outlet temperature')).toBeTruthy();
  expect(screen.getByText('GOOD').className).toContain('badge-good');
});
