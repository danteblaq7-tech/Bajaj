// Photo storage on local disk. To use S3 or similar later, keep this file's save() contract: Buffer in, { url } out.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const E = require('../utils/errors');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Identify the file by its first bytes: never trust the Content-Type header the client sent.
function detectType(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b.subarray(0, 8).equals(PNG)) return { ext: 'png', mime: 'image/png' };
  if (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}
async function save(buffer) {
  const t = detectType(buffer);
  if (!t) throw E.badRequest('Only JPEG, PNG or WebP images are accepted');
  await fs.promises.mkdir(config.uploadDir, { recursive: true });
  const name = `${crypto.randomBytes(16).toString('hex')}.${t.ext}`; // unguessable name: the link is the access control
  await fs.promises.writeFile(path.join(config.uploadDir, name), buffer, { flag: 'wx' });
  return { url: `/uploads/${name}`, mime: t.mime, bytes: buffer.length };
}
module.exports = { detectType, save, MAX_BYTES: 5 * 1024 * 1024 };
