import { REEL_AUTO_CHECK_KEYS, type ContentCheckItemResult } from './content-review'

export interface ReelMediaEvidence {
  audio_stream_present?: boolean
  audio_loudness_lufs?: number | null
  width?: number
  height?: number
  duration_seconds?: number
  subtitle_cues?: Array<{ start_seconds: number; end_seconds: number; text: string }>
  cover_mean_luma?: number
  cover_luma_range?: number
  cover_placeholder_detected?: boolean | null
  content_substance?: {
    verdict: 'pass' | 'asset_only' | 'fail'
    kinds: string[]
    textSeconds: number
    reason: string
  }
  creative_plan?: ShortCreativePlanEvidence
  capabilities?: string[]
}

/** Structural rendering receipt for an impact short; it is not a creative approval. */
export interface ShortCreativePlanEvidence {
  schema_version: 1
  hook_tag: string
  hook_beats: number
  build_tags: string[]
  payoff_tag: string
  payoff_beats: number
  planned_scene_count: number
  rendered_clip_file_count: number
  human_review_required: true
}

export function parseShortCreativePlan(raw: unknown): ShortCreativePlanEvidence | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>
  const tag = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9-]{1,24}$/.test(value)
  if (v.schema_version !== 1 || !tag(v.hook_tag) || !tag(v.payoff_tag)
    || !Array.isArray(v.build_tags) || v.build_tags.length < 4 || v.build_tags.length > 8
    || !v.build_tags.every(tag)
    || !Number.isInteger(v.hook_beats) || Number(v.hook_beats) < 1 || Number(v.hook_beats) > 4
    || !Number.isInteger(v.payoff_beats) || Number(v.payoff_beats) < 1 || Number(v.payoff_beats) > 4
    || !Number.isInteger(v.planned_scene_count) || Number(v.planned_scene_count) !== v.build_tags.length + 2
    || !Number.isInteger(v.rendered_clip_file_count) || Number(v.rendered_clip_file_count) < Number(v.planned_scene_count)
    || Number(v.rendered_clip_file_count) > 24
    || v.human_review_required !== true) return null
  const tags = [v.hook_tag, ...v.build_tags, v.payoff_tag]
  if (new Set(tags).size !== tags.length) return null
  return {
    schema_version: 1,
    hook_tag: v.hook_tag,
    hook_beats: Number(v.hook_beats),
    build_tags: [...v.build_tags] as string[],
    payoff_tag: v.payoff_tag,
    payoff_beats: Number(v.payoff_beats),
    planned_scene_count: Number(v.planned_scene_count),
    rendered_clip_file_count: Number(v.rendered_clip_file_count),
    human_review_required: true,
  }
}

const measured = (
  key: (typeof REEL_AUTO_CHECK_KEYS)[number],
  outcome: ContentCheckItemResult['outcome'],
  detail: string,
): ContentCheckItemResult => ({ key, judge: 'AUTO', outcome, detail, source_ref: null })

const unknown = (key: (typeof REEL_AUTO_CHECK_KEYS)[number], detail: string) => measured(key, 'NOT_MEASURED', detail)

export function buildReelMediaAutoChecks(evidence: ReelMediaEvidence | null | undefined): ContentCheckItemResult[] {
  const [audioKey, formatKey, subtitleKey, coverKey, reelKey] = REEL_AUTO_CHECK_KEYS
  if (!evidence) return REEL_AUTO_CHECK_KEYS.slice(0, 5).map(key => unknown(key, 'Final media probe is missing.'))

  const audio = typeof evidence.audio_stream_present === 'boolean' && typeof evidence.audio_loudness_lufs === 'number'
    ? measured(audioKey,
      evidence.audio_stream_present && evidence.audio_loudness_lufs > -55 ? 'PASS' : 'FAIL',
      `Audio stream ${evidence.audio_stream_present ? 'present' : 'missing'}; integrated loudness ${evidence.audio_loudness_lufs} LUFS (must exceed -55 LUFS).`)
    : unknown(audioKey, 'Audio stream or loudness probe is unavailable.')

  const { width, height, duration_seconds: duration } = evidence
  const hasDimensions = Number.isInteger(width) && Number.isInteger(height) && Number(width) > 0 && Number(height) > 0
  const hasDuration = typeof duration === 'number' && Number.isFinite(duration) && duration > 0
  const aspect = hasDimensions ? Number(width) / Number(height) : NaN
  const correctAspect = hasDimensions && Math.abs(aspect - (9 / 16)) <= 0.015
  const dimensions = correctAspect && Number(width) >= 540 && Number(height) >= 960
  const geometry = hasDimensions && hasDuration
    ? measured(formatKey,
      dimensions && duration! >= 3 && duration! <= 90 ? 'PASS' : 'FAIL',
      `Measured ${width}×${height}, ${duration}s; Reel requires vertical 9:16 video at least 540×960 and 3–90 seconds.`)
    : unknown(formatKey, 'Video dimensions or duration probe is unavailable.')
  const reel = hasDimensions && hasDuration
    ? measured(reelKey, dimensions && duration! >= 3 && duration! <= 90 ? 'PASS' : 'FAIL',
      'Reel format is determined from the encoded video dimensions and duration.')
    : unknown(reelKey, 'Video dimensions or duration probe is unavailable.')

  const cues = evidence.subtitle_cues
  const subtitles = Array.isArray(cues) && hasDuration
    ? (() => {
      let previousEnd = 0
      const valid = cues.length > 0 && cues.every(cue => {
        const start = cue?.start_seconds
        const end = cue?.end_seconds
        const text = typeof cue?.text === 'string' ? cue.text.trim() : ''
        const ok = Number.isFinite(start) && Number.isFinite(end) && start >= previousEnd && end > start && end <= duration! && Boolean(text)
        if (Number.isFinite(end)) previousEnd = end
        return ok
      })
      return measured(subtitleKey, valid ? 'PASS' : 'FAIL', valid
        ? `${cues.length} subtitle cues are ordered, non-overlapping, non-empty, and within the encoded video duration.`
        : 'Subtitle cues are empty, overlap, have invalid timing, or extend beyond the video duration.')
    })()
    : unknown(subtitleKey, 'Subtitle timing data or video duration probe is unavailable.')

  const cover = typeof evidence.cover_mean_luma === 'number'
    && typeof evidence.cover_luma_range === 'number'
    && typeof evidence.cover_placeholder_detected === 'boolean'
    ? measured(coverKey,
      evidence.cover_mean_luma >= 18 && evidence.cover_luma_range >= 20 && !evidence.cover_placeholder_detected ? 'PASS' : 'FAIL',
      `Sampled frame mean luma ${evidence.cover_mean_luma}, luma range ${evidence.cover_luma_range}, placeholder text ${evidence.cover_placeholder_detected ? 'detected' : 'not detected'}.`)
    : unknown(coverKey, 'Cover-frame luma or placeholder-text probe is unavailable.')

  return [audio, geometry, subtitles, cover, reel]
}
