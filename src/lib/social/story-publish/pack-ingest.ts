import { createHash } from 'node:crypto'
import type {
  StoryChannel,
  StoryItemSpec,
  StoryMediaKind,
} from './types'

/**
 * Story pack ingest — turns a manifest of pack files into authorised-ready
 * StoryItemSpec rows. All I/O (file reads, probing, uploads) goes through the
 * injected StoryAssetPorts so this module stays pure and testable.
 *
 * Design: docs/specs/2026-10-12-story-auto-publish-design.md (§4.2, §5).
 */

export interface StoryAssetPorts {
  readFile(relativePath: string): Promise<Uint8Array>
  probe(
    bytes: Uint8Array,
    kind: StoryMediaKind,
  ): Promise<{ width: number; height: number; durationSec: number | null }>
  /** Content-addressed upload; MUST NOT overwrite an existing object. created=false when it already existed. */
  putIfAbsent(
    objectPath: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<{ publicUrl: string; created: boolean }>
}

export interface StoryManifestEntry {
  item_id: string
  channel: StoryChannel
  /** Path relative to the pack folder, e.g. '2026-10-13_01_tale.png' */
  file: string
  slot_at: string
  media_kind: StoryMediaKind
  text_line: string
  source_record_ids: string[]
  website_ref: string
  website_checked_on: string
  has_reply_cta: boolean
}

export interface StoryIngestRejection {
  item_id: string
  channel: StoryChannel
  reason_code: string
}

export interface StoryIngestInput {
  clientId: string
  /** lowercase slug used in the storage path, e.g. 'acme-tours' (must match /^[a-z0-9][a-z0-9-]{1,40}$/) */
  clientSlug: string
  packId: string
  /** account id per channel (Facebook Page id / Instagram user id) */
  accountIds: Record<StoryChannel, string>
  entries: StoryManifestEntry[]
  ports: StoryAssetPorts
  maxVideoSeconds?: number
}

export interface StoryIngestResult {
  items: StoryItemSpec[]
  rejected: StoryIngestRejection[]
}

const CLIENT_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/
const DEFAULT_MAX_VIDEO_SECONDS = 15

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg'])
const VIDEO_EXTS = new Set(['mp4'])

/** Reject a manifest file path that is not a safe relative path. */
export function validatePath(file: string): boolean {
  if (!file) return false
  if (file.includes('\0')) return false
  if (file.includes('\\')) return false
  if (file.startsWith('/')) return false
  const segments = file.split('/')
  if (segments.some((s) => s === '..')) return false
  return true
}

/** Lowercase extension without the dot, or null when there is none. */
export function extensionFor(file: string): string | null {
  const idx = file.lastIndexOf('.')
  if (idx <= 0 || idx === file.length - 1) return null
  return file.slice(idx + 1).toLowerCase()
}

/** Normalise a validated extension to the canonical storage extension. */
export function normaliseExt(ext: string): string {
  return ext === 'jpeg' ? 'jpg' : ext
}

/** True when the extension is allowed for the given media kind. */
export function extensionAllowed(ext: string, kind: StoryMediaKind): boolean {
  if (kind === 'image') return IMAGE_EXTS.has(ext)
  return VIDEO_EXTS.has(ext)
}

/** Content type for a canonical extension. */
export function contentTypeFor(ext: string): string {
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg') return 'image/jpeg'
  return 'video/mp4'
}

/** Content-addressed object path for a pack asset. */
export function buildObjectPath(
  clientSlug: string,
  packId: string,
  sha256: string,
  ext: string,
): string {
  return `story-assets/${clientSlug}/${packId}/${sha256}.${ext}`
}

/** Lowercase hex sha256 of the given bytes. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** True when width:height is exactly 9:16 and width is at least 540. */
export function aspectOk(width: number, height: number): boolean {
  return width * 16 === height * 9 && width >= 540
}

/** True when the video duration is present and within the allowed window. */
export function durationOk(
  durationSec: number | null,
  maxVideoSeconds: number,
): boolean {
  return durationSec !== null && durationSec <= maxVideoSeconds
}

/** Build the StoryItemSpec for a validated entry. */
export function buildItemSpec(params: {
  entry: StoryManifestEntry
  clientId: string
  packId: string
  accountId: string
  mediaUrl: string
  sha256: string
}): StoryItemSpec {
  const { entry, clientId, packId, accountId, mediaUrl, sha256 } = params
  return {
    item_id: entry.item_id,
    pack_id: packId,
    client_id: clientId,
    channel: entry.channel,
    slot_at: entry.slot_at,
    media_kind: entry.media_kind,
    media_url: mediaUrl,
    media_sha256: sha256,
    text_line: entry.text_line,
    account_id: accountId,
    source_record_ids: entry.source_record_ids,
    website_ref: entry.website_ref,
    website_checked_on: entry.website_checked_on,
    has_reply_cta: entry.has_reply_cta,
  }
}

/** Reject helper — keeps the main loop terse. */
function reject(
  entry: StoryManifestEntry,
  reason_code: string,
): StoryIngestRejection {
  return { item_id: entry.item_id, channel: entry.channel, reason_code }
}

/** Validate path + extension; returns the canonical ext or a reason code. */
function validateFile(
  entry: StoryManifestEntry,
): { ext: string } | { reason: string } {
  if (!validatePath(entry.file)) return { reason: 'BAD_PATH' }
  const rawExt = extensionFor(entry.file)
  if (!rawExt || !extensionAllowed(rawExt, entry.media_kind)) {
    return { reason: 'BAD_EXTENSION' }
  }
  return { ext: normaliseExt(rawExt) }
}

/** Read + probe the file; returns bytes and probe result or a reason code. */
async function readAndProbe(
  entry: StoryManifestEntry,
  ports: StoryAssetPorts,
): Promise<
  | { bytes: Uint8Array; probe: { width: number; height: number; durationSec: number | null } }
  | { reason: string }
> {
  let bytes: Uint8Array
  try {
    bytes = await ports.readFile(entry.file)
  } catch {
    return { reason: 'READ_FAILED' }
  }
  if (!bytes || bytes.length === 0) return { reason: 'EMPTY_FILE' }

  let probe: { width: number; height: number; durationSec: number | null }
  try {
    probe = await ports.probe(bytes, entry.media_kind)
  } catch {
    return { reason: 'PROBE_FAILED' }
  }
  return { bytes, probe }
}

/** Upload the bytes content-addressed; returns publicUrl or a reason code. */
async function uploadAsset(
  objectPath: string,
  bytes: Uint8Array,
  contentType: string,
  ports: StoryAssetPorts,
): Promise<{ publicUrl: string } | { reason: string }> {
  let result: { publicUrl: string; created: boolean }
  try {
    result = await ports.putIfAbsent(objectPath, bytes, contentType)
  } catch {
    return { reason: 'UPLOAD_FAILED' }
  }
  if (!result.publicUrl || !result.publicUrl.startsWith('https://')) {
    return { reason: 'URL_NOT_HTTPS' }
  }
  return { publicUrl: result.publicUrl }
}

/** Process a single manifest entry; returns an item or a rejection. */
async function processEntry(
  entry: StoryManifestEntry,
  input: StoryIngestInput,
  maxVideoSeconds: number,
): Promise<{ item: StoryItemSpec } | { rejection: StoryIngestRejection }> {
  const accountId = input.accountIds[entry.channel]
  if (typeof accountId !== 'string' || accountId.length === 0) {
    return { rejection: reject(entry, 'NO_ACCOUNT') }
  }

  const fileCheck = validateFile(entry)
  if ('reason' in fileCheck) return { rejection: reject(entry, fileCheck.reason) }
  const { ext } = fileCheck

  const read = await readAndProbe(entry, input.ports)
  if ('reason' in read) return { rejection: reject(entry, read.reason) }

  if (!aspectOk(read.probe.width, read.probe.height)) {
    return { rejection: reject(entry, 'BAD_ASPECT') }
  }
  if (
    entry.media_kind === 'video' &&
    !durationOk(read.probe.durationSec, maxVideoSeconds)
  ) {
    return { rejection: reject(entry, 'BAD_DURATION') }
  }

  const sha256 = sha256Hex(read.bytes)
  const objectPath = buildObjectPath(input.clientSlug, input.packId, sha256, ext)
  const contentType = contentTypeFor(ext)

  const upload = await uploadAsset(objectPath, read.bytes, contentType, input.ports)
  if ('reason' in upload) return { rejection: reject(entry, upload.reason) }

  const item = buildItemSpec({
    entry,
    clientId: input.clientId,
    packId: input.packId,
    accountId,
    mediaUrl: upload.publicUrl,
    sha256,
  })
  return { item }
}

/**
 * Ingest a story pack manifest into StoryItemSpec rows.
 *
 * A bad clientSlug throws (programmer error). A bad entry is pushed to
 * `rejected` with a stable reason_code and processing continues.
 */
export async function ingestStoryAssets(
  input: StoryIngestInput,
): Promise<StoryIngestResult> {
  if (!CLIENT_SLUG_RE.test(input.clientSlug)) {
    throw new Error(`Invalid clientSlug: ${input.clientSlug}`)
  }

  const maxVideoSeconds = input.maxVideoSeconds ?? DEFAULT_MAX_VIDEO_SECONDS
  const items: StoryItemSpec[] = []
  const rejected: StoryIngestRejection[] = []
  const seen = new Set<string>()

  for (const entry of input.entries) {
    const key = `${entry.item_id}\u0000${entry.channel}`
    if (seen.has(key)) {
      rejected.push(reject(entry, 'DUPLICATE_ITEM'))
      continue
    }
    seen.add(key)

    const result = await processEntry(entry, input, maxVideoSeconds)
    if ('item' in result) items.push(result.item)
    else rejected.push(result.rejection)
  }

  return { items, rejected }
}
