import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulatorAdapter } from './simulator.mjs';

test('simulator uses configured tag values and types without inventing missing readings', async () => {
  const adapter = simulatorAdapter({ protocol_config: { values: { run: true, current: '7.42' } } },
    { metadata: { simulator_values: { current: 12.5 } } });
  const tags = [{ key: 'run', data_type: 'bool' }, { key: 'current', data_type: 'float32' }];
  assert.deepEqual((await adapter.read(tags)).values, { run: true, current: 12.5 });
  await assert.rejects(adapter.read([{ key: 'missing', data_type: 'float32' }]), /Missing/);
  await adapter.close();
  await assert.rejects(adapter.read(tags), /closed/);
});

test('simulator accepts seeded per-tag values and explicit device overrides', async () => {
  const tags = [{ id: 'tag', key: 'value', data_type: 'float32', metadata: { simulator_value: 25 } }];
  const seeded = simulatorAdapter({ protocol_config: {} }, {});
  assert.equal((await seeded.read(tags)).values.value, 25);
  const overridden = simulatorAdapter({ protocol_config: {} }, { metadata: { simulator_values: { value: 0 } } });
  assert.equal((await overridden.read(tags)).values.value, 0);
});
