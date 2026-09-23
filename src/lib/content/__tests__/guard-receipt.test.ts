import { describe, expect, it } from 'vitest'
import { readGuardFlag, needsHumanReview, splitByGuard } from '../guard-receipt'

const receipt = (over: Record<string, unknown> = {}) => ({
  content_guard: {
    status: 'pass',
    needs_human_review: false,
    target_language: 'en',
    language_findings: [],
    cliche_probability: 0.1,
    judge_error: null,
    cliche_threshold: 0.8,
    checked_at: '2026-09-23T00:00:00.000Z',
    ...over,
  },
})

describe('readGuardFlag', () => {
  it('returns null when the post carries no receipt (never checked ≠ checked and clean)', () => {
    expect(readGuardFlag(null)).toBeNull()
    expect(readGuardFlag({})).toBeNull()
    expect(readGuardFlag({ lesson_no: 3 })).toBeNull()
    expect(readGuardFlag({ content_guard: null })).toBeNull()
  })

  it('reads a clean receipt as not needing review', () => {
    const flag = readGuardFlag(receipt())
    expect(flag).toMatchObject({ status: 'pass', needsReview: false, reasons: [] })
  })

  it('reports mixed language with the offending fragments', () => {
    const flag = readGuardFlag(receipt({
      status: 'fail',
      needs_human_review: true,
      language_findings: [{ kind: 'embedded_fragment', sentence: 'Book the 黄金之旅 today.', fragment: '黄金之旅' }],
    }))
    expect(flag?.needsReview).toBe(true)
    expect(flag?.reasons).toEqual(['mixed_language'])
    expect(flag?.languageFindings[0].fragment).toBe('黄金之旅')
  })

  it('reports a cliché opener only at or above the threshold carried by the receipt', () => {
    expect(readGuardFlag(receipt({ status: 'fail', needs_human_review: true, cliche_probability: 0.9 }))?.reasons)
      .toEqual(['cliche_opener'])
    // Same probability, a receipt written when the threshold was higher ⇒ not a cliché failure.
    expect(readGuardFlag(receipt({ cliche_probability: 0.9, cliche_threshold: 0.95 }))?.reasons).toEqual([])
  })

  it('reports an unavailable judge as needing review, never as a pass', () => {
    const flag = readGuardFlag(receipt({
      status: 'unavailable',
      needs_human_review: true,
      cliche_probability: null,
      judge_error: 'quota exceeded',
    }))
    expect(flag?.needsReview).toBe(true)
    expect(flag?.reasons).toEqual(['check_unavailable'])
    expect(flag?.judgeError).toBe('quota exceeded')
  })

  it('lists every reason when several checks failed at once', () => {
    const flag = readGuardFlag(receipt({
      status: 'fail',
      needs_human_review: true,
      language_findings: [{ kind: 'off_target_sentence', sentence: '开启新篇章。', fragment: '开启新篇章。' }],
      cliche_probability: 0.93,
      judge_error: null,
    }))
    expect(flag?.reasons).toEqual(['mixed_language', 'cliche_opener'])
  })

  it('fails closed on a receipt it cannot read — somebody ran the guard, so review it', () => {
    expect(readGuardFlag({ content_guard: 'oops' })).toMatchObject({ needsReview: true, reasons: ['check_unavailable'] })
    expect(readGuardFlag({ content_guard: { status: 'weird' } })).toMatchObject({ needsReview: true })
  })

  it('never shows an unexplained red flag: needs_human_review with no readable reason still says why it cannot tell', () => {
    const flag = readGuardFlag(receipt({ needs_human_review: true, status: 'pass' }))
    expect(flag?.needsReview).toBe(true)
    expect(flag?.reasons).toEqual(['check_unavailable'])
  })

  it('trusts status over a missing needs_human_review flag', () => {
    expect(needsHumanReview(receipt({ status: 'fail', needs_human_review: undefined }))).toBe(true)
    expect(needsHumanReview(receipt())).toBe(false)
    expect(needsHumanReview({})).toBe(false)
  })
})

describe('splitByGuard', () => {
  it('keeps unchecked and clean rows, blocks flagged ones with their reasons', () => {
    const rows = [
      { id: 'clean', title: '干净的', generation_context_snapshot: receipt() },
      { id: 'never-checked', title: '老内容', generation_context_snapshot: { lesson_no: 1 } },
      {
        id: 'flagged',
        title: '中英混杂的',
        generation_context_snapshot: receipt({
          status: 'fail',
          needs_human_review: true,
          language_findings: [{ kind: 'embedded_fragment', sentence: 'a 团 b', fragment: '团' }],
        }),
      },
    ]
    const { allowed, blocked } = splitByGuard(rows)
    expect(allowed.map(r => r.id)).toEqual(['clean', 'never-checked'])
    expect(blocked).toEqual([{ id: 'flagged', title: '中英混杂的', reasons: ['mixed_language'] }])
  })
})
