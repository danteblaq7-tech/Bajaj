const test = require('node:test');
const assert = require('node:assert');
const { detectType } = require('../src/services/storage');

test('detects real image types from their first bytes', () => {
  assert.strictEqual(detectType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])).ext, 'jpg');
  assert.strictEqual(detectType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])).ext, 'png');
  assert.strictEqual(detectType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])).ext, 'webp');
});
test('rejects scripts, html and tiny files even if labelled as images', () => {
  assert.strictEqual(detectType(Buffer.from('<html><script>alert(1)</script></html>')), null);
  assert.strictEqual(detectType(Buffer.from('GIF89a')), null);
  assert.strictEqual(detectType(Buffer.alloc(3)), null);
  assert.strictEqual(detectType('not a buffer'), null);
});
