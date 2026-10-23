export function getPath(object, path) {
  if (!path || path === '$') return object;
  const keys = String(path).replace(/^\$\./, '').replace(/\[(\d+)\]/g, '.$1').split('.');
  let value = object;
  for (const key of keys) {
    if (!key || value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

export function decodeScalar(raw, kind) {
  if (raw === null || raw === undefined) throw new Error('Missing source value');
  if (kind === 'bool') {
    if (typeof raw === 'boolean') return raw;
    if (raw === 0 || raw === 1) return raw === 1;
    if (typeof raw === 'string' && /^(true|false)$/i.test(raw)) return raw.toLowerCase() === 'true';
    throw new Error('Expected boolean value');
  }
  if (kind === 'string') {
    if (!['string', 'number', 'boolean'].includes(typeof raw)) throw new Error('Expected scalar string value');
    return String(raw);
  }
  let value = raw;
  if (typeof value === 'string' && /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(value.trim())) value = Number(value);
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected finite numeric value');
  const bounds = { int16: [-32768, 32767], uint16: [0, 65535], int32: [-2147483648, 2147483647], uint32: [0, 4294967295] };
  if (bounds[kind] && (!Number.isInteger(value) || value < bounds[kind][0] || value > bounds[kind][1])) throw new Error(`Value outside ${kind} range`);
  if (kind === 'float32' && Math.abs(value) > 3.4028234663852886e38) throw new Error('Value outside float32 range');
  if (!bounds[kind] && kind !== 'float32' && kind !== 'float64') throw new Error('Unsupported data type');
  return value;
}

export function registerCount(tag) {
  const count = tag.metadata?.register_count ?? 8;
  if (!Number.isInteger(count) || count < 1 || count > 125) throw new Error('Invalid register count');
  return ({ bool: 1, int16: 1, uint16: 1, int32: 2, uint32: 2, float32: 2, float64: 4, string: count })[tag.data_type] || 1;
}

export function decodeRegisters(registers, tag) {
  const count = registerCount(tag);
  const bit = tag.metadata?.bit_index;
  if (bit !== undefined && (!Number.isInteger(bit) || bit < 0 || bit > 15)) throw new Error('Invalid bit index');
  if (!Array.isArray(registers) || registers.length < count) throw new Error('Incomplete Modbus response');
  if (tag.data_type === 'bool' && typeof registers[0] === 'boolean') return registers[0];
  const words = registers.slice(0, count);
  if (words.some(word => !Number.isInteger(word) || word < 0 || word > 65535)) throw new Error('Invalid Modbus register');
  if (tag.word_order === 'LE') words.reverse();
  const buffer = Buffer.alloc(count * 2);
  words.forEach((word, index) => tag.byte_order === 'LE' ? buffer.writeUInt16LE(word, index * 2) : buffer.writeUInt16BE(word, index * 2));
  let value;
  switch (tag.data_type) {
    case 'bool': { const bit = tag.metadata?.bit_index; value = bit === undefined ? buffer.readUInt16BE(0) !== 0 : (buffer.readUInt16BE(0) & (1 << Number(bit))) !== 0; break; }
    case 'int16': value = buffer.readInt16BE(0); break;
    case 'uint16': value = buffer.readUInt16BE(0); break;
    case 'int32': value = buffer.readInt32BE(0); break;
    case 'uint32': value = buffer.readUInt32BE(0); break;
    case 'float32': value = buffer.readFloatBE(0); break;
    case 'float64': value = buffer.readDoubleBE(0); break;
    case 'string': value = buffer.toString('utf8').replace(/\0+$/, ''); break;
    default: throw new Error('Unsupported data type');
  }
  return decodeScalar(value, tag.data_type);
}

export function scaledValue(value, tag) {
  if (typeof value !== 'number') return value;
  const scaled = value * Number(tag.scale ?? 1) + Number(tag.offset ?? 0);
  if (!Number.isFinite(scaled)) throw new Error('Invalid scaled value');
  return scaled;
}
