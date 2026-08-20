// ==========================================================
// MiniZip — a tiny, dependency-free ZIP file writer.
//
// Why not just use a CDN library like JSZip? Because that adds a
// runtime dependency on an external server being reachable at the
// exact moment someone exports — one more thing that can silently
// break. This implements just enough of the ZIP format (uncompressed
// "store" entries — fine here since our images are already
// JPEG-compressed, so a second compression pass buys almost nothing)
// to bundle real files into a downloadable .zip, entirely offline.
// ==========================================================

// Standard CRC-32 implementation (used by the ZIP format to verify
// each file wasn't corrupted).
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint32LE(value) {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, value, true);
  return buf;
}

function writeUint16LE(value) {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, value, true);
  return buf;
}

function concatBytes(chunks) {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Builds a ZIP file from a list of { path, data } entries, where
 * `data` is a Uint8Array of that file's raw bytes and `path` is its
 * path inside the archive (e.g. "images/covers/foo.jpg").
 * Returns a Blob ready to download.
 */
async function createZipBlob(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { path, data } of entries) {
    const nameBytes = encoder.encode(path);
    const crc = crc32(data);
    const size = writeUint32LE(data.length);

    const localHeader = concatBytes([
      writeUint32LE(0x04034b50), // local file header signature
      writeUint16LE(20), // version needed
      writeUint16LE(0), // flags
      writeUint16LE(0), // compression method: 0 = store (no compression)
      writeUint16LE(0), // mod time
      writeUint16LE(0), // mod date
      writeUint32LE(crc),
      size, // compressed size (same as uncompressed — store method)
      size, // uncompressed size
      writeUint16LE(nameBytes.length),
      writeUint16LE(0), // extra field length
      nameBytes,
    ]);

    localParts.push(localHeader, data);

    const centralHeader = concatBytes([
      writeUint32LE(0x02014b50), // central directory header signature
      writeUint16LE(20), // version made by
      writeUint16LE(20), // version needed
      writeUint16LE(0), // flags
      writeUint16LE(0), // compression method
      writeUint16LE(0), // mod time
      writeUint16LE(0), // mod date
      writeUint32LE(crc),
      size,
      size,
      writeUint16LE(nameBytes.length),
      writeUint16LE(0), // extra field length
      writeUint16LE(0), // comment length
      writeUint16LE(0), // disk number start
      writeUint16LE(0), // internal attributes
      writeUint32LE(0), // external attributes
      writeUint32LE(offset), // offset of local header
      nameBytes,
    ]);
    centralParts.push(centralHeader);

    offset += localHeader.length + data.length;
  }

  const centralDirectory = concatBytes(centralParts);
  const centralDirectoryOffset = offset;

  const endRecord = concatBytes([
    writeUint32LE(0x06054b50), // end of central directory signature
    writeUint16LE(0), // disk number
    writeUint16LE(0), // disk with central directory
    writeUint16LE(entries.length), // entries on this disk
    writeUint16LE(entries.length), // total entries
    writeUint32LE(centralDirectory.length),
    writeUint32LE(centralDirectoryOffset),
    writeUint16LE(0), // comment length
  ]);

  const allParts = [...localParts, centralDirectory, endRecord];
  return new Blob(allParts, { type: "application/zip" });
}

function blobToUint8Array(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}
