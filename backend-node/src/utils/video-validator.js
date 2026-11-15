/**
 * Video container signature validator.
 * Accepts MP4/MOV-family (ISO BMFF), AVI (RIFF), and Matroska/WebM (EBML).
 * File extensions and client MIME types are not trusted.
 */
const fs = require('fs');

const KNOWN_MP4_BRANDS = new Set([
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6',
  'mp41', 'mp42', 'avc1', 'qt  ', 'M4V ', 'M4A ',
  'dash', '3gp4', '3gp5', '3gp6', 'MSNV',
]);

function readHeader(filePathOrBuffer) {
  if (Buffer.isBuffer(filePathOrBuffer)) return filePathOrBuffer.subarray(0, 32);
  if (typeof filePathOrBuffer !== 'string' || !fs.existsSync(filePathOrBuffer)) return null;

  let fd;
  try {
    const stat = fs.statSync(filePathOrBuffer);
    if (!stat.isFile() || stat.size < 12) return null;
    fd = fs.openSync(filePathOrBuffer, 'r');
    const header = Buffer.alloc(32);
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    return header.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function isValidMp4Header(header) {
  if (!header || header.length < 16) return false;
  const boxSize = header.readUInt32BE(0);
  if (boxSize < 8 && boxSize !== 0 && boxSize !== 1) return false;
  if (header.toString('ascii', 4, 8) !== 'ftyp') return false;

  const majorBrand = header.toString('ascii', 8, 12);
  if (KNOWN_MP4_BRANDS.has(majorBrand)) return true;
  return /^[a-zA-Z0-9_\\s]{4}$/.test(majorBrand);
}

function isValidMp4(filePathOrBuffer) {
  return isValidMp4Header(readHeader(filePathOrBuffer));
}

function isValidVideo(filePathOrBuffer) {
  const header = readHeader(filePathOrBuffer);
  if (!header || header.length < 12) return false;

  // ISO Base Media File Format: MP4, MOV, M4V, 3GP.
  if (isValidMp4Header(header)) return true;

  // AVI: RIFF....AVI  (or OpenDML AVIX).
  if (header.toString('ascii', 0, 4) === 'RIFF') {
    const formType = header.toString('ascii', 8, 12);
    if (formType === 'AVI ' || formType === 'AVIX') return true;
  }

  // Matroska/WebM EBML document header.
  if (header.length >= 4 && header[0] === 0x1a && header[1] === 0x45 &&
      header[2] === 0xdf && header[3] === 0xa3) {
    return true;
  }

  return false;
}

module.exports = {
  isValidMp4,
  isValidVideo,
};
