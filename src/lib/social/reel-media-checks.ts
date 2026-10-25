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
  capabilities?: string[]
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
