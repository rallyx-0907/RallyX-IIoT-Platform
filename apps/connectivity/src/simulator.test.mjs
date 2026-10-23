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
