import type { ControlInstance, SimulationCanvas } from '../../types/simulation';

export const defaultCanvas: SimulationCanvas = { width: 1200, height: 800, gridSize: 10, snapToGrid: true, backgroundColor: '#f8fafc' };
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const snapped = (value: number, canvas: SimulationCanvas) => canvas.snapToGrid ? Math.round(value / Math.max(1, canvas.gridSize)) * Math.max(1, canvas.gridSize) : value;
export function createControlID() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return 'control_' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
export function snapAndClamp(control: ControlInstance, x: number, y: number, canvas: SimulationCanvas): ControlInstance {
  return { ...control, x: clamp(snapped(finite(x, control.x), canvas), 0, Math.max(0, canvas.width - control.width)), y: clamp(snapped(finite(y, control.y), canvas), 0, Math.max(0, canvas.height - control.height)) };
}
export function resizeControl(control: ControlInstance, width: number, height: number, canvas: SimulationCanvas): ControlInstance {
  const availableWidth = Math.max(1, canvas.width - control.x);
  const availableHeight = Math.max(1, canvas.height - control.y);
  return { ...control, width: clamp(snapped(finite(width, control.width), canvas), Math.min(16, availableWidth), availableWidth), height: clamp(snapped(finite(height, control.height), canvas), Math.min(16, availableHeight), availableHeight) };
}
export function duplicateControl(control: ControlInstance, canvas: SimulationCanvas): ControlInstance {
  return snapAndClamp({ ...control, id: createControlID(), properties: { ...control.properties }, binding: control.binding ? { ...control.binding } : undefined, zIndex: control.zIndex + 1 }, control.x + canvas.gridSize, control.y + canvas.gridSize, canvas);
}
