import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { SimulationEditor } from './SimulationEditor';
import type { DashboardDocument } from '../../types/simulation';
import type { Tag } from '../../types/platform';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const initial = { id: 'test', name: 'Tủ điện', type: 'simulation', canvas: { width: 1200, height: 800, gridSize: 10, snapToGrid: true }, layout: [], revision: 1 } as unknown as DashboardDocument;
function Fixture({ seed = initial, tags = [] }: { seed?: DashboardDocument; tags?: Tag[] }) {
  const [dashboard, setDashboard] = useState(seed);
  return <><output data-testid="count">{dashboard.layout.length}</output><SimulationEditor dashboard={dashboard} onChange={setDashboard} tags={tags} mode="design" connection="live" /></>;
}
it('adds, duplicates and deletes controls without intercepting text editing', () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: /Thêm Nhãn văn bản/i }));
  expect(screen.getByTestId('count').textContent).toBe('1');
  fireEvent.click(screen.getByRole('button', { name: 'Nhân bản' }));
  expect(screen.getByTestId('count').textContent).toBe('2');
  const text = screen.getByLabelText('Nội dung');
  fireEvent.keyDown(text, { key: 'Delete' });
  expect(screen.getByTestId('count').textContent).toBe('2');
  fireEvent.click(screen.getByRole('button', { name: 'Xóa phần tử' }));
  expect(screen.getByTestId('count').textContent).toBe('1');
});
it('live mode has no editing actions and preview never changes persisted configuration', () => {
  const onChange = vi.fn();
  const { rerender } = render(<SimulationEditor dashboard={initial} onChange={onChange} tags={[]} mode="live" connection="connected" />);
  expect(screen.queryByRole('button', { name: /Thêm Nhãn văn bản/i })).toBeNull();
  rerender(<SimulationEditor dashboard={initial} onChange={onChange} tags={[]} mode="preview" connection="connected" />);
  expect(screen.getByText(/Giá trị xem thử chỉ tồn tại/i)).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
});
it('clamps exact positioning and supports keyboard nudging and layering', () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: /Thêm Nhãn văn bản/i }));
  fireEvent.change(screen.getByLabelText('X (px)'), { target: { value: '50000' } });
  fireEvent.blur(screen.getByLabelText('X (px)'));
  expect((screen.getByLabelText('X (px)') as HTMLInputElement).value).toBe('1020');
  fireEvent.keyDown(screen.getByLabelText('Sơ đồ thiết bị'), { key: 'ArrowLeft' });
  expect((screen.getByLabelText('X (px)') as HTMLInputElement).value).toBe('1019');
  fireEvent.keyDown(screen.getByLabelText('Sơ đồ thiết bị'), { key: 'ArrowLeft', shiftKey: true });
  expect((screen.getByLabelText('X (px)') as HTMLInputElement).value).toBe('1009');
  fireEvent.click(screen.getByRole('button', { name: 'Đưa lên trước' }));
  expect(document.querySelector<HTMLElement>('[data-control-id]')?.style.zIndex).toBe('1');
  fireEvent.keyDown(screen.getByLabelText('Sơ đồ thiết bị'), { key: 'Escape' });
  expect(screen.queryByLabelText('X (px)')).toBeNull();
});
it('shares local preview values across controls and never calls a write handler', () => {
  const onChange = vi.fn();
  const tag = { id: 'running', name: 'Động cơ chạy', device_id: 'motor', datatype: 'bool', value: false, quality: 'GOOD' } as Tag;
  const dashboard: DashboardDocument = { ...initial, layout: [0, 1].map(index => ({ id: String(index), type: 'indicator-lamp', x: index * 100, y: 0, width: 80, height: 100, rotation: 0, zIndex: 0, properties: { label: 'Đèn ' + index, onColor: '#16a34a', offColor: '#64748b' }, binding: { tagId: 'running', operator: 'direct' } })) };
  render(<SimulationEditor dashboard={dashboard} onChange={onChange} tags={[tag]} mode="preview" connection="offline" />);
  fireEvent.change(screen.getByLabelText('Động cơ chạy'), { target: { value: 'true' } });
  expect(screen.getAllByText('BẬT').length).toBe(2);
  expect(tag.value).toBe(false);
  expect(onChange).not.toHaveBeenCalled();
});
it('moves and resizes with pointer input, snaps to grid, and drops palette controls', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: /Thêm Nhãn văn bản/i }));
  const canvas = document.querySelector<HTMLElement>('.simulation-canvas')!;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800, toJSON() {} });
  fireEvent.pointerDown(document.querySelector('[data-control-id]')!, { button: 0, clientX: 50, clientY: 50 });
  fireEvent.pointerMove(canvas, { clientX: 117, clientY: 87 });
  fireEvent.pointerUp(canvas);
  expect((screen.getByLabelText('X (px)') as HTMLInputElement).value).toBe('110');
  expect((screen.getByLabelText('Y (px)') as HTMLInputElement).value).toBe('80');
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Đổi kích thước' }), { button: 0, clientX: 290, clientY: 120 });
  fireEvent.pointerMove(canvas, { clientX: 336, clientY: 146 });
  fireEvent.pointerUp(canvas);
  expect((screen.getAllByLabelText('Rộng (px)')[1] as HTMLInputElement).value).toBe('230');
  fireEvent.drop(canvas, { clientX: 300, clientY: 300, dataTransfer: { getData: () => 'rectangle' } });
  expect(screen.getByTestId('count').textContent).toBe('2');
});
it('filters gauge bindings to numeric signals and direct operators', () => {
  const tags = [{ id: 'run', device_id: 'a', datatype: 'bool', name: 'Chạy', key: 'run' }, { id: 'current', device_id: 'a', datatype: 'float64', name: 'Dòng điện', key: 'current' }] as Tag[];
  render(<Fixture tags={tags} />);
  fireEvent.click(screen.getByRole('button', { name: /Thêm Đồng hồ kim/i }));
  const picker = screen.getByLabelText('Tín hiệu');
  expect(picker.textContent).toContain('Dòng điện');
  expect(picker.textContent).not.toContain('Chạy');
  fireEvent.change(picker, { target: { value: 'current' } });
  expect((screen.getByLabelText('Phép so sánh') as HTMLSelectElement).options.length).toBe(1);
  fireEvent.change(screen.getByLabelText('Số lẻ'), { target: { value: '1.5' } });
  fireEvent.blur(screen.getByLabelText('Số lẻ'));
  expect((screen.getByLabelText('Số lẻ') as HTMLInputElement).value).toBe('2');
});
it('keeps control dimensions when a smaller canvas moves it back into bounds', () => {
  const seed: DashboardDocument = { ...initial, layout: [{ id: 'far', type: 'text', x: 900, y: 40, width: 180, height: 40, rotation: 0, zIndex: 1, properties: { text: 'Tên máy' } }] };
  render(<Fixture seed={seed} />);
  fireEvent.change(screen.getByLabelText('Rộng (px)'), { target: { value: '600' } });
  fireEvent.blur(screen.getByLabelText('Rộng (px)'));
  const control = document.querySelector<HTMLElement>('[data-control-id="far"]')!;
  expect(control.style.width).toBe('180px');
  expect(control.style.left).toBe('420px');
});
it('buffers incomplete numeric input and commits negative gauge ranges on Enter', () => {
  render(<Fixture />);
  const width = screen.getByLabelText('Rộng (px)');
  fireEvent.change(width, { target: { value: '' } });
  fireEvent.change(width, { target: { value: '8' } });
  expect(document.querySelector<HTMLElement>('.simulation-canvas')!.style.width).toBe('1200px');
  fireEvent.change(width, { target: { value: '800' } });
  fireEvent.blur(width);
  expect(document.querySelector<HTMLElement>('.simulation-canvas')!.style.width).toBe('800px');
  fireEvent.click(screen.getByRole('button', { name: /Thêm Đồng hồ kim/i }));
  const minimum = screen.getByLabelText('Nhỏ nhất');
  fireEvent.change(minimum, { target: { value: '-' } });
  expect((minimum as HTMLInputElement).value).toBe('-');
  fireEvent.change(minimum, { target: { value: '-20' } });
  fireEvent.keyDown(minimum, { key: 'Enter' });
  expect(screen.getByText('-20')).toBeTruthy();
});
