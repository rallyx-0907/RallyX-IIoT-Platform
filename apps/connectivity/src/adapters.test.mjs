import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import Modbus from 'modbus-serial';
import { createAdapter, SerialQueue } from './adapters.mjs';

test('Modbus TCP reads configured registers, decodes signed data and rejects writes', async t => {
  const functions = [], units = [];
  const server = net.createServer(socket => socket.on('data', frame => {
    functions.push(frame[7]);
    units.push(frame[6]);
    const reply = Buffer.alloc(13);
    frame.copy(reply, 0, 0, 7); reply.writeUInt16BE(7, 4);
    reply[7] = 3; reply[8] = 4; reply.writeUInt16BE(0xffff, 9); reply.writeUInt16BE(0xfffe, 11);
    socket.write(reply);
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const adapter = await createAdapter({ protocol: 'modbus-tcp', timeout_ms: 100,
    protocol_config: { host: '127.0.0.1', port: server.address().port } }, { protocol_device_address: '2' });
  t.after(() => adapter.close());
  const reading = await adapter.read([{ id: 'tag', key: 'value', address: '0', function_code: 3, data_type: 'int32' }]);
  assert.equal(reading.values.value, -2);
  assert.deepEqual(reading.readings, [{ tag_id: 'tag', raw: [65535, 65534], decoded: -2 }]);
  await assert.rejects(adapter.read([{ key: 'value', address: '0', function_code: 6, data_type: 'int16' }]), /Read-only/);
  assert.deepEqual(functions, [3]);
  const zero = await createAdapter({ protocol: 'modbus-tcp', timeout_ms: 100,
    protocol_config: { host: '127.0.0.1', port: server.address().port, unit_id: 0 } }, {});
  t.after(() => zero.close());
  await zero.read([{ id: 'tag', key: 'value', address: '0', function_code: 3, data_type: 'int32' }]);
  assert.deepEqual(units, [2, 0]);
});

test('RTU cancellation cannot overlap a late open with the next device', async () => {
  let opening = 0, active = 0, instances = 0;
  class SlowSerialBoundary {
    constructor() { this.sequence = instances++; }
    setTimeout() {} setID() {}
    async connectRTUBuffered() {
      assert.equal(opening, 0, 'previous open still pending'); assert.equal(active, 0);
      opening++;
      if (this.sequence === 0) await new Promise(resolve => setTimeout(resolve, 150));
      opening--; active++; this.isOpen = true;
    }
    async readHoldingRegisters() { return { data: [7] }; }
    close(done) {
      if (!this.isOpen) { done(); return; }
      setTimeout(() => { if (this.isOpen) { active--; this.isOpen = false; } done(); }, 10);
    }
  }
  const connection = { protocol: 'modbus-rtu', timeout_ms: 100, protocol_config: { serial_port: '/dev/fixture-late-open' } };
  const first = await createAdapter(connection, {}, { Modbus: SlowSerialBoundary });
  const second = await createAdapter(connection, {}, { Modbus: SlowSerialBoundary });
  const tags = [{ key: 'value', address: '0', data_type: 'uint16' }];
  await assert.rejects(first.read(tags));
  assert.equal((await second.read(tags)).values.value, 7);
  await first.close(); await second.close(); assert.equal(active, 0);
});

test('RTU waits for the OS close callback before another device opens the port', async () => {
  let active = 0;
  class SerialBoundary {
    setTimeout() {}
    setID() {}
    async connectRTUBuffered() { assert.equal(active, 0, 'serial port is still owned by previous reader'); active++; this.isOpen = true; }
    async readHoldingRegisters() { return { data: [7] }; }
    close(done) { setTimeout(() => { active--; this.isOpen = false; done(); }, 20); }
  }
  const connection = { protocol: 'modbus-rtu', timeout_ms: 100, protocol_config: { serial_port: '/dev/fixture-serial' } };
  const first = await createAdapter(connection, {}, { Modbus: SerialBoundary });
  const second = await createAdapter(connection, {}, { Modbus: SerialBoundary });
  const tags = [{ id: 'tag', key: 'value', address: '0', data_type: 'uint16', function_code: 3 }];
  const readings = await Promise.all([first.read(tags), second.read(tags)]);
  assert.deepEqual(readings.map(reading => reading.values.value), [7, 7]);
  assert.equal(active, 0);
});

test('Modbus timeout is bounded and socket can close without a reply', async t => {
  const sockets = new Set();
  const server = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  const adapter = await createAdapter({ protocol: 'modbus-tcp', timeout_ms: 100,
    protocol_config: { host: '127.0.0.1', port: server.address().port } }, {});
  t.after(() => adapter.close());
  await assert.rejects(adapter.read([{ key: 'value', address: '0', function_code: 3, data_type: 'int16' }]));
});

test('TCP timeout destroys sockets even when the server keeps its half open', async t => {
  const sockets = new Set();
  const server = net.createServer({ allowHalfOpen: true }, socket => { sockets.add(socket); socket.on('end', () => socket.end()); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  let client;
  class ObservedModbus extends Modbus { constructor() { super(); client = this; } }
  const adapter = await createAdapter({ protocol: 'modbus-tcp', timeout_ms: 100,
    protocol_config: { host: '127.0.0.1', port: server.address().port } }, {}, { Modbus: ObservedModbus });
  // Observe the OS socket's close rather than accepting a write-side FIN as cleanup.
  server.once('connection', socket => socket.removeAllListeners('end'));
  await assert.rejects(adapter.read([{ key: 'value', address: '0', data_type: 'uint16' }]));
  await adapter.close();
  assert.equal(client._port._client.destroyed, true);
});

test('RTU queue serializes the same physical port and releases it after failure', async () => {
  const queue = new SerialQueue();
  const order = [];
  let release;
  const first = queue.run('/dev/ttyUSB0', async () => { order.push('a'); await new Promise(resolve => { release = resolve; }); throw Error('timeout'); });
  const failed = assert.rejects(first);
  const second = queue.run('/dev/ttyUSB0', async () => { order.push('b'); });
  await queue.run('/dev/ttyUSB1', async () => order.push('other'));
  assert.deepEqual(order, ['a', 'other']);
  release(); await Promise.all([failed, second]);
  assert.deepEqual(order, ['a', 'other', 'b']);
});
