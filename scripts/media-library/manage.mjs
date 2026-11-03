// Trusted operator CLI. Never load this module in browser code or ship service keys.
import { readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync, readdirSync } from 'node:fs'
import { join, resolve, basename, extname } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { BUCKETS, FILE_LIMIT, scopePrefix, ensurePrivateBuckets, probeStorage, putImmutable, assertMediaSignature } from './storage.mjs'
import { intakeTags } from './tagging.mjs'

const [command, rootArg, envFile, ...args] = process.argv.slice(2)
if (!['setup', 'import', 'probe', 'list'].includes(command) || !rootArg || !envFile) {
  throw new Error('Usage: manage.mjs setup|probe|list|import library-root env-file [scope key media-file metadata.json]')
}
const root = resolve(rootArg)
const configFile = existsSync(join(root, 'library-config.json'))
  ? join(root, 'library-config.json') : join(root, '99_Catalog', 'library-config.json')
mkdirSync(root, { recursive: true })
if (lstatSync(root).isSymbolicLink()) throw new Error('Library root cannot be a symlink')
const env = {}
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=(.*)$/)
  if (match) env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2')
}
const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : null
const configuredPath = (field, fallback) => {
  const relative = config?.[field] ?? fallback
  if (typeof relative !== 'string' || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(relative)) throw new Error('Unsafe configured library directory')
  return join(root, relative)
}
const catalogDir = configuredPath('catalog_dir', 'catalog')
const filesDir = configuredPath('files_dir', 'files')
const inboxDir = configuredPath('inbox_dir', 'inbox')
if (!config?.project_ref || !/^[a-z]{20}$/.test(config.project_ref)) throw new Error('Provide library-config.json with the verified project_ref first')
const expectedProject = config.project_ref
const url = env.NEXT_PUBLIC_SUPABASE_URL
if (new URL(url).hostname !== `${expectedProject}.supabase.co` || new URL(url).protocol !== 'https:') throw new Error('Unexpected storage project')
if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Storage administrator credential unavailable')
const client = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const output = result => process.stdout.write(JSON.stringify(result) + '\n')
const safeDirectory = path => {
  mkdirSync(path, { recursive: true })
  if (lstatSync(path).isSymbolicLink()) throw new Error('Library directories cannot be symlinks')
  return path
}

