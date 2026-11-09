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
  /**
   * Read a file from the pack folder.
   *
   * A real implementation MUST resolve the real path (realpath) and refuse
   * anything that is a symlink or that resolves outside the pack folder, and
   * MUST enforce a byte cap itself (this module only re-checks the size after
   * the read).
   */
  readFile(relativePath: string): Promise<Uint8Array>
  probe(
    bytes: Uint8Array,
    kind: StoryMediaKind,
  ): Promise<{
    width: number
    height: number
    durationSec: number | null
    format: 'png' | 'jpeg' | 'mp4' | 'unknown'
  }>
  /**
   * Content-addressed upload; MUST NOT overwrite an existing object.
   * `created` is false when the object already existed, in which case
   * `existingSha256` is the lowercase hex sha256 of the bytes ALREADY stored
   * at that path (null when the implementation cannot verify them).
   */
  putIfAbsent(
    objectPath: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<{ publicUrl: string; created: boolean; existingSha256: string | null }>
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
  contains_price: boolean
  names_place: boolean
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
  /** Public base URL for uploaded assets; must start with 'https://'. */
  publicBaseUrl: string
  entries: StoryManifestEntry[]
  ports: StoryAssetPorts
  maxVideoSeconds?: number
  maxImageBytes?: number
  maxVideoBytes?: number
}

export interface StoryIngestResult {
  items: StoryItemSpec[]
  rejected: StoryIngestRejection[]
}

const CLIENT_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACCOUNT_ID_RE = /^\d{5,25}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const DEFAULT_MAX_VIDEO_SECONDS = 15
const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024
const DEFAULT_MAX_VIDEO_BYTES = 100 * 1024 * 1024

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg'])
const VIDEO_EXTS = new Set(['mp4'])

/** Reject a manifest file path that is not a safe relative path. */
export function validatePath(file: string): boolean {
  if (!file) return false
  if (file.includes('\0')) return false
  if (file.includes('\\')) return false
  if (file.includes('%')) return false
  if (file.includes(':')) return false
  if (file.startsWith('/')) return false
  const segments = file.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return false
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
  return (
    durationSec !== null &&
    Number.isFinite(durationSec) &&
    durationSec > 0 &&
    durationSec <= maxVideoSeconds
  )
}

/** True when the string is a real calendar date (YYYY-MM-DD). */
export function isRealCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const [y, m, d] = value.split('-').map((p) => Number(p))
  const ms = Date.UTC(y, m - 1, d)
  const round = new Date(ms).toISOString().slice(0, 10)
  return round === value
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
    contains_price: entry.contains_price,
    names_place: entry.names_place,
  }
}

/** Reject helper — keeps the main loop terse. */
function reject(
  entry: StoryManifestEntry,
  reason_code: string,
): StoryIngestRejection {
  return { item_id: entry.item_id, channel: entry.channel, reason_code }
}

