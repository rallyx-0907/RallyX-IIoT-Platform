import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

test('new Modbus device flows through worker, MQTT, Core, history and diagnostics without restart',
  { skip: !process.env.RALLYX_TEST_CORE_URL, timeout: 45000 }, async t => {
    const base = process.env.RALLYX_TEST_CORE_URL;
    let cookie = '';
    const api = async (path, method = 'GET', body) => {
      const response = await fetch(base + '/api/v1' + path, { method,
        headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      const result = await response.json(); assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(result)}`); return result;
    };
    const wait = async check => { const end = Date.now() + 15000; while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 200)); } assert.fail('Timed out waiting for worker state'); };
    await wait(async () => { try { return (await fetch(base + '/health')).ok; } catch { return false; } });
    const user = await api('/auth/login', 'POST', { username: process.env.CONNECTIVITY_TEST_USERNAME || 'connectivity-test', password: 'fixture-connectivity-password-123' });
    if (user.must_change_password) await api('/auth/password', 'POST', { current_password: 'fixture-connectivity-password-123', new_password: 'fixture-connectivity-changed-password-456' });
    const suffix = Date.now().toString();
    const site = await api('/sites', 'POST', { name: 'Connectivity '+suffix });
    const area = await api('/areas', 'POST', { site_id: site.id, name: 'Area' });
    const asset = await api('/assets', 'POST', { area_id: area.id, name: 'Generic asset', type: 'equipment' });
    let responding = true;
    const functions = [];
    const sockets = new Set();
    const server = net.createServer(socket => {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket));
      let buffer = Buffer.alloc(0);
      socket.on('data', bytes => {
        buffer = Buffer.concat([buffer, bytes]);
        while (buffer.length >= 6 && buffer.length >= 6 + buffer.readUInt16BE(4)) {
          const size = 6 + buffer.readUInt16BE(4); const frame = buffer.subarray(0, size); buffer = buffer.subarray(size);
          functions.push(frame[7]); if (!responding) continue;
          const count = frame.readUInt16BE(10); const reply = Buffer.alloc(9 + count * 2);
          frame.copy(reply, 0, 0, 7); reply.writeUInt16BE(3 + count * 2, 4); reply[7] = frame[7]; reply[8] = count * 2;
          for (let i = 0; i < count; i++) reply.writeUInt16BE(42, 9+i*2);
          socket.write(reply);
        }
      });
    });
    await new Promise(resolve => server.listen(1502, '0.0.0.0', resolve));
    t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
    const connection = await api('/connections', 'POST', { site_id: site.id, name: 'Dynamic Modbus', protocol: 'modbus-tcp', timeout_ms: 200,
      polling_interval_ms: 500, protocol_config: { host: 'rallyx-connectivity-probe-test', port: 1502 } });
    assert.equal((await api(`/connections/${connection.id}/test`, 'POST', {})).connected, true);
    const device = await api('/devices', 'POST', { asset_id: asset.id, connection_id: connection.id, name: 'New device', protocol_device_address: '1' });
    const tags = [];
    for (let i = 0; i < 5; i++) tags.push(await api('/tags', 'POST', { device_id: device.id, key: `value${i}`, name: `Value ${i}`, address: String(i), data_type: 'uint16', scale: 0.1, store_history: true }));
    const diagnostic = await api(`/connections/${connection.id}/test-read`, 'POST', { device_id: device.id, tag_id: tags[0].id });
    assert.deepEqual(diagnostic.readings[0], { tag_id: tags[0].id, raw: [42], decoded: 42, scaled: 4.2 });
    await wait(async () => (await api('/tags')).find(tag => tag.id === tags[0].id)?.value === 4.2);
    const history = await api(`/tags/${tags[0].id}/history?from=${new Date(Date.now()-60000).toISOString()}&to=${new Date(Date.now()+1000).toISOString()}`);
    assert.ok(history.length > 0);
    responding = false;
    await wait(async () => (await api('/devices')).find(item => item.id === device.id)?.status === 'ERROR');
    responding = true;
    await wait(async () => (await api('/devices')).find(item => item.id === device.id)?.status === 'CONNECTED');
    await api(`/devices/${device.id}`, 'PATCH', { enabled: false });
    assert.ok(functions.length > 0); assert.ok(functions.every(fn => fn === 3));
  });
