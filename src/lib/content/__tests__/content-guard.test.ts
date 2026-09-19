import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ai/copy-judge-client', () => ({
  askCopyJudge: vi.fn(),
}))

import { askCopyJudge } from '@/lib/ai/copy-judge-client'
import {
  runContentGuard,
  checkLanguageConsistency,
  mergeGuardIntoRubric,
  hasRetryableFailure,
  SKIPPED_RUBRIC,
  LANGUAGE_DIMENSION,
  CLICHE_DIMENSION,
} from '../content-guard'
import { DEFAULT_CONTENT_GUARD_CONFIG, resolveContentGuardConfig } from '../content-guard-config'
import type { RubricResult } from '../quality-rubric'

const mockJudge = vi.mocked(askCopyJudge)
const CFG = DEFAULT_CONTENT_GUARD_CONFIG

// Regression fixtures — real published posts flagged in the 2026-09-20 evaluation (n=54).
const NAL_TITLE_1 = 'Unlock the Power of 一件代发物流支持 with NAL Express!'
const NAL_TITLE_2 = 'Unlock the Power of 奥克兰3PL仓库服务 with NAL Express!'
const CLEAN_EN =
  'Golden China — 12 days through Beijing, Xi\'an and Shanghai. Departs Auckland on 3 October. ' +
  'Small group, fully escorted. Book now at https://example.co.nz/tours #GoldenChina'
const CLEAN_ZH =
  '【系列课·第2讲】Facebook ThruPlay这样用，广告费才不浪费。每个视频先测三天，再决定加不加预算。'

const PASSING_RUBRIC: RubricResult = {
  overallScore: 8.5,
  pass: true,
  dimensions: [{ dimension: 'brand-fit', score: 9, pass: true, reason: 'ok', method: 'llm' }],
}

describe('checkLanguageConsistency (deterministic)', () => {
  it.each([NAL_TITLE_1, NAL_TITLE_2])('flags untranslated Chinese inside an English sentence: %s', title => {
    const { target, findings } = checkLanguageConsistency(title, CFG)
    expect(target).toBe('en')
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('embedded_fragment')
    expect(findings[0].fragment).toMatch(/[一-鿿]/)
  })

  it('flags the NAL titles even when the brief says the post is Chinese (long English run)', () => {
    const { findings } = checkLanguageConsistency(NAL_TITLE_1, CFG, 'zh')
    expect(findings[0].fragment).toBe('Unlock the Power of')
  })

  it('passes clean English copy (URL + hashtag stripped)', () => {
    const { target, findings } = checkLanguageConsistency(CLEAN_EN, CFG)
    expect(target).toBe('en')
    expect(findings).toEqual([])
  })

  it('passes clean Chinese copy with short embedded brand/product names', () => {
    const { target, findings } = checkLanguageConsistency(CLEAN_ZH, CFG)
    expect(target).toBe('zh')
    expect(findings).toEqual([])
  })

  it('flags a whole Chinese sentence in an English-target post as off-target', () => {
    const { findings } = checkLanguageConsistency(`${CLEAN_EN}\n立即预订，名额有限。`, CFG, 'en')
    expect(findings.map(f => f.kind)).toEqual(['off_target_sentence'])
  })

  it('ignores English inside <script> JSON-LD of a Chinese blog', () => {
    const html = `<p>${CLEAN_ZH}</p><script type="application/ld+json">{"@type":"Article","headline":"How to use ThruPlay ads well"}</script>`
    expect(checkLanguageConsistency(html, CFG).findings).toEqual([])
  })

  it('thresholds are configuration: allowing more embedded Latin words passes the NAL title in zh mode', () => {
    const { findings } = checkLanguageConsistency(NAL_TITLE_1, { ...CFG, maxEmbeddedLatinWords: 4 }, 'zh')
    expect(findings).toEqual([])
  })
})

