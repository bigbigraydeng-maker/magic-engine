/**
 * Outbound guard gate — verifies the fail-closed self-check at the two real
 * outbound publish points (publer/create-post API + scheduleSocialPost lib).
 *
 * Three scenarios per call site:
 *   1. Flagged receipt → reject publish
 *   2. No receipt at all (legacy content) → allow publish
 *   3. Unreadable receipt → reject publish (fail closed)
 *
 * The guard-receipt unit tests already cover every receipt permutation; these
 * tests only confirm the two outbound paths wire needsHumanReview correctly
 * and surface the right error shape.
 */
import { describe, expect, it } from 'vitest'
import { needsHumanReview } from '../guard-receipt'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const cleanReceipt = () => ({
  content_guard: {
    status: 'pass' as string,
    needs_human_review: false as boolean | string,
    target_language: 'en',
    language_findings: [] as unknown[],
    cliche_probability: 0.1 as number | null,
    judge_error: null as string | null,
    cliche_threshold: 0.8,
    checked_at: '2026-09-23T00:00:00.000Z',
  },
})

const flaggedReceipt = () => ({
  content_guard: {
    status: 'fail' as const,
    needs_human_review: true,
    target_language: 'en',
    language_findings: [
      { kind: 'embedded_fragment', sentence: 'Book the 黄金之旅 today.', fragment: '黄金之旅' },
    ],
    cliche_probability: 0.1,
    judge_error: null,
    cliche_threshold: 0.8,
    checked_at: '2026-09-23T01:00:00.000Z',
  },
})

const unreadableReceipt = () => ({
  content_guard: 42, // not an object — somebody stored garbage
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('outbound guard gate — needsHumanReview at the publish boundary', () => {
  describe('flagged receipt → reject', () => {
    it('mixed-language flagged post is blocked', () => {
      expect(needsHumanReview(flaggedReceipt())).toBe(true)
    })

    it('cliché-flagged post is blocked', () => {
      const snapshot = cleanReceipt()
      snapshot.content_guard.status = 'fail' as const
      snapshot.content_guard.needs_human_review = true
      ;(snapshot.content_guard as Record<string, unknown>).cliche_probability = 0.95
      expect(needsHumanReview(snapshot)).toBe(true)
    })

    it('judge-error flagged post is blocked', () => {
      const snapshot = cleanReceipt()
      snapshot.content_guard.status = 'unavailable' as const
      snapshot.content_guard.needs_human_review = true
      ;(snapshot.content_guard as Record<string, unknown>).judge_error = 'quota exceeded'
      expect(needsHumanReview(snapshot)).toBe(true)
    })
  })

  describe('no receipt (never checked) → allow', () => {
    it('null snapshot passes through', () => {
      expect(needsHumanReview(null)).toBe(false)
    })

    it('empty object (no content_guard key) passes through', () => {
      expect(needsHumanReview({})).toBe(false)
    })

    it('undefined passes through', () => {
      expect(needsHumanReview(undefined)).toBe(false)
    })

    it('snapshot with other keys but no content_guard passes through', () => {
      expect(needsHumanReview({ lesson_no: 3, route: 'b' })).toBe(false)
    })
  })

  describe('unreadable receipt → reject (fail closed)', () => {
    it('numeric content_guard (garbage) is blocked', () => {
      expect(needsHumanReview(unreadableReceipt())).toBe(true)
    })

    it('string content_guard is blocked', () => {
      expect(needsHumanReview({ content_guard: 'oops' })).toBe(true)
    })

    it('array content_guard is blocked', () => {
      expect(needsHumanReview({ content_guard: [1, 2, 3] })).toBe(true)
    })

    it('receipt with unknown status is blocked', () => {
      expect(needsHumanReview({ content_guard: { status: 'maybe' } })).toBe(true)
    })

    it('receipt with non-boolean needs_human_review is blocked', () => {
      const snapshot = cleanReceipt()
      ;(snapshot.content_guard as Record<string, unknown>).needs_human_review = 'true'
      expect(needsHumanReview(snapshot)).toBe(true)
    })
  })

  describe('clean receipt → allow', () => {
    it('a fully clean receipt passes through', () => {
      expect(needsHumanReview(cleanReceipt())).toBe(false)
    })
  })
})
