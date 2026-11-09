// @vitest-environment node
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { BUCKETS, FILE_LIMIT, MIME_TYPES, ensurePrivateBuckets, scopePrefix, putImmutable, probeStorage, assertMediaSignature } from './storage.mjs'

function fake() {
  const objects = new Map(), buckets = [], writes = []
  return { objects, buckets, writes,
    listBuckets: async () => ({ data: buckets, error: null }),
    createBucket: async (id, options) => { buckets.push({ id, public: options.public, file_size_limit: options.fileSizeLimit, allowed_mime_types: options.allowedMimeTypes }); return { error: null } },
    from: bucket => ({
      upload: async (path, bytes, opts) => { const key = `${bucket}/${path}`;writes.push(opts);if (objects.has(key)) return { error: { message: 'duplicate' } };objects.set(key, Buffer.from(bytes));return { error: null } },
      download: async path => { const bytes = objects.get(`${bucket}/${path}`);return bytes ? { data: new Blob([bytes]), error: null } : { data: null, error: { message: 'missing' } } },
      remove: async paths => { paths.forEach(p => objects.delete(`${bucket}/${p}`));return { error: null } },
    }) }
}

test('three private buckets, restricted media types, setup is idempotent', async () => {
  const storage = fake();await ensurePrivateBuckets(storage);await ensurePrivateBuckets(storage)
  assert.equal(storage.buckets.length, 3)
  assert.ok(storage.buckets.every(b => !b.public && b.file_size_limit === FILE_LIMIT))
  assert.deepEqual(storage.buckets[0].allowed_mime_types, MIME_TYPES)
})
test('refuses to change an existing public or conflicting bucket', async () => {
  const storage = fake();storage.buckets.push({ id: BUCKETS.enterprise, public: true })
  await assert.rejects(ensurePrivateBuckets(storage), /configuration review/)
})
test('scope keys cannot traverse paths or turn enterprises into shared scope', () => {
  for (const [scope, key] of [['enterprise', '../cts'], ['enterprise', 'travel'], ['industry', '../../'], ['unknown', 'shared']]) {
    assert.throws(() => scopePrefix(scope, key))
  }
  assert.equal(scopePrefix('platform'), 'shared')
  assert.equal(scopePrefix('industry', 'travel'), 'travel')
  assert.equal(scopePrefix('enterprise', '00000000-0000-0000-0000-000000000000'), '00000000-0000-0000-0000-000000000000')
})
test('immutable content is read back; identical retry is safe', async () => {
  const storage = fake();const bytes = Buffer.from('file')
  await putImmutable(storage, BUCKETS.industry, 'travel/file', bytes, 'application/json')
  const result = await putImmutable(storage, BUCKETS.industry, 'travel/file', bytes, 'application/json')
  assert.ok(result.verified);assert.ok(storage.writes.every(w => w.upsert === false))
})
test('conflicting content remains untouched and is not falsely accepted', async () => {
  const storage = fake();storage.objects.set(`${BUCKETS.industry}/file`, Buffer.from('original'))
  await assert.rejects(putImmutable(storage, BUCKETS.industry, 'file', Buffer.from('changed'), 'application/json'), /content conflict/)
  assert.equal(storage.objects.get(`${BUCKETS.industry}/file`).toString(), 'original')
})
test('cannot accept a write that cannot be read back', async () => {
  const storage = fake();storage.from = () => ({ upload: async () => ({ error: null }), download: async () => ({ error: true }) })
  await assert.rejects(putImmutable(storage, BUCKETS.platform, 'file', Buffer.from('x'), 'application/json'), /verification failed/)
})
test('live-style diagnostic cleans only its own files', async () => {
  const storage = fake();storage.objects.set('existing/file', Buffer.from('preserve'))
  const receipts = await probeStorage(storage)
  assert.equal(receipts.length, 3);assert.equal(storage.objects.size, 1);assert.ok(storage.objects.has('existing/file'))
})
test('rejects renamed HTML/playlists and accepts supported media headers', () => {
  assert.throws(() => assertMediaSignature(Buffer.from('#EXTM3U\nhttp://untrusted/'), '.mp4'), /signature/)
  assert.throws(() => assertMediaSignature(Buffer.from('<html>'), '.png'), /signature/)
  assert.doesNotThrow(() => assertMediaSignature(Buffer.from([0, 0, 0, 16, 102, 116, 121, 112]), '.mp4'))
  assert.doesNotThrow(() => assertMediaSignature(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), '.png'))
})
