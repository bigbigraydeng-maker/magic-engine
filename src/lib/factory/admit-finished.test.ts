import { describe, expect, it } from 'vitest'
import { buildAdmitAutoChecklist } from './admit-finished'
import { REEL_AUTO_CHECK_KEYS } from '@/lib/social/content-review'

const GOOD_PROBE = { width: 1080, height: 1920, durationSeconds: 30, hasAudio: true }
const NO_AUDIO_PROBE = { width: 1080, height: 1920, durationSeconds: 30, hasAudio: false }
const BAD_ASPECT_PROBE = { width: 1920, height: 1080, durationSeconds: 30, hasAudio: true }
const SHORT_PROBE = { width: 1080, height: 1920, durationSeconds: 2, hasAudio: true }
const LONG_PROBE = { width: 1080, height: 1920, durationSeconds: 100, hasAudio: true }
const LOW_RES_PROBE = { width: 360, height: 640, durationSeconds: 30, hasAudio: true }

const PUBLISH_INPUT = {
  workOrderId: '11111111-2222-3333-4444-555555555555',
  caption: 'Check out our tours!',
  endcard: { cta: 'Book now', url: 'https://example.com/tours' },
}

describe('buildAdmitAutoChecklist', () => {
  it('produces exactly 7 checks matching REEL_AUTO_CHECK_KEYS', () => {
    const checks = buildAdmitAutoChecklist(GOOD_PROBE, PUBLISH_INPUT)
    expect(checks).toHaveLength(7)
    for (let i = 0; i < 7; i++) {
      expect(checks[i].key).toBe(REEL_AUTO_CHECK_KEYS[i])
    }
  })

  it('a good 9:16 video passes every probe check; subtitle and cover wait for 马良', () => {
    const checks = buildAdmitAutoChecklist(GOOD_PROBE, PUBLISH_INPUT)
    const waiting = new Set(['subtitle_timing_aligned', 'cover_frame_not_blank_or_placeholder'])
    for (const c of checks) {
      expect(c.outcome, `${c.key}`).toBe(waiting.has(c.key) ? 'NOT_MEASURED' : 'PASS')
      expect(c.judge).toBe('AUTO')
    }
  })

  it('audio check fails when no audio track', () => {
    const checks = buildAdmitAutoChecklist(NO_AUDIO_PROBE, PUBLISH_INPUT)
    const audio = checks.find(c => c.key === 'audio_track_present_nonsilent')!
    expect(audio.outcome).toBe('FAIL')
    expect(audio.detail).toContain('no audio')
  })

  it('resolution check fails for 16:9 landscape video', () => {
    const checks = buildAdmitAutoChecklist(BAD_ASPECT_PROBE, PUBLISH_INPUT)
    const res = checks.find(c => c.key === 'resolution_aspect_ratio_correct')!
    expect(res.outcome).toBe('FAIL')
    expect(res.detail).toContain('aspect ratio')
  })

  it('format check fails for too-short video', () => {
    const checks = buildAdmitAutoChecklist(SHORT_PROBE, PUBLISH_INPUT)
    const fmt = checks.find(c => c.key === 'format_is_reel')!
    expect(fmt.outcome).toBe('FAIL')
    expect(fmt.detail).toContain('duration')
  })

  it('format check fails for too-long video', () => {
    const checks = buildAdmitAutoChecklist(LONG_PROBE, PUBLISH_INPUT)
    const fmt = checks.find(c => c.key === 'format_is_reel')!
    expect(fmt.outcome).toBe('FAIL')
  })

  it('resolution check fails for low-res video', () => {
    const checks = buildAdmitAutoChecklist(LOW_RES_PROBE, PUBLISH_INPUT)
    const res = checks.find(c => c.key === 'resolution_aspect_ratio_correct')!
    expect(res.outcome).toBe('FAIL')
    expect(res.detail).toContain('resolution too low')
  })

  it('subtitle and cover are never self-passed at upload (they wait for 马良)', () => {
    const checks = buildAdmitAutoChecklist(GOOD_PROBE, PUBLISH_INPUT)
    for (const key of ['subtitle_timing_aligned', 'cover_frame_not_blank_or_placeholder']) {
      const item = checks.find(c => c.key === key)!
      expect(item.outcome).toBe('NOT_MEASURED')
      expect(item.detail).toContain('马良')
    }
  })

  it('publish checks fail when endcard URL is missing', () => {
    const checks = buildAdmitAutoChecklist(GOOD_PROBE, {
      ...PUBLISH_INPUT,
      endcard: { cta: 'Book now', url: '' },
    })
    const cta = checks.find(c => c.key === 'cta_in_first_comment_not_body')!
    expect(cta.outcome).toBe('FAIL')
  })
})
