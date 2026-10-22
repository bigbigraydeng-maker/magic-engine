import { FACTORY_B_TRACK_SCENE_TAGS, FACTORY_CLIENT_DERIVED_SCENE_TAG } from './constants'

export type ClipTrack = 'a_real' | 'b_generated'
export type LicenseReviewStatus = 'unknown' | 'verified' | 'not_required' | 'rejected'

export interface ClipLibraryMetadata {
  track: ClipTrack
  sceneTag: string
  motionType: string | null
  tags: string[]
  sourceAuthor: string | null
  sourceUrl: string | null
  licenseName: string | null
  licenseUrl: string | null
}

export interface ActivatableClip extends ClipLibraryMetadata {
  mediaType: 'video' | 'image'
  durationSeconds: number
  sha256: string | null
  licenseStatus: LicenseReviewStatus
  licenseReviewNote: string | null
}

export interface ClipUploadMediaInfo {
  name: string
  size: number
  durationSeconds: number
  aspectRatio: '9:16' | '16:9' | '1:1' | 'unknown'
}

export interface ClipUploadMetadata extends ClipLibraryMetadata {
  media: ClipUploadMediaInfo[]
}

const VALID_SCENE_TAG = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/
const VALID_TRACKS: readonly string[] = ['a_real', 'b_generated']
const ABSTRACT_SCENE_TAGS: readonly string[] = [
  ...FACTORY_B_TRACK_SCENE_TAGS,
  FACTORY_CLIENT_DERIVED_SCENE_TAG,
]

export function parseClipTrack(value: unknown): ClipTrack | null {
  return typeof value === 'string' && VALID_TRACKS.includes(value)
    ? value as ClipTrack
    : null
}

export function normalizeSceneTag(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_')
  if (normalized.length < 2 || normalized.length > 60) return null
  return VALID_SCENE_TAG.test(normalized) ? normalized : null
}

export function normalizeClipTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 20) return null
  const tags = value.map((tag) => normalizeSceneTag(tag))
  if (tags.some((tag) => tag === null)) return null
  return Array.from(new Set(tags.filter((tag): tag is string => tag !== null)))
}

export function normalizeHttpsUrl(value: unknown): string | null | undefined {
  if (value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 2048) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

export function parseClipUploadMetadata(value: FormDataEntryValue | null): ClipUploadMetadata | null {
  if (typeof value !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null

  const track = parseClipTrack(parsed.track)
  const sceneTag = normalizeSceneTag(parsed.sceneTag)
  const tags = normalizeClipTags(parsed.tags ?? [])
  const motionType = optionalText(parsed.motionType ?? null, 60)
  const sourceAuthor = optionalText(parsed.sourceAuthor ?? null, 200)
  const sourceUrl = normalizeHttpsUrl(parsed.sourceUrl ?? null)
  const licenseName = optionalText(parsed.licenseName ?? null, 120)
  const licenseUrl = normalizeHttpsUrl(parsed.licenseUrl ?? null)
  const media = parseUploadMedia(parsed.media)
  if (!track || !sceneTag || !tags || motionType === undefined || sourceAuthor === undefined) return null
  if (sourceUrl === undefined || licenseName === undefined || licenseUrl === undefined || !media) return null

  return { track, sceneTag, tags, motionType, sourceAuthor, sourceUrl, licenseName, licenseUrl, media }
}

function parseUploadMedia(value: unknown): ClipUploadMediaInfo[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null
  const parsed = value.map(parseUploadMediaItem)
  if (parsed.some((item) => item === null)) return null
  return parsed.filter((item): item is ClipUploadMediaInfo => item !== null)
}

function parseUploadMediaItem(value: unknown): ClipUploadMediaInfo | null {
  if (!isRecord(value) || typeof value.name !== 'string' || value.name.length > 255) return null
  if (!Number.isInteger(value.size) || Number(value.size) < 1 || Number(value.size) > 200 * 1024 * 1024) return null
  const durationSeconds = Number(value.durationSeconds)
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 3600) return null
  const aspectRatio = value.aspectRatio
  if (aspectRatio !== '9:16' && aspectRatio !== '16:9' && aspectRatio !== '1:1' && aspectRatio !== 'unknown') return null
  return { name: value.name, size: Number(value.size), durationSeconds, aspectRatio }
}

function optionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === null || value === '') return null
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length <= maxLength ? normalized || null : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function activationBlocker(
  clip: ActivatableClip,
  allowBTrackLandmarkAds: boolean,
): string | null {
  if (!clip.sha256) return '文件指纹缺失'
  if (clip.sceneTag === 'unclassified') return '请先补上场景标签'
  if (clip.mediaType === 'video' && clip.durationSeconds < 1.5) return '视频短于 1.5 秒'
  if (clip.track === 'b_generated' && !allowBTrackLandmarkAds && !ABSTRACT_SCENE_TAGS.includes(clip.sceneTag)) {
    return 'B 轨场景标签必须使用抽象白名单'
  }
  if (clip.licenseStatus === 'verified' && (!clip.sourceAuthor || !clip.sourceUrl || !clip.licenseName || !clip.licenseUrl)) {
    return '许可核实需要作者、来源页、许可名称和许可证据页'
  }
  if (clip.licenseStatus === 'not_required' && !clip.licenseReviewNote?.trim()) {
    return '“无需许可”必须填写核实说明'
  }
  if (clip.licenseStatus !== 'verified' && clip.licenseStatus !== 'not_required') {
    return '素材许可尚未由 ME 团队核实'
  }
  return null
}
