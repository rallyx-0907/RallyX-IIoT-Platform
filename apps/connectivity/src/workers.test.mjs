import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerManager } from './workers.mjs';

const configuration = () => [{ id: 'line', enabled: true, protocol: 'simulator', polling_interval_ms: 100,
  devices: ['broken', 'healthy'].map(id => ({ id, asset_id: 'asset', enabled: true,
    tags: [{ id: `${id}-tag`, key: 'current', data_type: 'float32', enabled: true, scale: 10 }] })) }];

test('device failure is isolated; retry recovers and publishes raw values exactly once per poll', async () => {
  let now = 0;
  let broken = true;
  const messages = [], statuses = [];
  const manager = new WorkerManager({ now: () => now,
    createAdapter: async (connection, device) => ({
      async read(tags) { if (device.id === 'broken' && broken) throw Error('timeout'); return { values: { current: 7.5 } }; },
      async close() {},
    }),
    publish: async (topic, payload) => messages.push({ topic, payload }),
    report: async status => statuses.push(status),
  });
  await manager.reconcile(configuration());
  await manager.tick();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].topic, 'rallyx/v1/device/healthy/telemetry');
  assert.equal(messages[0].payload.values.current, 7.5); // Core owns scaling.
  assert.equal(statuses.find(status => status.device_id === 'broken').status, 'ERROR');
  assert.deepEqual(statuses.find(status => status.device_id === 'broken').tag_errors,
    [{ tag_id: 'broken-tag', error: 'Device read failed' }]);
  await manager.tick();
  assert.equal(messages.length, 1);
  broken = false; now = 1000;
  await manager.tick();
  assert.equal(messages.filter(message => message.topic.includes('/broken/')).length, 1);
  assert.equal(statuses.at(-1).status, 'CONNECTED');
  await manager.close();
});

test('configuration reload retains unchanged workers and closes changed or disabled workers', async () => {
  let opens = 0, closes = 0;
  const messages = [];
  const manager = new WorkerManager({ createAdapter: async () => {
    opens++; return { read: async () => ({ values: { current: 2 } }), close: async () => { closes++; } };
  }, publish: async (topic, payload) => messages.push(payload), report: async () => {} });
  const config = configuration();
  await manager.reconcile(config); await manager.tick();
  await manager.reconcile(structuredClone(config));
  assert.equal(opens, 2); assert.equal(closes, 0);
  config[0].devices[0].tags[0].address = '12';
  config[0].devices[1].enabled = false;
  await manager.reconcile(config); await manager.tick();
  assert.equal(opens, 3); assert.equal(closes, 2);
  assert.equal(messages.at(-1).device_id, 'broken');
  await manager.reconcile([]); await manager.tick();
  assert.equal(closes, 3);
  assert.equal(messages.length, 3);
});

test('overlapping ticks never poll a device concurrently or emit after it is removed', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let reads = 0, published = 0;
  const manager = new WorkerManager({ createAdapter: async () => ({
    read: async () => { reads++; await gate; return { values: { current: 1 } }; }, close: async () => {},
  }), publish: async () => { published++; }, report: async () => {} });
  await manager.reconcile(configuration().map(c => ({ ...c, devices: [c.devices[0]] })));
  const first = manager.tick();
  await manager.tick();
  const removal = manager.reconcile([]);
  release();
  await Promise.all([first, removal]);
  assert.equal(reads, 1); assert.equal(published, 0);
});
