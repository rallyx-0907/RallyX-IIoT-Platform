import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const base = process.env.RALLYX_BASE_URL || 'http://127.0.0.1:8080';
const configPath = process.env.RALLYX_ENV_FILE || fileURLToPath(new URL('../../.env', import.meta.url));
const config = Object.fromEntries(readFileSync(configPath, 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
let cookie = '';
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}/api/v1${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
  const data = await response.json();
  assert.equal(response.ok, true, `API ${method} ${path} failed with status ${response.status}: ${data.error?.message || 'invalid response'}`);
  return data;
}
async function waitFor(check, description) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 250)); }
  assert.fail(`Timed out: ${description}`);
}

function openStream() {
  return new Promise((resolve, reject) => {
    const messages = [];
    const request = (base.startsWith('https:') ? https : http).request(`${base}/api/v1/ws`, { headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': randomBytes(16).toString('base64'), 'Sec-WebSocket-Version': '13', Cookie: cookie } });
    request.on('error', reject);
    request.on('response', response => { response.resume(); reject(new Error(`WebSocket handshake status ${response.statusCode}`)); });
    request.on('upgrade', (response, socket, head) => {
      let buffer = Buffer.alloc(0);
      const read = data => {
        buffer = Buffer.concat([buffer, data]);
        while (buffer.length >= 2) {
          let length = buffer[1] & 127, prefix = 2;
          if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); prefix = 4; }
          if (length === 127) { socket.destroy(); return; }
          if (buffer.length < prefix + length) return;
          if ((buffer[0] & 15) === 1) messages.push(JSON.parse(buffer.subarray(prefix, prefix + length).toString()));
          buffer = buffer.subarray(prefix + length);
        }
      };
      socket.on('data', read); socket.on('error', () => {}); if (head.length) read(head);
      resolve({ messages, close: () => socket.destroy() });
    });
    request.setTimeout(10000, () => request.destroy(new Error('WebSocket handshake timed out')));
    request.end();
  });
}

test('zero-hardware MQTT → Core → DB → API, alarms and WebSocket', { timeout: 120000 }, async t => {
  const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
  assert.equal(health.status, 200);
  let user = await api('/auth/login', 'POST', { username: config.ADMIN_USERNAME, password: config.ADMIN_PASSWORD });
  if (user.must_change_password) {
    const password = randomBytes(24).toString('hex');
    user = await api('/auth/password', 'POST', { current_password: config.ADMIN_PASSWORD, new_password: password });
    const envPath = configPath;
    const contents = readFileSync(envPath, 'utf8').replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${password}`);
    writeFileSync(envPath, contents); config.ADMIN_PASSWORD = password;
  }
  assert.equal(user.role, 'admin');
  const motor = config.SIMULATOR_MOTOR_ASSET_ID || 'demo-motor';
  const motorDeviceID = config.SIMULATOR_MOTOR_DEVICE_ID || 'demo-motor-device';
  const sensorDeviceID = config.SIMULATOR_SENSOR_DEVICE_ID || 'demo-sensor-device';
  const devices = await api('/devices');
  const motorDevice = devices.find(device => device.id === motorDeviceID);
  const sensorDevice = devices.find(device => device.id === sensorDeviceID);
  assert.ok(motorDevice && sensorDevice, 'configured simulator devices must exist');
  await api(`/connections/${motorDevice.connection_id}`, 'PATCH', { enabled: true });
  const controls = async ({run, fault, current, value}) => {
    await api(`/devices/${motorDeviceID}`, 'PATCH', { enabled: true, metadata: { ...motorDevice.metadata, simulator_values: { run, fault, current } } });
    await api(`/devices/${sensorDeviceID}`, 'PATCH', { enabled: true, metadata: { ...sensorDevice.metadata, simulator_values: { value } } });
  };
  const tags = () => api(`/assets/${motor}/tags`);
  await controls({ run: false, fault: false, current: 0, value: 25 });
  await waitFor(async () => (await tags()).some(tag => tag.semantic === 'run' && tag.value === false && tag.quality.toUpperCase() === 'GOOD'), 'initial stop telemetry');
  const started = new Date().toISOString();
  const stream = await openStream(); t.after(stream.close);
  await controls({ run: true, current: 12, fault: true, value: 90 });
  await waitFor(async () => (await tags()).some(tag => tag.semantic === 'run' && tag.value === true && Date.parse(tag.ts) >= Date.parse(started)), 'RUN and fault snapshot');
  await waitFor(async () => (await api('/alarms')).some(alarm => alarm.asset_id === motor && alarm.severity === 'critical'), 'fault alarm');
  const alarms = await api('/alarms');
  const alarm = alarms.find(alarm => alarm.asset_id === motor && alarm.severity === 'critical');
  const acknowledged = await api(`/alarms/${alarm.id}/ack`, 'POST', {});
  assert.ok(acknowledged.acknowledged_at);
  await controls({ run: false, fault: false, current: 0, value: 25 });
  await waitFor(async () => (await tags()).some(tag => tag.semantic === 'run' && tag.value === false && Date.parse(tag.ts) > Date.parse(started)), 'STOP snapshot');
  await waitFor(async () => !(await api('/alarms')).some(alarm => alarm.asset_id === motor), 'alarm clearance');
  const range = new URLSearchParams({ from: started, to: new Date().toISOString(), limit: '2000' });
  const events = await api(`/assets/${motor}/events?${range}`);
  assert.equal(events.filter(event => event.kind === 'start').length, 1);
  assert.equal(events.filter(event => event.kind === 'stop').length, 1);
  assert.equal(events.filter(event => event.kind === 'fault').length, 1);
  const runtime = await api(`/assets/${motor}/runtime?${range}`);
  assert.ok(runtime.some(session => session.kind === 'run' && session.ended_at && session.duration_seconds > 0));
  const current = (await tags()).find(tag => tag.key === 'current');
  const samples = await api(`/tags/${current.id}/history?${range}`);
  assert.ok(samples.some(sample => sample.value === 12));
  await waitFor(() => stream.messages.some(message => message.type === 'telemetry'), 'authenticated WebSocket telemetry update');
  const tree = await api('/assets/tree'); assert.ok(tree.length > 0);
  const viewerName = `e2e-${Date.now()}`;
  const viewer = await api('/users', 'POST', { username: viewerName, password: randomBytes(24).toString('hex'), role: 'viewer' });
  assert.equal(viewer.role, 'viewer'); assert.equal('password_hash' in viewer, false);
  await api('/auth/logout', 'POST', {});
});
