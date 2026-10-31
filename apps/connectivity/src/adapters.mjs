import { decodeRegisters, decodeScalar, getPath, registerCount } from './decode.mjs';
import { simulatorAdapter } from './simulator.mjs';

export function bounded(operation, ms, cancel = () => {}, signal) {
  let timer, aborted;
  const cancellation = new Promise((_, reject) => {
    aborted = () => reject(new Error('Operation cancelled'));
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
  });
  return Promise.race([Promise.resolve().then(operation), cancellation, new Promise((_, reject) => {
    timer = setTimeout(() => { cancel(); reject(new Error('Operation timed out')); }, ms);
  })]).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); });
}

export class SerialQueue {
  constructor() { this.pending = new Map(); }
  async run(port, action) {
    const previous = this.pending.get(port) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    this.pending.set(port, next);
    try { return await next; }
    finally { if (this.pending.get(port) === next) this.pending.delete(port); }
  }
}
const serial = new SerialQueue();
const serialClosing = new Map();
const serialOpening = new Map();

export async function createAdapter(connection, device, dependencies = {}) {
  if (connection.protocol === 'simulator') return simulatorAdapter(connection, device);
  if (connection.protocol === 'mqtt') return mqttAdapter(connection, device, dependencies.signal);
  if (!['modbus-tcp', 'modbus-rtu'].includes(connection.protocol)) throw new Error('Unsupported protocol');
  const Modbus = dependencies.Modbus ?? (await import('modbus-serial')).default;
  const config = connection.protocol_config ?? {};
  const timeout = Math.max(100, Number(connection.timeout_ms) || 2000);
  let client, closed = false, closing = Promise.resolve();
  const disconnect = () => {
    const current = client; client = undefined;
    if (!current) return closing;
    closing = new Promise(resolve => {
      try { connection.protocol === 'modbus-tcp' ? current.destroy(() => resolve()) : current.close(() => resolve()); }
      catch { resolve(); }
    });
    // A timed-out close must not release the physical port to another owner.
    if (connection.protocol === 'modbus-rtu') {
      serialClosing.set(config.serial_port, closing);
      void closing.then(() => { if (serialClosing.get(config.serial_port) === closing) serialClosing.delete(config.serial_port); });
    }
    return bounded(() => closing, 5000);
  };
  const connect = async () => {
    if (closed) throw new Error('Adapter closed');
    if (client?.isOpen) return;
    if (connection.protocol === 'modbus-rtu' && serialClosing.has(config.serial_port)) await bounded(() => serialClosing.get(config.serial_port), timeout);
    if (connection.protocol === 'modbus-rtu' && serialOpening.has(config.serial_port)) await bounded(() => serialOpening.get(config.serial_port), timeout);
    if (closed) throw new Error('Adapter closed');
    const current = new Modbus(); client = current; current.setTimeout(timeout);
    const opening = connection.protocol === 'modbus-tcp'
      ? current.connectTCP(config.host, { port: Number(config.port) || 502 })
      : current.connectRTUBuffered(config.serial_port, { baudRate: Number(config.baudrate) || 9600,
        dataBits: Number(config.data_bits) || 8, stopBits: Number(config.stop_bits) || 1, parity: config.parity || 'none' });
    let expired = false;
    const settled = opening.then(async () => {
      if (expired || closed) await new Promise(resolve => {
        try { connection.protocol === 'modbus-tcp' ? current.destroy(resolve) : current.close(resolve); } catch { resolve(); }
      });
    }, () => {});
    if (connection.protocol === 'modbus-rtu') {
      serialOpening.set(config.serial_port, settled);
      void settled.then(() => { if (serialOpening.get(config.serial_port) === settled) serialOpening.delete(config.serial_port); });
    }
    await bounded(() => opening, timeout, () => { expired = true; void disconnect().catch(() => {}); });
    if (closed) { await disconnect(); throw new Error('Adapter closed'); }
    current.setID(Number(device.protocol_device_address || (config.unit_id ?? 1)));
  };
  const exclusive = action => connection.protocol === 'modbus-rtu'
    ? serial.run(config.serial_port, async () => { try { return await action(); } finally { await disconnect(); } }) : action();
  const abort = () => { closed = true; void disconnect().catch(() => {}); };
  dependencies.signal?.addEventListener('abort', abort, { once: true });
  if (dependencies.signal?.aborted) abort();
  return {
    async test() { return exclusive(connect); },
    async read(tags) {
      return exclusive(async () => {
        await connect();
        const readings = [], values = Object.create(null);
        for (const tag of tags) {
          const fn = Number(tag.function_code ?? 3);
          const method = { 1: 'readCoils', 2: 'readDiscreteInputs', 3: 'readHoldingRegisters', 4: 'readInputRegisters' }[fn];
          if (!method) throw new Error('Read-only Modbus function required');
          const address = Number(tag.address);
          if (!Number.isInteger(address) || address < 0 || address > 65535 || tag.address === '') throw new Error('Invalid register address');
          const count = registerCount(tag);
          if ((fn < 3 && tag.data_type !== 'bool') || address + count > 65536) throw new Error('Invalid register type or range');
          const result = await bounded(() => client[method](address, count), timeout, () => { void disconnect().catch(() => {}); });
          const raw = result.data.slice(0, count);
          const decoded = decodeRegisters(raw, tag);
          readings.push({ tag_id: tag.id, raw, decoded }); values[tag.key] = decoded;
        }
        return { values: { ...values }, readings };
      });
    },
    async close() { closed = true; dependencies.signal?.removeEventListener('abort', abort); await disconnect(); },
  };
}

