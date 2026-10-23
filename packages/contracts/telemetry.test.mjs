import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceTopic, telemetry } from './telemetry.mjs';

test('shared device topic and normalized telemetry match the Core contract', () => {
  assert.equal(deviceTopic('drive-a'), 'rallyx/v1/device/drive-a/telemetry');
  assert.deepEqual(telemetry({ id: 'drive-a', asset_id: 'asset-a' }, { run: true, current: 7.42 }, '2026-10-23T09:00:00+07:00'), {
    timestamp: '2026-10-23T02:00:00.000Z', device_id: 'drive-a', asset_id: 'asset-a', values: { run: true, current: 7.42 }, quality: 'GOOD',
  });
  assert.throws(() => deviceTopic('bad/+'));
  assert.throws(() => telemetry({ id: 'drive-a', asset_id: 'asset-a' }, { run: null }));
  assert.throws(() => telemetry({ id: 'drive-a', asset_id: 'asset-a' }, { run: true }, '2026-10-23T09:00:00'));
  assert.throws(() => telemetry({ id: 'drive-a', asset_id: 'asset-a' }, { value: Infinity }));
});
