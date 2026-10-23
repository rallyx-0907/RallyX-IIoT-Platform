import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeRegisters, decodeScalar, getPath } from './decode.mjs';

test('Modbus signed values and byte/word ordering decode correctly', () => {
  assert.equal(decodeRegisters([0xffff], { data_type: 'int16' }), -1);
  assert.equal(decodeRegisters([0x3f80, 0], { data_type: 'float32' }), 1);
  assert.equal(decodeRegisters([0, 0x3f80], { data_type: 'float32', word_order: 'LE' }), 1);
  assert.equal(decodeRegisters([0x803f, 0], { data_type: 'float32', byte_order: 'LE' }), 1);
  assert.equal(decodeRegisters([0xffff, 0xffff], { data_type: 'uint32' }), 4294967295);
  assert.equal(decodeRegisters([0x3ff0, 0, 0, 0], { data_type: 'float64' }), 1);
  assert.throws(() => decodeRegisters([0], { data_type: 'float32' }));
});

test('MQTT conversion rejects missing/empty/invalid values instead of inventing zero', () => {
  assert.equal(decodeScalar('7.42', 'float32'), 7.42);
  assert.equal(decodeScalar(1, 'bool'), true);
  assert.equal(decodeScalar(false, 'bool'), false);
  for (const value of [undefined, null, '', 'not a number', Infinity]) assert.throws(() => decodeScalar(value, 'float32'));
  assert.throws(() => decodeScalar(-1, 'uint16'));
  assert.throws(() => decodeScalar(32768, 'int16'));
  assert.equal(getPath({ tags: { current: 7.42 } }, 'tags.current'), 7.42);
  assert.equal(getPath({}, '__proto__.polluted'), undefined);
});
