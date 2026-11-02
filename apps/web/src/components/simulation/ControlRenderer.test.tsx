import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ControlRenderer } from './ControlRenderer';
import { CONTROL_REGISTRY, createControl, safeImageSource } from './registry';
afterEach(cleanup);
describe('simulation controls', () => {
  it('has all seven generic controls', () => expect(Object.keys(CONTROL_REGISTRY)).toHaveLength(7));
  it('shows unavailable lamp distinctly from OFF', () => {
    const { rerender } = render(<ControlRenderer control={createControl('indicator-lamp')} resolved={{ available: false, quality: 'STALE', reason: 'Dữ liệu quá hạn' }} />);
    expect(screen.getByText('?')).toBeTruthy();
    expect(screen.getByTitle('Dữ liệu quá hạn')).toBeTruthy();
    rerender(<ControlRenderer control={createControl('indicator-lamp')} resolved={{ available: true, quality: 'GOOD', value: false, conditionMatched: false }} />);
    expect(screen.getByText('TẮT')).toBeTruthy();
  });
  it('clamps needle but preserves actual numeric display', () => {
    const control = createControl('analog-gauge');
    control.properties.precision = 2;
    const { container } = render(<ControlRenderer control={control} resolved={{ available: true, quality: 'GOOD', value: 150 }} />);
    expect(screen.getByText('150.00')).toBeTruthy();
    expect(container.innerHTML).not.toContain('NaN');
    expect(container.innerHTML).not.toContain('Infinity');
  });
  it('renders unknown controls and unsafe images safely', () => {
    const control = { ...createControl('text'), type: 'future-control' };
    render(<ControlRenderer control={control as never} />);
    expect(screen.getByText('Thành phần chưa được hỗ trợ')).toBeTruthy();
    expect(safeImageSource('https://example.com/p.png')).toBeUndefined();
    expect(safeImageSource('/assets/../../p.png')).toBeUndefined();
    expect(safeImageSource('/images/my image.png')).toBeUndefined();
    expect(safeImageSource('/images/my.image.png')).toBeUndefined();
    expect(safeImageSource('/images/p.avif')).toBeUndefined();
    expect(safeImageSource('/images/p.png')).toBe('/images/p.png');
  });
  it('rejects nonfinite gauge values and invalid ranges without a needle', () => {
    const control = createControl('analog-gauge');
    control.properties.max = 0;
    const { container } = render(<ControlRenderer control={control} resolved={{ available: true, quality: 'GOOD', value: Infinity }} />);
    expect(screen.getByText('Không có dữ liệu số')).toBeTruthy();
    expect(container.innerHTML).not.toContain('NaN');
    expect(container.querySelector('circle')).toBeNull();
  });
  it('preserves valid gauge ranges above one million', () => {
    const control = createControl('analog-gauge');
    control.properties.min = 0;
    control.properties.max = 10000000;
    const { container } = render(<ControlRenderer control={control} resolved={{ available: true, quality: 'GOOD', value: 5000000 }} />);
    expect(screen.getByText('10000000')).toBeTruthy();
    const needle = container.querySelector('line');
    expect(Number(needle?.getAttribute('x2'))).toBeCloseTo(100);
    expect(Number(needle?.getAttribute('y2'))).toBeCloseTo(20);
  });
  it('formats strings and booleans without executing markup', () => {
    render(<ControlRenderer control={createControl('numeric-value')} resolved={{ available: true, quality: 'GOOD', value: '<img onerror=alert(1)>' }} />);
    expect(screen.getByText('<img onerror=alert(1)>')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });
});
