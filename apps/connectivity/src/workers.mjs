import { deviceTopic, telemetry } from '../../../packages/contracts/telemetry.mjs';
import { bounded } from './adapters.mjs';

// Adapters own bounded I/O and close; Core alone owns scaling and business state.
export class WorkerManager {
  constructor({ createAdapter, publish, report, now = Date.now }) {
    Object.assign(this, { createAdapter, publish, report, now });
    this.workers = new Map();
  }

  async reconcile(connections) {
    const desired = new Map();
    for (const connection of connections) {
      if (!connection.enabled) continue;
      for (const device of connection.devices ?? []) {
        if (!device.enabled) continue;
        const tags = (device.tags ?? []).filter(tag => tag.enabled);
        if (!tags.length) continue;
        const { devices, ...settings } = connection;
        const config = { connection: settings, device: { ...device, tags } };
        desired.set(device.id, { ...config, signature: JSON.stringify(config) });
      }
    }
    const retiring = [];
    for (const [id, worker] of this.workers) {
      if (desired.get(id)?.signature === worker.signature) continue;
      worker.stopped = true;
      this.workers.delete(id);
      retiring.push((async () => {
        const adapter = worker.adapter;
        try { await adapter?.close(); } catch { /* Stop pending protocol I/O. */ }
        await worker.inflight;
        if (worker.adapter !== adapter) await worker.adapter?.close();
      })());
    }
    await Promise.allSettled(retiring);
    for (const [id, config] of desired) {
      if (!this.workers.has(id)) this.workers.set(id, { ...config, next: 0, tagNext: new Map(), failures: 0, stopped: false });
    }
  }

  async tick() {
    await Promise.all([...this.workers.values()].map(worker => {
      if (worker.stopped || worker.inflight || this.now() < worker.next) return;
      worker.inflight = this.poll(worker).finally(() => { worker.inflight = undefined; });
      return worker.inflight;
    }));
  }

  async poll(worker) {
    const { connection, device } = worker;
    const interval = Math.max(100, Number(connection.polling_interval_ms) || 1000);
    const tags = connection.protocol === 'mqtt' ? device.tags : device.tags.filter(tag => this.now() >= (worker.tagNext.get(tag.id) ?? 0));
    if (!tags.length) return;
    const policy = connection.retry_policy ?? {};
    let status;
    try {
      let reading;
      const attempts = Math.max(1, Math.min(10, Number(policy.max_attempts) || 1));
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          worker.adapter ??= await this.createAdapter(connection, device);
          if (worker.stopped) return;
          reading = await bounded(() => worker.adapter.read(tags), Math.max(100, Number(connection.timeout_ms) || 5000),
            () => { void worker.adapter?.close().catch(() => {}); });
          break;
        } catch (error) {
          try { await worker.adapter?.close(); } catch { /* Reset before retry. */ }
          worker.adapter = undefined;
          if (worker.stopped || attempt + 1 >= attempts) throw error;
        }
      }
      if (worker.stopped) return;
      const payload = telemetry(device, reading.values, reading.timestamp ?? new Date(this.now()), reading.quality ?? 'GOOD');
      await this.publish(deviceTopic(device.id), payload);
      worker.failures = 0;
      for (const tag of tags) worker.tagNext.set(tag.id, this.now() + Math.max(100, Number(tag.poll_interval_ms) || interval));
      worker.next = connection.protocol === 'mqtt' ? 0 : Math.min(...device.tags.map(tag => worker.tagNext.get(tag.id) ?? 0));
      status = { status: 'CONNECTED', successful: true, error: '', tag_errors: [] };
    } catch {
      // External error strings may contain credentials; use a safe diagnostic.
      worker.failures++;
      const backoff = Math.max(100, Number(policy.backoff_ms) || interval * 2);
      worker.next = this.now() + Math.min(Number(policy.max_backoff_ms) || 30000, backoff * 2 ** Math.min(worker.failures - 1, 8));
      status = { status: 'ERROR', successful: false, error: 'Device read failed',
        tag_errors: tags.map(tag => ({ tag_id: tag.id, error: 'Device read failed' })) };
      try { await worker.adapter?.close(); } catch { /* Retry with a fresh adapter. */ }
      worker.adapter = undefined;
    }
    if (!worker.stopped) {
      try { await this.report({ device_id: device.id, connection_id: connection.id, ...status }); }
      catch { /* Core may be restarting; the next poll reports again. */ }
    }
  }

  async close() { await this.reconcile([]); }
}
