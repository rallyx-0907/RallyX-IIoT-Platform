import { createServer } from 'node:http';
import { connectAsync } from 'mqtt';
import { createAdapter, bounded } from './adapters.mjs';
import { ConnectivityService } from './service.mjs';

const token = process.env.CONNECTIVITY_TOKEN;
let bus, service, server;
try {
  if (!token || token.length < 32 || token.includes('CHANGE_ME')) throw new Error('Missing service token');
  bus = await connectAsync(process.env.MQTT_URL || 'mqtt://broker:1883', {
    connectTimeout: 5000, reconnectPeriod: 1000, queueQoSZero: false,
  });
  bus.on('error', () => {});
  service = new ConnectivityService({ coreURL: process.env.CORE_URL || 'http://core:8081', token, createAdapter,
    publish: async (topic, payload) => {
      if (!bus.connected) throw new Error('Bus disconnected');
      await bounded(() => bus.publishAsync(topic, JSON.stringify(payload), { qos: 1, retain: false }), 5000);
    } });
  server = createServer((req, res) => {
    if (req.url === '/health' && !bus.connected) { res.writeHead(503); res.end('{}'); return; }
    return service.handler(req, res);
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  server.listen(Number(process.env.PORT || 8090), '0.0.0.0');
  service.start().catch(() => console.error('Initial Core configuration unavailable; retrying'));
  const stop = async () => {
    server.close(); server.closeAllConnections();
    await service.close(); await bus.endAsync(true); process.exit(0);
  };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
} catch {
  console.error('Connectivity startup failed; verify service configuration');
  await bus?.endAsync(true); process.exit(1);
}