describe('runContentGuard', () => {
  beforeEach(() => vi.resetAllMocks())

  it('NAL title: fails on language and on cliché (Copy Judge p=0.88)', async () => {
    mockJudge.mockResolvedValueOnce({ cliche: 0.88 })
    const g = await runContentGuard(NAL_TITLE_1, { config: CFG })
    expect(g.status).toBe('fail')
    expect(g.needsHumanReview).toBe(true)
    expect(g.dimensions.find(d => d.dimension === LANGUAGE_DIMENSION)?.pass).toBe(false)
    expect(g.dimensions.find(d => d.dimension === CLICHE_DIMENSION)?.pass).toBe(false)
  })

  it.each([CLEAN_EN, CLEAN_ZH])('clean copy with a low cliché score passes: %s', async text => {
    mockJudge.mockResolvedValueOnce({ cliche: 0.1 })
    const g = await runContentGuard(text, { config: CFG })
    expect(g.status).toBe('pass')
    expect(g.needsHumanReview).toBe(false)
  })

  it('cliché alone (clean language) fails at the configured threshold', async () => {
    mockJudge.mockResolvedValueOnce({ cliche: 0.8 })
    const g = await runContentGuard(CLEAN_EN, { config: CFG })
    expect(g.status).toBe('fail')
  })

  it('cliché threshold is configuration, not hardcoded', async () => {
    mockJudge.mockResolvedValueOnce({ cliche: 0.88 })
    const g = await runContentGuard(CLEAN_EN, { config: { ...CFG, clicheThreshold: 0.9 } })
    expect(g.status).toBe('pass')
  })

  it('fail-closed: Copy Judge error ⇒ unavailable + needs human review, never pass', async () => {
    mockJudge.mockRejectedValueOnce(new Error('Copy Judge HTTP 503'))
    const g = await runContentGuard(CLEAN_EN, { config: CFG })
    expect(g.status).toBe('unavailable')
    expect(g.needsHumanReview).toBe(true)
    expect(g.judgeError).toContain('503')
  })

  it('judge error + language failure reports fail (a rewrite can still fix the language)', async () => {
    mockJudge.mockRejectedValueOnce(new Error('timeout'))
    const g = await runContentGuard(NAL_TITLE_2, { config: CFG })
    expect(g.status).toBe('fail')
  })
})

describe('mergeGuardIntoRubric / hasRetryableFailure', () => {
  beforeEach(() => vi.resetAllMocks())

  it('guard failure forces pass=false but keeps the rubric overallScore', async () => {
    mockJudge.mockResolvedValueOnce({ cliche: 0.1 })
    const guard = await runContentGuard(NAL_TITLE_1, { config: CFG })
    const merged = mergeGuardIntoRubric(PASSING_RUBRIC, guard)
    expect(merged.pass).toBe(false)
    expect(merged.overallScore).toBe(8.5)
    expect(merged.dimensions.map(d => d.dimension)).toEqual(['brand-fit', LANGUAGE_DIMENSION, CLICHE_DIMENSION])
    expect(hasRetryableFailure(PASSING_RUBRIC, guard)).toBe(true)
  })

  it('judge-unavailable only ⇒ not retryable (regenerating cannot fix a provider outage)', async () => {
    mockJudge.mockRejectedValueOnce(new Error('down'))
    const guard = await runContentGuard(CLEAN_EN, { config: CFG })
    const merged = mergeGuardIntoRubric(PASSING_RUBRIC, guard)
    expect(merged.pass).toBe(false)
    expect(hasRetryableFailure(PASSING_RUBRIC, guard)).toBe(false)
  })

  it('judge-unavailable + only an advisory rubric dimension failing ⇒ still not retryable', async () => {
    mockJudge.mockRejectedValueOnce(new Error('down'))
    const guard = await runContentGuard(CLEAN_EN, { config: CFG })
    const withAdvisoryFail: RubricResult = {
      ...PASSING_RUBRIC,
      dimensions: [...PASSING_RUBRIC.dimensions,
        { dimension: 'viral-structure-preservation', score: 3, pass: true, reason: 'advisory', method: 'llm' }],
    }
    expect(hasRetryableFailure(withAdvisoryFail, guard)).toBe(false)
  })

  it('skipped rubric: score is not invented from guard dimensions', async () => {
    mockJudge.mockRejectedValueOnce(new Error('down'))
    const guard = await runContentGuard(CLEAN_EN, { config: CFG })
    const merged = mergeGuardIntoRubric(SKIPPED_RUBRIC, guard)
    expect(merged.overallScore).toBe(0)
    expect(merged.pass).toBe(false)
  })
})

describe('resolveContentGuardConfig', () => {
  it('reads env overrides and ignores out-of-range values', () => {
    const cfg = resolveContentGuardConfig({
      CONTENT_GUARD_CLICHE_THRESHOLD: '0.7',
      CONTENT_GUARD_MAX_EMBEDDED_LATIN_WORDS: 'abc',
    })
    expect(cfg.clicheThreshold).toBe(0.7)
    expect(cfg.maxEmbeddedLatinWords).toBe(DEFAULT_CONTENT_GUARD_CONFIG.maxEmbeddedLatinWords)
    expect(resolveContentGuardConfig({ CONTENT_GUARD_CLICHE_THRESHOLD: '1.5' }).clicheThreshold).toBe(0.8)
  })
})
