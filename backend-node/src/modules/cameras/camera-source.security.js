const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const config = require('../../config/env');

function encryptionKey() {
  const value = config.security.cameraSourceEncryptionKey;
  if (!value) return null;
  if (/^[a-f0-9]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === 32 ? decoded : null;
}

function encryptSecret(secret) {
  if (!secret) return null;
  const key = encryptionKey();
  if (!key) throw new Error('CAMERA_SOURCE_ENCRYPTION_KEY must be configured before saving API credentials');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}

function decryptSecret(value) {
  if (!value) return null;
  const key = encryptionKey();
  if (!key) throw new Error('CAMERA_SOURCE_ENCRYPTION_KEY is unavailable; source credentials cannot be decrypted');
  const parts = String(value).split('.');
  if (parts.length !== 3) throw new Error('Stored camera source credential has an invalid format');
  const iv = Buffer.from(parts[0], 'base64');
  const tag = Buffer.from(parts[1], 'base64');
  const encrypted = Buffer.from(parts[2], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const parts = address.split('.').map(Number);
    const a = parts[0], b = parts[1];
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 192 && b === 0)
      || (a === 203 && b === 0);
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized === '::'
      || normalized.startsWith('fc') || normalized.startsWith('fd')
      || normalized.startsWith('fe80:') || normalized.startsWith('ff')
      || normalized.startsWith('::ffff:') || !(normalized.startsWith('2') || normalized.startsWith('3'));
  }
  return true;
}

async function assertSafeSourceUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Source endpoint must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Source endpoint must use HTTPS and must not embed credentials');
  }
  for (const key of url.searchParams.keys()) {
    if (/(api.?key|access.?token|token|secret|password|auth)/i.test(key)) {
      throw new Error('Credential-like query parameters are not allowed in source endpoints');
    }
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')
    || hostname.endsWith('.local') || hostname.endsWith('.internal')
    || hostname === 'metadata.google.internal') {
    throw new Error('Local and internal source endpoints are not allowed');
  }
  if (net.isIP(hostname)) {
    throw new Error('IP-literal source endpoints are not allowed; use the publisher hostname');
  }
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('Source hostname could not be resolved');
  }
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error('Source hostname resolves to a private or reserved network address');
  }
  return url;
}

function buildAuth(url, source) {
  const headers = { Accept: 'application/geo+json, application/json;q=0.9' };
  const secret = decryptSecret(source.auth_secret_ciphertext);
  if (!secret || source.auth_type === 'NONE') return { url, headers };
  if (source.auth_type === 'BEARER') {
    headers.Authorization = 'Bearer ' + secret;
  } else if (source.auth_type === 'API_KEY_HEADER') {
    headers[source.auth_header_name || 'X-API-Key'] = secret;
  } else if (source.auth_type === 'API_KEY_QUERY') {
    url.searchParams.set(source.auth_query_name || 'api_key', secret);
  }
  return { url, headers };
}

module.exports = {
  encryptSecret,
  decryptSecret,
  assertSafeSourceUrl,
  buildAuth,
  isPrivateAddress,
};
