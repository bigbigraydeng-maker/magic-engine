import { createHash, randomUUID } from 'node:crypto'

export const BUCKETS = Object.freeze({
  platform: 'me-media-platform', industry: 'me-media-industry', enterprise: 'me-media-enterprise',
})
export const MIME_TYPES = ['video/mp4', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp',
  'audio/mpeg', 'audio/wav', 'application/json']
export const FILE_LIMIT = 50 * 1024 * 1024

export function assertMediaSignature(bytes, extension) {
  const head = bytes.subarray(0, 16)
  const ascii = (from, to) => head.toString('ascii', from, to)
  const valid = extension === '.mp4' ? ascii(4, 8) === 'ftyp'
    : extension === '.mov' ? ['ftyp', 'wide', 'mdat', 'moov'].includes(ascii(4, 8))
    : ['.jpg', '.jpeg'].includes(extension) ? head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
    : extension === '.png' ? head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : extension === '.webp' ? ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
    : extension === '.wav' ? ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE'
    : extension === '.mp3' ? ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)
    : false
  if (!valid) throw new Error('Media signature does not match file extension')
}

export function scopePrefix(scope, key) {
  if (!Object.hasOwn(BUCKETS, scope)) throw new Error('Invalid library scope')
  if (scope === 'platform') return 'shared'
  if (scope === 'enterprise' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key ?? '')) throw new Error('Enterprise scope requires a client UUID')
  if (scope === 'industry' && !/^[a-z][a-z0-9-]{0,63}$/.test(key ?? '')) throw new Error('Industry scope requires a safe industry slug')
  return key.toLowerCase()
}

export async function ensurePrivateBuckets(storage) {
  const { data, error } = await storage.listBuckets()
  if (error) throw new Error('Cannot inspect storage buckets')
  const results = []
  for (const id of Object.values(BUCKETS)) {
    const existing = data.find(b => b.id === id)
    if (existing && (existing.public || existing.file_size_limit !== FILE_LIMIT ||
      !Array.isArray(existing.allowed_mime_types) ||
      existing.allowed_mime_types.length !== MIME_TYPES.length ||
      MIME_TYPES.some(t => !existing.allowed_mime_types.includes(t)))) {
      throw new Error(`Existing bucket requires explicit configuration review: ${id}`)
    }
    if (!existing) {
      const created = await storage.createBucket(id, { public: false, fileSizeLimit: FILE_LIMIT, allowedMimeTypes: MIME_TYPES })
      if (created.error) throw new Error(`Bucket creation failed: ${id}`)
    }
    results.push({ bucket: id, private: true, created: !existing, file_limit_bytes: FILE_LIMIT })
  }
  return results
}

/** Fail closed, never overwrite files; SHA checks also recover an interrupted retry. */
export async function putImmutable(storage, bucket, path, bytes, contentType) {
  const api = storage.from(bucket)
  const expected = createHash('sha256').update(bytes).digest('hex')
  const result = await api.upload(path, bytes, { contentType, upsert: false })
  // Read back even after a duplicate/unknown upload response; verify exact content.
  const { data, error } = await api.download(path)
  if (error || !data) throw new Error(`Object write/read verification failed (${result.error ? 'upload error' : 'download error'})`)
  const actual = createHash('sha256').update(Buffer.from(await data.arrayBuffer())).digest('hex')
  if (actual !== expected) throw new Error('Object content conflict; original left untouched')
  return { bucket, path, sha256: actual, verified: true }
}

/** Only deletes the unique diagnostic object created by this invocation. */
export async function probeStorage(storage) {
  const receipts = []
  for (const bucket of Object.values(BUCKETS)) {
    const path = `_diagnostics/${randomUUID()}.json`
    const bytes = Buffer.from(JSON.stringify({ purpose: 'storage-readback-test', no_publish: true }))
    let uploaded = false
    try {
      const result = await storage.from(bucket).upload(path, bytes, { contentType: 'application/json', upsert: false })
      if (result.error) throw new Error(`Diagnostic upload failed: ${bucket}`)
      uploaded = true
      const { data, error } = await storage.from(bucket).download(path)
      if (error || !data || !Buffer.from(await data.arrayBuffer()).equals(bytes)) throw new Error(`Diagnostic readback failed: ${bucket}`)
      receipts.push({ bucket, write_readback: 'passed' })
    } finally {
      if (uploaded) {
        const cleanup = await storage.from(bucket).remove([path])
        if (cleanup.error) throw new Error(`Diagnostic cleanup failed: ${bucket}`)
      }
    }
  }
  return receipts
}
