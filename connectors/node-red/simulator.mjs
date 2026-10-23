import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function updateControls(state, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Controls must be an object');
  for (const [key, value] of Object.entries(input)) {
    if (['enabled', 'run', 'fault'].includes(key)) {
      if (typeof value !== 'boolean') throw new Error(`${key} must be boolean`);
    } else if (['current', 'value'].includes(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9) throw new Error(`${key} must be a finite number`);
    } else throw new Error(`Unknown control: ${key}`);
  }
  return { ...state, ...input };
}

export function telemetryMessages(config, state, now) {
  if (!state.enabled) return [];
  for (const value of Object.values(config)) if (!/^[a-zA-Z0-9_-]{1,64}$/.test(value)) throw new Error('Invalid simulator asset/site configuration');
  const make = (asset, tags) => ({ topic: `rallyx/${config.siteId}/${asset}/telemetry`, payload: JSON.stringify({ ts: now.toISOString(), tags, quality: 'good' }), qos: 1, retain: false });
  return [make(config.motorId, { run: state.run, fault: state.fault, current: state.current }), make(config.sensorId, { value: state.value })];
}

export function generateFlow() {
  const tab = 'rallyx-simulator';
  const initial = `let state = flow.get('controls') || { enabled: env.get('SIMULATOR_ENABLED') === 'true', run: false, fault: false, current: 0, value: 25 };`;
  const nodes = [
    { id: tab, type: 'tab', label: 'RallyX zero-hardware simulator' },
    { id: 'rallyx-mqtt-config', type: 'mqtt-broker', name: 'Internal Mosquitto', broker: 'broker', port: '1883', clientid: 'rallyx-simulator', autoConnect: true, usetls: false, protocolVersion: '4', keepalive: '30', cleansession: true },
    { id: 'tick', type: 'inject', z: tab, name: 'Fresh snapshot every 2 seconds', props: [{ p: 'payload' }], repeat: '2', once: true, onceDelay: '3', wires: [['publish']] },
    { id: 'publish', type: 'function', z: tab, name: 'Normalize simulator telemetry', func: `${telemetryMessages.toString()}\n${initial}\nif (env.get('SIMULATOR_ENABLED') !== 'true') return null;\nreturn [telemetryMessages({siteId:env.get('SIMULATOR_SITE_ID'),motorId:env.get('SIMULATOR_MOTOR_ASSET_ID'),sensorId:env.get('SIMULATOR_SENSOR_ASSET_ID')},state,new Date())];`, outputs: 1, wires: [['mqtt-out']] },
    { id: 'mqtt-out', type: 'mqtt out', z: tab, name: 'Production telemetry contract', topic: '', qos: '1', retain: 'false', broker: 'rallyx-mqtt-config', wires: [] },
    { id: 'mqtt-status', type: 'status', z: tab, name: 'Broker connectivity', scope: ['mqtt-out'], wires: [['mqtt-health']] },
    { id: 'mqtt-health', type: 'function', z: tab, name: 'Track broker health', func: "flow.set('mqtt_healthy',msg.status.fill==='green'); return null;", outputs: 1, wires: [] },
    { id: 'health-in', type: 'http in', z: tab, name: 'Health', url: '/health', method: 'get', upload: false, wires: [['health-body']] },
    { id: 'health-body', type: 'function', z: tab, name: 'Health body', func: "const healthy=flow.get('mqtt_healthy')===true;msg.statusCode=healthy?200:503;msg.payload={healthy,mqtt:healthy}; return msg;", outputs: 1, wires: [['http-out']] },
    { id: 'controls-get', type: 'http in', z: tab, name: 'Read simulator controls', url: '/simulator', method: 'get', upload: false, wires: [['controls-read']] },
    { id: 'controls-read', type: 'function', z: tab, name: 'Current controls', func: `${initial}\nmsg.payload={...state,available:env.get('SIMULATOR_ENABLED')==='true'}; return msg;`, outputs: 1, wires: [['http-out']] },
    { id: 'controls-post', type: 'http in', z: tab, name: 'Change simulator controls', url: '/simulator', method: 'post', upload: false, wires: [['controls-write']] },
    { id: 'controls-write', type: 'function', z: tab, name: 'Validate and save controls', func: `${updateControls.toString()}\n${initial}\ntry { if(env.get('SIMULATOR_ENABLED')!=='true') {msg.statusCode=403;msg.payload={error:{message:'Simulator disabled by installation configuration'}};return msg;} state=updateControls(state,msg.payload); flow.set('controls',state);msg.payload={...state,available:true}; } catch(error) {msg.statusCode=422;msg.payload={error:{message:error.message}};} return msg;`, outputs: 1, wires: [['http-out']] },
    { id: 'http-out', type: 'http response', z: tab, name: 'JSON response', statusCode: '', headers: { 'content-type': 'application/json' }, wires: [] },
  ];
  let row = 0;
  for (const node of nodes) if (node.z) { node.x = 160 + (row % 3) * 290; node.y = 80 + Math.floor(row++ / 3) * 100; }
  return nodes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(fileURLToPath(new URL('./flows/simulator.json', import.meta.url)), JSON.stringify(generateFlow(), null, 2) + '\n');
}