/** Validate the non-file fields of an entry. */
export function validateFields(entry: StoryManifestEntry): string | null {
  if (!UUID_RE.test(entry.item_id)) return 'BAD_ITEM_ID'
  if (typeof entry.slot_at !== 'string' || Number.isNaN(Date.parse(entry.slot_at))) {
    return 'BAD_FIELDS'
  }
  const text = typeof entry.text_line === 'string' ? entry.text_line.trim() : ''
  if (text.length === 0 || text.length > 200) return 'BAD_FIELDS'
  if (!Array.isArray(entry.source_record_ids) || entry.source_record_ids.length === 0) {
    return 'BAD_FIELDS'
  }
  for (const id of entry.source_record_ids) {
    if (typeof id !== 'string' || id.trim().length === 0) return 'BAD_FIELDS'
  }
  if (typeof entry.website_ref !== 'string' || !entry.website_ref.startsWith('https://')) {
    return 'BAD_FIELDS'
  }
  if (
    typeof entry.website_checked_on !== 'string' ||
    !isRealCalendarDate(entry.website_checked_on)
  ) {
    return 'BAD_FIELDS'
  }
  // the three declarations drive which items the PM must open before authorising: they must be real booleans
  if (
    typeof entry.has_reply_cta !== 'boolean' ||
    typeof entry.contains_price !== 'boolean' ||
    typeof entry.names_place !== 'boolean'
  ) {
    return 'BAD_FIELDS'
  }
  return null
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

/** Read the file; returns bytes or a reason code. */
async function readFile(
  entry: StoryManifestEntry,
  ports: StoryAssetPorts,
): Promise<{ bytes: Uint8Array } | { reason: string }> {
  let bytes: Uint8Array
  try {
    bytes = await ports.readFile(entry.file)
  } catch {
    return { reason: 'READ_FAILED' }
  }
  if (!bytes || bytes.length === 0) return { reason: 'EMPTY_FILE' }
  return { bytes }
}

/** Probe the bytes; returns the probe result or a reason code. */
async function probeBytes(
  entry: StoryManifestEntry,
  bytes: Uint8Array,
  ports: StoryAssetPorts,
): Promise<
  | {
      probe: {
        width: number
        height: number
        durationSec: number | null
        format: 'png' | 'jpeg' | 'mp4' | 'unknown'
      }
    }
  | { reason: string }
> {
  try {
    const probe = await ports.probe(bytes, entry.media_kind)
    return { probe }
  } catch {
    return { reason: 'PROBE_FAILED' }
  }
}

/** The probe format implied by a canonical extension. */
function expectedFormat(ext: string): 'png' | 'jpeg' | 'mp4' {
  if (ext === 'png') return 'png'
  if (ext === 'jpg') return 'jpeg'
  return 'mp4'
}

/** Check size, format, aspect and (for video) duration. */
export function checkMedia(params: {
  entry: StoryManifestEntry
  ext: string
  bytes: Uint8Array
  probe: {
    width: number
    height: number
    durationSec: number | null
    format: 'png' | 'jpeg' | 'mp4' | 'unknown'
  }
  maxImageBytes: number
  maxVideoBytes: number
  maxVideoSeconds: number
}): string | null {
  const { entry, ext, bytes, probe, maxImageBytes, maxVideoBytes, maxVideoSeconds } =
    params
  const cap = entry.media_kind === 'image' ? maxImageBytes : maxVideoBytes
  if (bytes.length > cap) return 'FILE_TOO_LARGE'
  if (probe.format !== expectedFormat(ext)) return 'FORMAT_MISMATCH'
  if (!aspectOk(probe.width, probe.height)) return 'BAD_ASPECT'
  if (entry.media_kind === 'video' && !durationOk(probe.durationSec, maxVideoSeconds)) {
    return 'BAD_DURATION'
  }
  return null
}

/** Upload the bytes content-addressed; returns publicUrl or a reason code. */
async function uploadAsset(params: {
  objectPath: string
  bytes: Uint8Array
  contentType: string
  sha256: string
  publicBaseUrl: string
  ports: StoryAssetPorts
}): Promise<{ publicUrl: string } | { reason: string }> {
  const { objectPath, bytes, contentType, sha256, publicBaseUrl, ports } = params
  let result: { publicUrl: string; created: boolean; existingSha256: string | null }
  try {
    result = await ports.putIfAbsent(objectPath, bytes, contentType)
  } catch {
    return { reason: 'UPLOAD_FAILED' }
  }
  const expectedUrl = `${publicBaseUrl}${objectPath}`
  if (result.publicUrl !== expectedUrl) return { reason: 'URL_NOT_EXPECTED' }
  if (!result.created) {
    if (result.existingSha256 === null) return { reason: 'CANNOT_VERIFY_EXISTING' }
    if (result.existingSha256 !== sha256) return { reason: 'OBJECT_CONTENT_MISMATCH' }
  }
  return { publicUrl: result.publicUrl }
}

/** Process a single manifest entry; returns an item or a rejection. */
async function processEntry(
  entry: StoryManifestEntry,
  input: StoryIngestInput,
  limits: {
    maxVideoSeconds: number
    maxImageBytes: number
    maxVideoBytes: number
    publicBaseUrl: string
  },
): Promise<{ item: StoryItemSpec } | { rejection: StoryIngestRejection }> {
  const fieldReason = validateFields(entry)
  if (fieldReason) return { rejection: reject(entry, fieldReason) }

  const accountId = input.accountIds[entry.channel]
  if (typeof accountId !== 'string' || !ACCOUNT_ID_RE.test(accountId)) {
    return { rejection: reject(entry, 'NO_ACCOUNT') }
  }

  const fileCheck = validateFile(entry)
  if ('reason' in fileCheck) return { rejection: reject(entry, fileCheck.reason) }
  const { ext } = fileCheck

  const read = await readFile(entry, input.ports)
  if ('reason' in read) return { rejection: reject(entry, read.reason) }

  const cap = entry.media_kind === 'image' ? limits.maxImageBytes : limits.maxVideoBytes
  if (read.bytes.length > cap) return { rejection: reject(entry, 'FILE_TOO_LARGE') }

  const probed = await probeBytes(entry, read.bytes, input.ports)
  if ('reason' in probed) return { rejection: reject(entry, probed.reason) }

  const mediaReason = checkMedia({
    entry,
    ext,
    bytes: read.bytes,
    probe: probed.probe,
    maxImageBytes: limits.maxImageBytes,
    maxVideoBytes: limits.maxVideoBytes,
    maxVideoSeconds: limits.maxVideoSeconds,
  })
  if (mediaReason) return { rejection: reject(entry, mediaReason) }

  const sha256 = sha256Hex(read.bytes)
  const objectPath = buildObjectPath(input.clientSlug, input.packId, sha256, ext)
  const contentType = contentTypeFor(ext)

  const upload = await uploadAsset({
    objectPath,
    bytes: read.bytes,
    contentType,
    sha256,
    publicBaseUrl: limits.publicBaseUrl,
    ports: input.ports,
  })
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

/** Normalise the public base URL to a single trailing slash, or throw. */
function normalisePublicBaseUrl(value: string): string {
  if (typeof value !== 'string' || !value.startsWith('https://')) {
    throw new Error('ingestStoryAssets: invalid publicBaseUrl')
  }
  return value.endsWith('/') ? value : `${value}/`
}

/** Validate the input-level invariants; throws on programmer error. */
function validateInput(input: StoryIngestInput): {
  maxVideoSeconds: number
  maxImageBytes: number
  maxVideoBytes: number
  publicBaseUrl: string
} {
  if (!CLIENT_SLUG_RE.test(input.clientSlug)) {
    throw new Error(`Invalid clientSlug: ${input.clientSlug}`)
  }
  if (!UUID_RE.test(input.clientId)) {
    throw new Error(`Invalid clientId: ${input.clientId}`)
  }
  if (!UUID_RE.test(input.packId)) {
    throw new Error(`Invalid packId: ${input.packId}`)
  }
  const maxVideoSeconds = input.maxVideoSeconds ?? DEFAULT_MAX_VIDEO_SECONDS
  if (!Number.isFinite(maxVideoSeconds) || maxVideoSeconds <= 0) {
    throw new Error(`Invalid maxVideoSeconds: ${input.maxVideoSeconds}`)
  }
  const maxImageBytes = input.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES
  const maxVideoBytes = input.maxVideoBytes ?? DEFAULT_MAX_VIDEO_BYTES
  const publicBaseUrl = normalisePublicBaseUrl(input.publicBaseUrl)
  return { maxVideoSeconds, maxImageBytes, maxVideoBytes, publicBaseUrl }
}

/**
 * Ingest a story pack manifest into StoryItemSpec rows.
 *
 * A bad clientSlug / clientId / packId / publicBaseUrl / maxVideoSeconds throws
 * (programmer error). A bad entry is pushed to `rejected` with a stable
 * reason_code and processing continues.
 */
export async function ingestStoryAssets(
  input: StoryIngestInput,
): Promise<StoryIngestResult> {
  const limits = validateInput(input)

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

    const result = await processEntry(entry, input, limits)
    if ('item' in result) items.push(result.item)
    else rejected.push(result.rejection)
  }

  return { items, rejected }
}