if (command === 'setup') {
  const buckets = await ensurePrivateBuckets(client.storage)
  for (const directory of [inboxDir, catalogDir, filesDir]) safeDirectory(directory)
  for (const intake of config.inbox_folders ?? []) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(intake.folder)) throw new Error('Unsafe inbox folder')
    const prefix = scopePrefix(intake.scope, intake.key)
    safeDirectory(join(inboxDir, intake.folder))
    await putImmutable(client.storage, BUCKETS[intake.scope], `${prefix}/_library.json`,
      Buffer.from(JSON.stringify({ schema_version: 1, scope: intake.scope, scope_key: prefix,
        intake_status: 'ready', rights_default: 'pending', no_publish: true }, null, 2) + '\n'), 'application/json')
  }
  const next = { schema_version: 1, project_ref: expectedProject, buckets: BUCKETS,
    rights_default: 'pending', file_limit_bytes: FILE_LIMIT }
  // Customer IDs and industry choices live only in the operator's external config.
  const runtimeFile = join(catalogDir, '..', 'storage-runtime.json')
  if (!existsSync(runtimeFile)) writeFileSync(runtimeFile, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  const probes = await probeStorage(client.storage)
  output({ buckets, probes, root })
} else if (command === 'probe') {
  output(await probeStorage(client.storage))
} else if (command === 'list') {
  output(readdirSync(catalogDir).filter(n => n.endsWith('.json')).map(n => JSON.parse(readFileSync(join(catalogDir, n), 'utf8'))))
} else {
  if (!config) throw new Error('Run setup first')
  const [scope, key, mediaFile, metadataFile] = args
  const prefix = scopePrefix(scope, key)
  if (!mediaFile || !metadataFile) throw new Error('Import requires file and metadata JSON')
  const metadata = JSON.parse(readFileSync(metadataFile, 'utf8'))
  const tagging = intakeTags(metadata)
  if (!['own', 'stock', 'i2v'].includes(metadata.source) || typeof metadata.provenance !== 'string' || !metadata.provenance.trim()) throw new Error('Source and provenance are required')
  // This intake cannot approve rights, verify locations or infer sharing consent.
  if (metadata.rights_status && metadata.rights_status !== 'pending') throw new Error('Intake cannot approve rights')
  if (scope !== 'enterprise' && metadata.shared_library_consent !== true) throw new Error('Explicit shared-library classification is required')
  if (scope === 'enterprise') {
    const { data, error } = await client.from('clients').select('id').eq('id', prefix).maybeSingle()
    if (error || !data) throw new Error('Enterprise client not found')
  }
  const stat = lstatSync(mediaFile)
  if (!stat.isFile() || stat.size <= 0 || stat.size > FILE_LIMIT) throw new Error('File must be regular, non-empty and within intake size limit')
  const types = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' }
  const extension = extname(mediaFile).toLowerCase(), mime = types[extension]
  if (!mime) throw new Error('Unsupported media extension')
  const bytes = readFileSync(mediaFile)
  assertMediaSignature(bytes, extension)
  const probe = spawnSync('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'stream=codec_type,width,height:stream_side_data=rotation:format=duration', '-of', 'json', resolve(mediaFile)], { encoding: 'utf8', timeout: 30000 })
  if (probe.status !== 0) throw new Error('Media could not be inspected')
  const measured = JSON.parse(probe.stdout)
  if (!measured.streams?.length) throw new Error('No media stream')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const id = createHash('sha256').update(`${scope}:${prefix}:${hash}`).digest('hex').slice(0, 32)
  const parent = metadata.parent_asset_id
  let sourceGroup = id
  if (parent) {
    if (!/^[a-f0-9]{32}$/.test(parent)) throw new Error('Invalid parent asset ID')
    const previous = JSON.parse(readFileSync(join(catalogDir, `${parent}.json`), 'utf8'))
    if (previous.scope !== scope || previous.scope_key !== prefix) throw new Error('Variants must remain in the same library scope')
    sourceGroup = previous.source_group_id
  }
  const cloudPath = `${prefix}/originals/${id}${extension}`
  const video = measured.streams.find(s => s.codec_type === 'video')
  const rotation = video?.side_data_list?.[0]?.rotation ?? 0
  const rotated = Math.abs(rotation) % 180 === 90
  const width = video ? (rotated ? video.height : video.width) : null
  const height = video ? (rotated ? video.width : video.height) : null
  const entry = { schema_version: 1, asset_id: id, source_group_id: sourceGroup, parent_asset_id: parent ?? null,
    scope, scope_key: prefix, bucket: BUCKETS[scope], object_path: cloudPath,
    filename: basename(mediaFile), mime_type: mime, sha256: hash, size_bytes: bytes.length,
    source: metadata.source, provenance: metadata.provenance, source_url: metadata.source_url ?? null,
    license_evidence: metadata.license_evidence ?? null, rights_status: 'pending',
    location_status: 'pending', suggested_location: metadata.suggested_location ?? null,
    tour_ids: [], ...tagging, width, height, duration_seconds: Number(measured.format?.duration) || null,
    rotation, native_aspect: width && height ? (width > height ? 'landscape' : width < height ? 'portrait' : 'square') : null,
    crop_review: 'pending', used_in: [] }
  const recordFile = join(catalogDir, `${id}.json`)
  // Existing records retain their original provenance; never silently reclassify duplicates.
  const authoritative = existsSync(recordFile) ? JSON.parse(readFileSync(recordFile, 'utf8')) : entry
  if (authoritative.sha256 !== hash || authoritative.bucket !== entry.bucket || authoritative.object_path !== cloudPath) throw new Error('Local catalog conflict')
  const localDir = safeDirectory(join(filesDir, id))
  const localFile = join(localDir, `original${extension}`)
  if (!existsSync(localFile)) writeFileSync(localFile, bytes, { flag: 'wx', mode: 0o600 })
  else if (createHash('sha256').update(readFileSync(localFile)).digest('hex') !== hash) throw new Error('Local original conflict')
  const receipt = await putImmutable(client.storage, BUCKETS[scope], cloudPath, bytes, mime)
  await putImmutable(client.storage, BUCKETS[scope], `${prefix}/metadata/${id}.json`, Buffer.from(JSON.stringify(authoritative, null, 2) + '\n'), 'application/json')
  if (!existsSync(recordFile)) writeFileSync(recordFile, JSON.stringify(authoritative, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  output({ asset_id: id, source_group_id: sourceGroup, scope, receipt, rights_status: 'pending' })
}
