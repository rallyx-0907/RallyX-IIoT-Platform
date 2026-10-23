import { deviceTopic, telemetry } from '../../../packages/contracts/telemetry.mjs';

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
        await worker.inflight;
        await worker.adapter?.close();
      })());
    }
    await Promise.allSettled(retiring);
    for (const [id, config] of desired) {
      if (!this.workers.has(id)) this.workers.set(id, { ...config, next: 0, failures: 0, stopped: false });
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
    let status;
    try {
      worker.adapter ??= await this.createAdapter(connection, device);
      if (worker.stopped) return;
      const reading = await worker.adapter.read(device.tags);
      if (worker.stopped) return;
      const payload = telemetry(device, reading.values, reading.timestamp ?? new Date(this.now()), reading.quality ?? 'GOOD');
      await this.publish(deviceTopic(device.id), payload);
      worker.failures = 0;
      worker.next = this.now() + interval;
      status = { status: 'CONNECTED', successful: true, error: '', tag_errors: [] };
    } catch {
      // External error strings may contain credentials; use a safe diagnostic.
      worker.failures++;
      worker.next = this.now() + Math.min(30000, interval * 2 ** Math.min(worker.failures, 8));
      status = { status: 'ERROR', successful: false, error: 'Device read failed',
        tag_errors: device.tags.map(tag => ({ tag_id: tag.id, error: 'Device read failed' })) };
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
