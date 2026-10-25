import { describe, expect, it } from 'vitest'
import { buildReelMediaAutoChecks, parseShortCreativePlan, type ReelMediaEvidence } from './reel-media-checks'

const valid: ReelMediaEvidence = {
  audio_stream_present: true,
  audio_loudness_lufs: -20,
  width: 1080,
  height: 1920,
  duration_seconds: 12,
  subtitle_cues: [
    { start_seconds: 0.2, end_seconds: 2.1, text: 'Explore with us' },
    { start_seconds: 2.2, end_seconds: 4.5, text: 'Small groups' },
  ],
  cover_mean_luma: 94,
  cover_luma_range: 108,
  cover_placeholder_detected: false,
}

describe('Reel media auto checks', () => {
  it('passes measured media that satisfies the Reel constraints', () => {
    expect(buildReelMediaAutoChecks(valid).map(item => item.outcome)).toEqual(['PASS', 'PASS', 'PASS', 'PASS', 'PASS'])
  })

  it('fails bad measurements and leaves missing probes unmeasured', () => {
    expect(buildReelMediaAutoChecks({ ...valid, audio_loudness_lufs: -70, width: 1080, height: 1080 })
      .map(item => item.outcome)).toEqual(['FAIL', 'FAIL', 'PASS', 'PASS', 'FAIL'])
    expect(buildReelMediaAutoChecks(null).every(item => item.outcome === 'NOT_MEASURED')).toBe(true)
  })
})

describe('Short creative plan receipt', () => {
  const plan = {
    schema_version: 1,
    hook_tag: 'hook-action',
    hook_beats: 2,
    build_tags: ['scene-one', 'scene-two', 'scene-three', 'scene-four'],
    payoff_tag: 'payoff-reveal',
    payoff_beats: 2,
    planned_scene_count: 6,
    rendered_clip_file_count: 12,
    human_review_required: true,
  }

  it('accepts a bounded structural receipt and rejects invalid or duplicate scenes', () => {
    expect(parseShortCreativePlan(plan)).toEqual(plan)
    expect(parseShortCreativePlan({ ...plan, build_tags: ['scene-one', 'scene-two', 'scene-three', 'hook-action'] })).toBeNull()
    expect(parseShortCreativePlan({ ...plan, rendered_clip_file_count: 5 })).toBeNull()
    expect(parseShortCreativePlan({ ...plan, human_review_required: false })).toBeNull()
  })
})
