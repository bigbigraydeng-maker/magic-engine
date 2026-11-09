// Real storage boundary check; diagnostic uploads are removed in finally.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { BUCKETS, putImmutable } from './storage.mjs'

const [root, envFile] = process.argv.slice(2)
if (!root || !envFile) throw new Error('Usage: verify.mjs library-root env-file')
const config = JSON.parse(readFileSync(join(root, 'library-config.json'), 'utf8'))
const env = {}
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=(.*)$/)
  if (match) env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2')
}
const url = env.NEXT_PUBLIC_SUPABASE_URL
if (new URL(url).hostname !== `${config.project_ref}.supabase.co` || new URL(url).protocol !== 'https:') throw new Error('Unexpected project')
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, options)
const anon = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
const receipts = []
for (const bucket of Object.values(BUCKETS)) {
  const path = `_diagnostics/${randomUUID()}.json`, blockedPath = `_diagnostics/${randomUUID()}.json`
  const bytes = Buffer.from(JSON.stringify({ purpose: 'private-storage-boundary-check', no_publish: true }))
  try {
    await putImmutable(admin.storage, bucket, path, bytes, 'application/json')
    const read = await anon.storage.from(bucket).download(path)
    if (!read.error || read.data) throw new Error(`Anonymous read unexpectedly allowed: ${bucket}`)
    const publicResponse = await fetch(`${url}/storage/v1/object/public/${bucket}/${path}`, { redirect: 'error', signal: AbortSignal.timeout(15000) })
    if (publicResponse.ok) throw new Error(`Public download unexpectedly allowed: ${bucket}`)
    const write = await anon.storage.from(bucket).upload(blockedPath, bytes, { contentType: 'application/json', upsert: false })
    if (!write.error) throw new Error(`Anonymous upload unexpectedly allowed: ${bucket}`)
    const signed = await admin.storage.from(bucket).createSignedUrl(path, 60)
    if (signed.error || !signed.data) throw new Error(`Private signed access failed: ${bucket}`)
    const signedResponse = await fetch(signed.data.signedUrl, { redirect: 'error', signal: AbortSignal.timeout(15000) })
    if (!signedResponse.ok || !Buffer.from(await signedResponse.arrayBuffer()).equals(bytes)) throw new Error(`Signed readback mismatch: ${bucket}`)
    receipts.push({ bucket, admin_write_readback: 'passed', anonymous_read: 'denied', anonymous_write: 'denied', public_download: 'denied', signed_readback: 'passed' })
  } finally {
    const cleanup = await admin.storage.from(bucket).remove([path, blockedPath])
    if (cleanup.error) throw new Error(`Diagnostic cleanup failed: ${bucket}`)
  }
}
process.stdout.write(JSON.stringify(receipts) + '\n')