async function mqttAdapter(connection, device, signal) {
  const { connect } = await import('mqtt');
  const config = connection.protocol_config ?? {};
  const timeout = Math.max(100, Number(connection.timeout_ms) || 2000);
  const topic = config.topic.replaceAll('{device}', device.protocol_device_address || device.id);
  const mapped = (device.tags || []).filter(t => typeof t.mapping?.topic === 'string' && !/[+#]/.test(t.mapping.topic));
  const exactOnly = mapped.length > 0 && mapped.length === (device.tags || []).length;
  const subscriptions = [...new Set(exactOnly ? mapped.map(t=>t.mapping.topic) : [topic, ...mapped.map(t => t.mapping.topic)])];
  const client = connect(config.broker_url, { ...connection.credentials, ca: config.ca,
    connectTimeout: timeout, reconnectPeriod: 1000, resubscribe: true, queueQoSZero: false,
    protocolVersion: 4, clean: true });
  let pending, overflow = false, closed = false;
  const queue = [];
  const abort = () => { closed = true; pending?.(); client.end(true); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  client.on('error', () => {});
  client.on('message', (receivedTopic, bytes, packet) => {
    if (packet.retain || bytes.length > 262144) return;
    try {
      const payload = JSON.parse(bytes.toString());
      if (!payload || typeof payload !== 'object') return;
      const matches = mapped.filter(t => t.mapping.topic === receivedTopic && (!t.mapping.device_id || t.mapping.device_id === payload.device_id));
      if (exactOnly && !matches.length) return;
      if (!matches.length) {
        if ((topic.includes('#') || topic.includes('+')) && payload.device_id !== device.id) return;
        if (payload.device_id && payload.device_id !== device.id) return;
      }
      if (queue.length >= 1024) { queue.length = 0; overflow = true; pending?.(); return; }
      queue.push({ payload: { ...payload, timestamp: payload.timestamp ?? new Date().toISOString() }, topic: receivedTopic }); pending?.();
    } catch { /* Ignore malformed field input; read timeout remains visible. */ }
  });
  try {
    await bounded(() => new Promise((resolve, reject) => {
      client.once('error', reject);
      client.once('connect', () => client.subscribe(subscriptions, { qos: 1 }, error => error ? reject(error) : resolve()));
    }), timeout, () => client.end(true));
  } catch (error) { signal?.removeEventListener('abort', abort); client.end(true); throw error; }
  return {
    async test() { if (!client.connected) throw new Error('MQTT disconnected'); },
    async read(tags) {
      if (closed) throw new Error('Adapter closed');
      if (!queue.length && !overflow) {
        try { await bounded(() => new Promise(resolve => { pending = resolve; }), timeout); }
        finally { pending = undefined; }
      }
      if (overflow) { overflow = false; throw new Error('MQTT input queue overflow'); }
      if (closed || !queue.length) throw new Error('No fresh MQTT value');
      const frame = queue.shift(), payload = frame.payload;
      const readings = [], values = Object.create(null);
      for (const tag of tags) {
        if (tag.mapping?.topic && (tag.mapping.topic !== frame.topic || (tag.mapping.device_id && tag.mapping.device_id !== payload.device_id))) continue;
        if (!tag.mapping?.topic && payload.device_id && payload.device_id !== device.id) continue;
        const path = tag.mapping?.path || config.payload_mapping?.[tag.key] || tag.address || tag.key;
        const raw = getPath(payload, path);
        if (raw === undefined) continue;
        const decoded = decodeScalar(raw, tag.data_type);
        readings.push({ tag_id: tag.id, raw, decoded }); values[tag.key] = decoded;
      }
      return { values: { ...values }, readings, timestamp: payload.timestamp,
        quality: payload.quality ?? 'GOOD' };
    },
    async close() { signal?.removeEventListener('abort', abort); abort(); },
  };
}
