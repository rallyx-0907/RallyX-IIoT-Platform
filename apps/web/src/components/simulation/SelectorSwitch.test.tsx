import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ControlRenderer } from './ControlRenderer';
import { createControl } from './registry';
import { validSelectorPositions } from './SelectorSwitch';
afterEach(cleanup);
it('matches positions strictly and remains read only', () => {
  const control = createControl('selector-switch' as never);
  const { container, rerender } = render(<ControlRenderer control={control} resolved={{ available: true, quality: 'GOOD', value: 1 }} />);
  expect(container.querySelector('[data-selected="true"]')?.textContent).toBe('Vị trí 2');
  fireEvent.click(screen.getByRole('img'));
  expect(container.querySelector('[data-selected="true"]')?.textContent).toBe('Vị trí 2');
  expect(container.querySelector('button,input,[role="switch"]')).toBeNull();
  rerender(<ControlRenderer control={control} resolved={{ available: true, quality: 'GOOD', value: '1' }} />);
  expect(container.querySelector('[data-selected="true"]')).toBeNull();
  expect(screen.getByText('?')).toBeTruthy();
});
it.each([false, true])('never selects BAD data (available %s)', (available) => {
  const { container } = render(<ControlRenderer control={createControl('selector-switch' as never)} resolved={{ available, quality: 'BAD', value: 0 }} />);
  expect(container.querySelector('[data-selected="true"]')).toBeNull();
  expect(screen.getByText('?')).toBeTruthy();
});
it('keeps default mappings independent', () => {
  const first = createControl('selector-switch' as never), second = createControl('selector-switch' as never);
  (first.properties.positions as {label:string}[])[0].label = 'changed';
  expect((second.properties.positions as {label:string}[])[0].label).toBe('Vị trí 1');
});
it('supports three custom string positions', () => {
  const control = createControl('selector-switch' as never);
  control.properties.positions = [{value:'a',label:'A'},{value:'b',label:'B'},{value:'c',label:'C'}];
  const { container } = render(<ControlRenderer control={control} resolved={{available:true,quality:'PREVIEW',value:'c'}} />);
  expect(container.querySelector('[data-selected="true"]')?.textContent).toBe('C');
});
it('rejects heterogeneous mappings safely', () => {
  const control = createControl('selector-switch' as never);
  control.properties.positions = [{value:1,label:'A'},{value:'1',label:'B'}];
  const { container } = render(<ControlRenderer control={control} resolved={{available:true,quality:'GOOD',value:1}} />);
  expect(container.querySelector('[data-selected="true"]')).toBeNull();
  expect(screen.getByText('?')).toBeTruthy();
});
it.each([
  {positions:[{value:0,label:'A'},{value:0,label:'B'}]},
  {positions:[{value:false,label:'A'},{value:true,label:'B'},{value:false,label:'C'}]},
  {positions:[{value:NaN,label:'A'},{value:1,label:'B'}]},
  {positions:[{value:0,label:'A'}]},
  {positions:[{value:0,label:42},{value:1,label:'B'}]},
])('rejects invalid position configuration $positions', ({positions}) => {
  expect(validSelectorPositions(positions)).toBe(false);
});
it('renders boolean mappings and uses only a bounded drawing at tiny sizes', () => {
  const control = createControl('selector-switch');
  control.properties.positions = [{value:false,label:'Lower'},{value:true,label:'Upper'}];
  const { container, rerender } = render(<ControlRenderer control={control} resolved={{available:true,quality:'GOOD',value:false}} />);
  expect(container.querySelector('[data-selected="true"]')?.textContent).toBe('Lower');
  expect(container.querySelector('.simulation-selector')?.children.length).toBe(4);
  rerender(<ControlRenderer control={{...control,width:40,height:40}} resolved={{available:false,quality:'OFFLINE',value:false}} />);
  expect(container.querySelector('.simulation-selector')?.getAttribute('data-density')).toBe('minimal');
  expect(container.querySelector('[data-selected="true"]')).toBeNull();
  expect(screen.getByText('?')).toBeTruthy();
});
it.each([
  [2, 0, -45], [2, 1, -135],
  [3, 0, -45], [3, 1, -90], [3, 2, -135],
])('points toward vertical labels for %i positions at index %i', (count, index, angle) => {
  const control = createControl('selector-switch');
  control.properties.orientation = 'vertical';
  control.properties.positions = Array.from({length:count}, (_, value) => ({value,label:String(value)}));
  const { container } = render(<ControlRenderer control={control} resolved={{available:true,quality:'GOOD',value:index}} />);
  expect(container.querySelector('svg g')?.getAttribute('transform')).toBe(`rotate(${angle} 60 60)`);
});
