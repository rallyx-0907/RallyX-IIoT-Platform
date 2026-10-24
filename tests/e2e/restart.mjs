import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const configPath = process.env.RALLYX_ENV_FILE || '.env';
const config = Object.fromEntries(readFileSync(configPath, 'utf8').split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const base = process.env.RALLYX_BASE_URL;
assert.ok(base, 'Set RALLYX_BASE_URL explicitly for restart acceptance');
const path = process.env.RALLYX_RESTART_STATE || '.tools/restart-state.json';
let cookie;
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}/api/v1${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  const result = await response.json(); assert.ok(response.ok, `API ${method} ${path}: ${response.status}`); return result;
}
async function wait(check, name) {
  const end = Date.now() + 30000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 250)); }
  assert.fail(`Timed out: ${name}`);
}
await api('/auth/login', 'POST', { username: config.ADMIN_USERNAME, password: config.ADMIN_PASSWORD });
if (process.argv[2] === 'prepare') {
  const suffix = Date.now();
  const site = await api('/sites', 'POST', { name: `Restart site ${suffix}` });
  const area = await api('/areas', 'POST', { site_id: site.id, name: `Restart area ${suffix}` });
  const asset = await api('/assets', 'POST', { area_id: area.id, name: `Restart asset ${suffix}` });
  const connection = await api('/connections', 'POST', { site_id: site.id, name: `Restart simulator ${suffix}`, protocol: 'simulator', protocol_config: { values: { run: true } } });
  const device = await api('/devices', 'POST', { asset_id: asset.id, connection_id: connection.id, name: `Restart source ${suffix}` });
  const tag = await api('/tags', 'POST', { device_id: device.id, key: 'run', name: 'Runtime source', data_type: 'bool', semantic: 'run' });
  const widget = await api('/dashboard', 'POST', { tag_id: tag.id, type: 'status', title: `Restart status ${suffix}` });
  await wait(async () => (await api(`/assets/${asset.id}/tags`)).some(row => row.id === tag.id && row.value === true && row.quality === 'GOOD'), 'initial run telemetry');
  const sessions = await api(`/assets/${asset.id}/runtime`);
  const session = sessions.find(session => session.kind === 'run' && !session.ended_at);
  assert.ok(session, 'open run session exists before restart');
  const assets = await api('/assets');
  const history = await api(`/tags/${tag.id}/history`); assert.ok(history.length > 0);
  writeFileSync(path, JSON.stringify({ asset: asset.id, device: device.id, connection: connection.id, tag: tag.id, widget: widget.id, session: session.id, start_count: assets.find(row => row.id === asset.id).start_count, history: history.length }));
  console.log('Prepared independent running asset, history and widget for restart acceptance.');
} else if (process.argv[2] === 'verify') {
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  await wait(async () => (await api(`/assets/${saved.asset}/tags`)).some(row => row.id === saved.tag && row.value === true && row.quality === 'GOOD'), 'run telemetry after restart');
  assert.ok((await api('/devices')).some(row => row.id === saved.device));
  assert.ok((await api('/connections')).some(row => row.id === saved.connection));
  assert.ok((await api('/dashboard')).some(row => row.id === saved.widget));
  const sessions = await api(`/assets/${saved.asset}/runtime`);
  assert.ok(sessions.some(row => row.id === saved.session && !row.ended_at), 'same run session remains open');
  assert.equal(sessions.filter(row => row.kind === 'run' && !row.ended_at).length, 1);
  assert.equal((await api('/assets')).find(row => row.id === saved.asset).start_count, saved.start_count, 'restart does not invent a start');
  assert.ok((await api(`/tags/${saved.tag}/history`)).length >= saved.history, 'existing history survives');
  console.log('Restart acceptance passed: configuration, widget, history and same open runtime session retained without duplicate start.');
} else throw new Error('Usage: node tests/e2e/restart.mjs prepare|verify');
