import { describe, expect, it } from 'vitest';
import { defaultCanvas, snapAndClamp, resizeControl, duplicateControl } from './geometry';
import { resolveBinding } from './binding';
import { createControl } from './registry';
import type { Tag } from '../../types/platform';

const tag = { id: 'a', value: 25, quality: 'GOOD', ts: '2026-11-02T00:00:00Z', stale_seconds: 30 } as Tag;
describe('simulation helpers', () => {
  it('snaps and clamps controls inside canvas including oversized requests', () => {
    const control = createControl('rectangle', 0, 0);
    expect(snapAndClamp(control, -20, 10000, defaultCanvas)).toMatchObject({ x: 0, y: 690 });
    expect(resizeControl(control, 50000, -5, defaultCanvas)).toMatchObject({ width: 1200, height: 16 });
    expect(duplicateControl(control, defaultCanvas).id).not.toBe(control.id);
  });
  it('resolves typed comparisons without coercion', () => {
    const tags = new Map([['a', tag]]);
    expect(resolveBinding({ tagId: 'a', operator: '>=', compareValue: 20 }, tags, { mode: 'live', now: Date.parse(tag.ts!) }).conditionMatched).toBe(true);
    expect(resolveBinding({ tagId: 'a', operator: '==', compareValue: '25' }, tags, { mode: 'live', now: Date.parse(tag.ts!) }).conditionMatched).toBe(false);
  });
  it('never treats unavailable data as OFF or zero', () => {
    for (const modified of [{ ...tag, quality: 'BAD' }, { ...tag, ts: undefined }, { ...tag, enabled: false }]) {
      expect(resolveBinding({ tagId: 'a', operator: 'direct' }, new Map([['a', modified as Tag]]), { mode: 'live' })).toMatchObject({ available: false, value: undefined, conditionMatched: undefined });
    }
    expect(resolveBinding({ tagId: 'a', operator: 'direct' }, new Map([['a', tag]]), { mode: 'live', now: Date.parse(tag.ts!) + 31000 }).available).toBe(false);
    expect(resolveBinding({ tagId: 'a', operator: 'direct' }, new Map([['a', tag]]), { mode: 'live', offline: true }).available).toBe(false);
  });
  it('preview values are local and keep source objects intact', () => {
    const previewValues = { a: false };
    expect(resolveBinding({ tagId: 'a', operator: 'direct' }, new Map([['a', tag]]), { mode: 'preview', previewValues, offline: true })).toMatchObject({ available: true, value: false, conditionMatched: false });
    expect(tag.value).toBe(25);
    expect(resolveBinding({ tagId: 'missing', operator: 'direct' }, new Map(), { mode: 'preview', previewValues }).available).toBe(false);
  });
  it('rejects unsupported runtime values instead of crashing or displaying a plausible state', () => {
    for (const value of [null, { unexpected: true }, [], Infinity]) {
      const invalid = { ...tag, value } as unknown as Tag;
      expect(resolveBinding({ tagId: 'a', operator: 'direct' }, new Map([['a', invalid]]), { mode: 'live', now: Date.parse(tag.ts!) }).available).toBe(false);
    }
  });
});
