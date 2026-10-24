import { test } from 'node:test';
import assert from 'node:assert/strict';
import { telemetryMessages, updateControls, generateFlow } from './simulator.mjs';
import { runInNewContext } from 'node:vm';

test('simulator emits registered IDs and the production MQTT contract', () => {
  const messages = telemetryMessages({ motorId: 'motor-a', motorDeviceId: 'drive-a', sensorId: 'sensor-a', sensorDeviceId: 'sensor-device-a' }, { enabled: true, run: true, fault: false, current: 7.5, value: 25 }, new Date('2026-10-23T01:30:10Z'));
  assert.equal(messages[0].topic, 'rallyx/v1/device/drive-a/telemetry');
  assert.deepEqual(JSON.parse(messages[0].payload), { timestamp: '2026-10-23T01:30:10.000Z', device_id: 'drive-a', asset_id: 'motor-a', values: { run: true, fault: false, current: 7.5 }, quality: 'GOOD' });
  assert.equal(messages[0].retain, false);
  assert.equal(messages[0].qos, 1);
  assert.deepEqual(telemetryMessages({}, { enabled: false }, new Date()), []);
});

test('generated Node-RED function embeds shared helpers and configured device identities', () => {
  const node = generateFlow().find(node => node.id === 'publish');
  const settings = { SIMULATOR_ENABLED: 'true', SIMULATOR_MOTOR_ASSET_ID: 'asset-a', SIMULATOR_MOTOR_DEVICE_ID: 'device-a', SIMULATOR_SENSOR_ASSET_ID: 'asset-b', SIMULATOR_SENSOR_DEVICE_ID: 'device-b' };
  const messages = runInNewContext(`(function(){${node.func}})()`, { env: { get: key => settings[key] }, flow: { get: () => undefined }, Date });
  assert.equal(messages[0][0].topic, 'rallyx/v1/device/device-a/telemetry');
  assert.equal(JSON.parse(messages[0][1].payload).device_id, 'device-b');
});

test('controls reject invalid types rather than coercing them', () => {
  const state = { enabled: true, run: false, fault: false, current: 0, value: 25 };
  assert.throws(() => updateControls(state, { run: 'false' }));
  assert.throws(() => updateControls(state, { current: null }));
  assert.throws(() => updateControls(state, { value: Infinity }));
  assert.throws(() => updateControls(state, { arbitrary: true }));
  assert.deepEqual(updateControls(state, { run: true, current: 4 }), { enabled: true, run: true, fault: false, current: 4, value: 25 });
  assert.equal(state.run, false);
});
