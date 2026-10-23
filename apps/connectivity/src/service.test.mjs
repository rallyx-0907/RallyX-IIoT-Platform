import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ConnectivityService } from './service.mjs';
import { simulatorAdapter } from './simulator.mjs';

test('service reloads Core config and exposes authenticated read-only diagnostics without publishing test reads', async t => {
  const token = 'fixture-service-token-with-at-least-32-characters';
  let connections = [{ id: 'connection', enabled: true, protocol: 'simulator', timeout_ms: 100,
    protocol_config: { values: { value: 3 } }, devices: [{ id: 'device', asset_id: 'asset', enabled: true,
      tags: [{ id: 'tag', key: 'value', enabled: true, data_type: 'float32', scale: 10, offset: 2 }] }] }];
  const statuses = [], messages = [];
  const core = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    if (req.url.endsWith('/config')) { res.end(JSON.stringify({ connections })); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    statuses.push(JSON.parse(body)); res.end('{}');
  });
  await new Promise(resolve => core.listen(0, '127.0.0.1', resolve));
  t.after(() => core.close());
  const service = new ConnectivityService({ coreURL: `http://127.0.0.1:${core.address().port}`, token,
    createAdapter: simulatorAdapter, publish: async (topic, payload) => messages.push(payload) });
  const api = createServer(service.handler);
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await service.close(); api.close(); });
  const url = `http://127.0.0.1:${api.address().port}`;
  assert.equal((await fetch(url + '/internal/test/read', { method: 'POST', body: '{}' })).status, 401);
  await service.reload();
  const response = await fetch(url + '/internal/test/read', { method: 'POST',
    headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ connection_id: 'connection', device_id: 'device', tag_id: 'tag' }) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).readings, [{ tag_id: 'tag', raw: 3, decoded: 3, scaled: 32 }]);
  assert.equal(messages.length, 0);
  await service.manager.tick(); assert.equal(messages[0].values.value, 3);
  assert.equal(statuses.at(-1).successful, true);
  connections = [];
  await service.reload(); await service.manager.tick(); assert.equal(messages.length, 1);
  assert.equal((await fetch(url + '/internal/test/read', { method: 'POST', headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ connection_id: 'connection', device_id: 'device' }) })).status, 404);
});

test('diagnostic deadline closes a stalled read before responding', async t => {
  let closed = 0;
  const token = 'fixture-service-token-with-at-least-32-characters';
  const core = createServer((req, res) => res.end(JSON.stringify({ connections: [{ id: 'c', devices: [
    { id: 'd', tags: [{ id: 't', key: 'value' }] },
  ] }] })));
  await new Promise(resolve => core.listen(0, '127.0.0.1', resolve)); t.after(() => core.close());
  const service = new ConnectivityService({ coreURL: `http://127.0.0.1:${core.address().port}`, token,
    diagnosticTimeout: 100, createAdapter: async () => ({ read: () => new Promise(() => {}), close: async () => { closed++; } }), publish: async () => {} });
  const api = createServer(service.handler); await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(async () => { api.closeAllConnections(); api.close(); await service.close(); });
  const response = await fetch(`http://127.0.0.1:${api.address().port}/internal/test/read`, { method: 'POST',
    headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ connection_id: 'c', device_id: 'd', tag_id: 't' }), signal: AbortSignal.timeout(500) });
  assert.equal(response.status, 502); assert.ok(closed > 0);
  service.diagnosticTimeout = 10000;
  const beforeDisconnect = closed;
  const controller = new AbortController();
  const request = fetch(`http://127.0.0.1:${api.address().port}/internal/test/read`, { method: 'POST',
    headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ connection_id: 'c', device_id: 'd', tag_id: 't' }), signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 50)); controller.abort(); await assert.rejects(request);
  const deadline = Date.now() + 500;
  while (closed === beforeDisconnect && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(closed > beforeDisconnect, 'caller disconnect must close diagnostic I/O without waiting for deadline');
});
