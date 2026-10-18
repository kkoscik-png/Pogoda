// Read the LZ4 + byte-shuffle Blosc1 blocks used by the official CMEMS Zarr store.
// Only blocks containing requested values are decoded, not the entire time chunk.
export function lz4Decode(source, length) {
  const out = new Uint8Array(length); let p = 0, q = 0;
  while (p < source.length) {
    const token = source[p++]; let literals = token >>> 4;
    if (literals === 15) { let n; do { n = source[p++]; if (n === undefined) throw Error('Truncated LZ4'); literals += n; } while (n === 255); }
    if (p + literals > source.length || q + literals > length) throw Error('Invalid LZ4 literals');
    out.set(source.subarray(p, p + literals), q); p += literals; q += literals;
    if (p === source.length) break;
    const offset = source[p++] | (source[p++] << 8); let count = token & 15;
    if (!offset || offset > q) throw Error('Invalid LZ4 offset');
    if (count === 15) { let n; do { n = source[p++]; if (n === undefined) throw Error('Truncated LZ4'); count += n; } while (n === 255); }
    count += 4; if (q + count > length) throw Error('Invalid LZ4 length');
    for (let i = 0; i < count; i++) out[q + i] = out[q + i - offset]; q += count;
  }
  if (q !== length) throw Error('Incomplete LZ4 block');
  return out;
}
export function bloscReader(buffer) {
  const src = new Uint8Array(buffer), view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  if (src.length < 16) throw Error('Invalid Blosc header');
  const flags = src[2], size = src[3], length = view.getUint32(4, true), blockSize = view.getUint32(8, true);
  if (!size || !blockSize || length > 32 * 1024 * 1024 || view.getUint32(12, true) !== src.length) throw Error('Invalid Blosc size');
  const cached = new Map();
  function block(index) {
    if (cached.has(index)) return cached.get(index);
    const n = Math.min(blockSize, length - index * blockSize); if (n <= 0) throw Error('Invalid Blosc block');
    let result;
    if (flags & 2) result = src.subarray(16 + index * blockSize, 16 + index * blockSize + n);
    else {
      if ((flags >>> 5) !== 1 || flags & 4) throw Error('Unsupported Blosc codec');
      let pos = view.getUint32(16 + index * 4, true);
      const splits = (!(flags & 16) && size <= 16 && n/size >= 128 && n === blockSize) ? size : 1, splitLength = Math.floor(n / splits), shuffled = new Uint8Array(n);
      for (let i = 0; i < splits; i++) {
        const bytes = view.getUint32(pos, true); pos += 4;
        if (pos + bytes > src.length) throw Error('Invalid Blosc stream');
        const data = src.subarray(pos, pos + bytes); pos += bytes;
        shuffled.set(bytes === splitLength ? data : lz4Decode(data, splitLength), i * splitLength);
      }
      if (flags & 1 && size > 1) {
        result = new Uint8Array(n); const items = Math.floor(n / size);
        for (let byte = 0; byte < size; byte++) for (let i = 0; i < items; i++) result[i * size + byte] = shuffled[byte * items + i];
        result.set(shuffled.subarray(items * size), items * size);
      } else result = shuffled;
    }
    const decoded = new DataView(result.buffer, result.byteOffset, result.byteLength);
    if (cached.size > 3) cached.delete(cached.keys().next().value); cached.set(index, decoded); return decoded;
  }
  return { length, number(index, dtype = '<f4') {
    const offset = index * 4; if (offset < 0 || offset + 4 > length) return null;
    const data = block(Math.floor(offset / blockSize)), local = offset % blockSize;
    return dtype === '<i4' ? data.getInt32(local, true) : data.getFloat32(local, true);
  } };
}
