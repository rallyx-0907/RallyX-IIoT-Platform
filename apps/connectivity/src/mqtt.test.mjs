import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectAsync } from 'mqtt';
import { createAdapter } from './adapters.mjs';

test('MQTT mapping preserves source timestamp and rejects other devices and stale cached messages', { skip: !process.env.TEST_MQTT_URL }, async t => {
  const url = process.env.TEST_MQTT_URL.replace(/^tcp:/, 'mqtt:');
  const publisher = await connectAsync(url);
  t.after(() => publisher.endAsync(true));
  const topic = `field/${Date.now()}/+`;
  const adapter = await createAdapter({ protocol: 'mqtt', timeout_ms: 150,
    protocol_config: { broker_url: url, topic } }, { id: 'device' });
  t.after(() => adapter.close());
  const tags = [{ id: 'tag', key: 'value', data_type: 'float32', address: 'values.temperature' }];
  const send = payload => publisher.publishAsync(topic.replace('+', 'sensor'), JSON.stringify(payload), { qos: 1 });
  await send({ device_id: 'other', values: { temperature: 99 } });
  await assert.rejects(adapter.read(tags));
  const reading = adapter.read(tags);
  await send({ device_id: 'device', timestamp: '2026-10-23T09:00:00Z', values: { temperature: '7.5' } });
  const result = await reading;
  assert.equal(result.values.value, 7.5); assert.equal(result.timestamp, '2026-10-23T09:00:00Z');
  await assert.rejects(adapter.read(tags));
});

test('MQTT preserves every burst transition in source order', { skip: !process.env.TEST_MQTT_URL }, async t => {
  const url = process.env.TEST_MQTT_URL.replace(/^tcp:/, 'mqtt:');
  const publisher = await connectAsync(url); t.after(() => publisher.endAsync(true));
  const topic = `field/burst/${Date.now()}`;
  const adapter = await createAdapter({ protocol: 'mqtt', timeout_ms: 200,
    protocol_config: { broker_url: url, topic } }, { id: 'device' });
  t.after(() => adapter.close());
  const tags = [{ id: 'tag', key: 'run', data_type: 'bool' }];
  for (const run of [false, true, false]) await publisher.publishAsync(topic, JSON.stringify({ run }), { qos: 1 });
  assert.deepEqual([(await adapter.read(tags)).values.run, (await adapter.read(tags)).values.run,
    (await adapter.read(tags)).values.run], [false, true, false]);
});
