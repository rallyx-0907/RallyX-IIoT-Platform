export function deviceTopic(deviceId, kind = 'telemetry') {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(deviceId) || !['telemetry', 'event', 'status'].includes(kind)) throw new Error('Invalid device topic');
  return `rallyx/v1/device/${deviceId}/${kind}`;
}

export function telemetry(device, values, timestamp = new Date(), quality = 'GOOD') {
  if (!device || !/^[a-zA-Z0-9_-]{1,64}$/.test(device.id) || !/^[a-zA-Z0-9_-]{1,64}$/.test(device.asset_id)) throw new Error('Device and asset identities are required');
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Telemetry values must be an object');
  const entries = Object.entries(values);
  if (!entries.length || entries.length > 1024) throw new Error('Telemetry requires 1–1024 values');
  for (const [key, value] of entries) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key) || !['boolean', 'number', 'string'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) throw new Error('Telemetry values must be finite non-null scalars');
  }
  if (!['GOOD', 'BAD', 'UNCERTAIN', 'STALE'].includes(quality)) throw new Error('Invalid telemetry quality');
  if (typeof timestamp === 'string' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(timestamp)) throw new Error('Source timestamp must include timezone');
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid source timestamp');
  return { timestamp: date.toISOString(), device_id: device.id, asset_id: device.asset_id, values: Object.fromEntries(entries), quality };
}
