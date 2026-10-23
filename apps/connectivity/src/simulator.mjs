import { decodeScalar } from './decode.mjs';

export function simulatorAdapter(connection, device) {
  let closed = false;
  return {
    async read(tags) {
      if (closed) throw new Error('Simulator adapter is closed');
      const configured = { ...connection.protocol_config?.values, ...device.metadata?.simulator_values };
      const values = Object.create(null);
      const readings = [];
      for (const tag of tags) {
        const raw = Object.hasOwn(configured, tag.key) ? configured[tag.key] : tag.metadata?.simulator_value;
        const decoded = decodeScalar(raw, tag.data_type);
        values[tag.key] = decoded;
        readings.push({ tag_id: tag.id, raw, decoded });
      }
      return { values: { ...values }, readings };
    },
    async close() { closed = true; },
  };
}
