import { test } from 'node:test';
import assert from 'node:assert/strict';
import { telemetryMessages, updateControls } from './simulator.mjs';

test('simulator emits registered IDs and the production MQTT contract', () => {
  const messages = telemetryMessages({ siteId: 'site-a', motorId: 'motor-a', sensorId: 'sensor-a' }, { enabled: true, run: true, fault: false, current: 7.5, value: 25 }, new Date('2026-10-23T01:30:10Z'));
  assert.equal(messages[0].topic, 'rallyx/site-a/motor-a/telemetry');
  assert.deepEqual(JSON.parse(messages[0].payload), { ts: '2026-10-23T01:30:10.000Z', tags: { run: true, fault: false, current: 7.5 }, quality: 'good' });
  assert.equal(messages[0].retain, false);
  assert.equal(messages[0].qos, 1);
  assert.deepEqual(telemetryMessages({}, { enabled: false }, new Date()), []);
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
