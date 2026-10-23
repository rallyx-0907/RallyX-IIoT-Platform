import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

afterEach(cleanup);
describe('StatusBadge', () => {
  it('shows stale quality instead of claiming an old run value is live', () => {
    render(<StatusBadge value={true} quality="stale" />);
    expect(screen.getByText('STALE')).toBeTruthy();
    expect(screen.queryByText('RUN')).toBeNull();
  });
  it('shows unknown when no telemetry exists', () => {
    render(<StatusBadge quality="unknown" />);
    expect(screen.getByText('UNKNOWN')).toBeTruthy();
  });
  it('distinguishes stopped and running assets', () => {
    const { rerender } = render(<StatusBadge value={false} quality="good" />);
    expect(screen.getByText('STOP')).toBeTruthy();
    rerender(<StatusBadge value={true} quality="good" />);
    expect(screen.getByText('RUN')).toBeTruthy();
  });
});
