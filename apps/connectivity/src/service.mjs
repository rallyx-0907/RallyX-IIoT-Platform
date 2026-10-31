import { timingSafeEqual } from 'node:crypto';
import {handleTransient} from './onboarding.mjs';
import { WorkerManager } from './workers.mjs';
import { scaledValue } from './decode.mjs';
import { bounded } from './adapters.mjs';

export class ConnectivityService {
  constructor({ coreURL, token, createAdapter, publish, diagnosticTimeout = 10000 }) {
    if (typeof token !== 'string' || token.length < 32 || token.includes('CHANGE_ME')) throw new Error('CONNECTIVITY_TOKEN must be configured');
    Object.assign(this, { coreURL, token, createAdapter });
    this.connections = [];
    this.manager = new WorkerManager({ createAdapter, publish, report: body => this.request('/status', body) });
    this.handler = this.handle.bind(this);
    this.reloadHealthy = false;
    this.diagnosticTimeout = diagnosticTimeout;
    this.diagnostics = new Set();
  }
  async request(path, body) {
    const response = await fetch(this.coreURL + '/internal/connectivity' + path, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Core request failed'); }
    return response.json();
  }
  async reload() {
    if (this.reloading) return this.reloading;
    this.reloading = (async () => {
      try {
        const { connections } = await this.request('/config');
        if (!Array.isArray(connections)) throw new Error('Invalid configuration');
        await this.manager.reconcile(connections);
        this.connections = connections; this.reloadHealthy = true;
      } catch (error) { this.reloadHealthy = false; throw error; }
    })().finally(() => { this.reloading = undefined; });
    return this.reloading;
  }
  start() {
    this.reloadTimer = setInterval(() => this.reload().catch(() => {}), 2000);
    this.pollTimer = setInterval(() => this.manager.tick().catch(() => {}), 100);
    return this.reload();
  }
  async close() {
    clearInterval(this.reloadTimer); clearInterval(this.pollTimer);
    for (const cancel of this.diagnostics) cancel();
    await this.reloading?.catch(() => {}); await this.manager.close();
  }
  async handle(req, res) {
    const reply = (status, data) => {
      if (res.destroyed) return;
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    if (req.method === 'GET' && req.url === '/health') { reply(this.reloadHealthy ? 200 : 503, { configuration: this.reloadHealthy }); return; }
    const expected = Buffer.from(`Bearer ${this.token}`), provided = Buffer.from(req.headers.authorization ?? '');
    if (provided.length !== expected.length || !timingSafeEqual(expected, provided)) { reply(401, { error: 'Service authentication required' }); return; }
    if(req.method==='POST'&&req.url==='/internal/test/preview')return handleTransient(req,res,this);
    if (req.method !== 'POST' || !['/internal/test/connection', '/internal/test/read'].includes(req.url)) { reply(404, { error: 'Unknown operation' }); return; }
    let adapter;
    const controller = new AbortController();
    const cancel = () => { controller.abort(); void adapter?.close().catch(() => {}); };
    const disconnected = () => { if (!res.writableEnded) cancel(); };
    res.once('close', disconnected); this.diagnostics.add(cancel);
    try {
      await bounded(async () => {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 16384) { reply(413, { error: 'Request too large' }); return; } }
      let body;
      try { body = JSON.parse(raw); } catch { reply(422, { error: 'Invalid JSON' }); return; }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['connection_id', 'device_id', 'tag_id'].includes(key))) { reply(422, { error: 'Invalid request' }); return; }
      // Refresh before diagnostics so newly saved metadata does not wait for the timer.
      await this.reload();
      const connection = this.connections.find(item => item.id === body.connection_id);
      const device = connection?.devices.find(item => item.id === body.device_id);
      if (!connection || (body.device_id && !device) || connection.credential_error) { reply(404, { error: 'Configuration unavailable' }); return; }
      if (req.url.endsWith('/read') && !device) { reply(422, { error: 'Device required' }); return; }
      const tags = (device?.tags ?? []).filter(tag => !body.tag_id || tag.id === body.tag_id);
      if (req.url.endsWith('/read') && !tags.length) { reply(404, { error: 'Tag unavailable' }); return; }
      adapter = await this.createAdapter(connection, device ?? {}, { signal: controller.signal });
      if (controller.signal.aborted) { await adapter.close(); throw new Error('Diagnostic cancelled'); }
      if (req.url.endsWith('/connection')) { await adapter.test?.(); reply(200, { connected: true }); return; }
      const result = await adapter.read(tags);
      reply(200, { readings: result.readings.map(reading => ({ ...reading,
        scaled: scaledValue(reading.decoded, tags.find(tag => tag.id === reading.tag_id)) })) });
      }, this.diagnosticTimeout, cancel, controller.signal);
    } catch { reply(502, { error: 'Connectivity operation failed' }); }
    finally {
      res.removeListener('close', disconnected); this.diagnostics.delete(cancel);
      try { await adapter?.close(); } catch { /* Best effort shutdown. */ }
    }
  }
}
