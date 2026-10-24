import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { History, Trend } from './History';
import type { PlatformData } from '../types/platform';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('includes the current seconds in the default query end time', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T01:00:45Z'));
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
  render(<History data={{ assets: [], tags: [] } as unknown as PlatformData} />);
  expect((screen.getByLabelText('To') as HTMLInputElement).value).toMatch(/:45(?:\.000)?$/);
});
it('renders uppercase good-quality history and leaves gaps for bad samples', () => {
  render(<Trend samples={[
    { ts: '2026-10-24T01:00:00Z', value: 1, quality: 'GOOD' },
    { ts: '2026-10-24T01:01:00Z', value: 2, quality: 'BAD' },
    { ts: '2026-10-24T01:02:00Z', value: 3, quality: 'good' },
  ]} />);
  const svg = screen.getByRole('img', { name: 'Analog telemetry trend' });
  expect(svg.querySelectorAll('circle')).toHaveLength(2);
});
it('does not offer history-disabled tags or request their samples', async () => {
  const fetch = vi.fn(async (_path: string) => new Response('[]', { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  render(<History data={{ assets: [{ id: 'a', name: 'Utilities' }], tags: [{ id: 'hidden', asset_id: 'a', name: 'Current only', store_history: false }] } as unknown as PlatformData} />);
  await screen.findByText('No runtime sessions in this period');
  expect(screen.queryByRole('option', { name: 'Current only' })).toBeNull();
  expect(fetch.mock.calls.some(call => String(call[0]).includes('/tags/'))).toBe(false);
});
