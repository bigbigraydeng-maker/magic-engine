import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  POST_AUTO_CHECK_KEYS,
  POST_HUMAN_CHECK_KEYS,
  type ContentCheckItemKey,
  type ContentCheckItemResult,
  REEL_AUTO_CHECK_KEYS,
  REEL_HUMAN_CHECK_KEYS,
  REEL_HUMAN_CHECK_KEYS_V2,
  REEL_HUMAN_CHECK_KEYS_V3,
  CHECKLIST_V3_REQUIRED_FROM,
  humanKeysForReviewRef,
  humanKeysForStored,
  checklistPasses,
  isValidContentSourceRef,
  splitPostChecklist,
  unmeasuredAutoChecks,
  validateContentChecklist,
} from './content-review'

const passHuman = (keys: readonly ContentCheckItemKey[]): ContentCheckItemResult[] => keys.map(key => ({
  key,
  judge: 'HUMAN',
  outcome: 'PASS',
  detail: null,
  source_ref: key.startsWith('factual_') ? 'https://example.test/source' : null,
}))

describe('social content review checklist', () => {
  it('keeps all seven listed Reel C checks in the required set', () => {
    expect(REEL_HUMAN_CHECK_KEYS).toHaveLength(9)
    expect(REEL_HUMAN_CHECK_KEYS).toContain('asset_provenance_matches_claim_context')
  })

  it('fails closed for missing, duplicate, wrong-judge, and failed checks', () => {
    const valid = passHuman(REEL_HUMAN_CHECK_KEYS)
    expect(validateContentChecklist(valid, REEL_HUMAN_CHECK_KEYS, 'HUMAN').ok).toBe(true)
    expect(validateContentChecklist(valid.slice(1), REEL_HUMAN_CHECK_KEYS, 'HUMAN').ok).toBe(false)
    expect(validateContentChecklist([...valid, valid[0]], REEL_HUMAN_CHECK_KEYS, 'HUMAN').ok).toBe(false)
    expect(validateContentChecklist(valid.map(item => ({ ...item, judge: 'AUTO' })), REEL_HUMAN_CHECK_KEYS, 'HUMAN').ok).toBe(false)
    expect(checklistPasses(unmeasuredAutoChecks(REEL_AUTO_CHECK_KEYS, 'engine absent'))).toBe(false)
  })

  it('requires evidence to pass a B-class check but allows a failed check to record a missing source', () => {
    const missingSource = passHuman(POST_HUMAN_CHECK_KEYS).map(item =>
      item.key === 'factual_claims_have_source' ? { ...item, source_ref: null } : item,
    )
    expect(validateContentChecklist(missingSource, POST_HUMAN_CHECK_KEYS, 'HUMAN').ok).toBe(false)

    const failedWithoutSource = passHuman(POST_HUMAN_CHECK_KEYS).map(item =>
      item.key === 'factual_claims_have_source'
        ? { ...item, outcome: 'FAIL' as const, detail: 'No source was provided', source_ref: null }
        : item,
    )
    expect(validateContentChecklist(failedWithoutSource, POST_HUMAN_CHECK_KEYS, 'HUMAN').ok).toBe(true)

    const missingDetail = passHuman(POST_HUMAN_CHECK_KEYS).map(item =>
      item.key === 'logo_watermark_present' ? { ...item, outcome: 'FAIL', detail: null } : item,
    )
    expect(validateContentChecklist(missingDetail, POST_HUMAN_CHECK_KEYS, 'HUMAN').ok).toBe(false)
  })

  it('requires exact Post human and server-owned auto sets; unmeasured first-comment checks cannot pass', () => {
    const human = passHuman(POST_HUMAN_CHECK_KEYS)
    const auto = unmeasuredAutoChecks(POST_AUTO_CHECK_KEYS, 'first-comment publishing is unavailable')
    const split = splitPostChecklist([...human, ...auto])
    expect(split.valid).toBe(true)
    expect(checklistPasses(split.human)).toBe(true)
    expect(checklistPasses(split.auto)).toBe(false)
  })

  it('accepts only HTTPS URLs or opaque client asset references for evidence', () => {
    expect(isValidContentSourceRef('https://example.test/fact')).toBe(true)
    expect(isValidContentSourceRef('client_asset:c0000000-0000-0000-0000-000000000001')).toBe(true)
    expect(isValidContentSourceRef('http://example.test/fact')).toBe(false)
    expect(isValidContentSourceRef('/private/path')).toBe(false)
  })
})

describe('listened-to-the-BGM approval item (2026-10-16)', () => {
  it('V2 = legacy 9 keys + bgm_listened_no_vocals, which is a plain HUMAN item without source_ref', () => {
    expect(REEL_HUMAN_CHECK_KEYS).toHaveLength(9)
    expect(REEL_HUMAN_CHECK_KEYS_V2).toEqual([...REEL_HUMAN_CHECK_KEYS, 'bgm_listened_no_vocals'])
    expect(validateContentChecklist(passHuman(REEL_HUMAN_CHECK_KEYS_V2).map(i => (
      i.key === 'factual_claims_have_source' || i.key === 'factual_claims_source_verified' ? { ...i, source_ref: 'https://example.com/x' } : i
    )), REEL_HUMAN_CHECK_KEYS_V2, 'HUMAN').ok).toBe(true)
  })

  it('a NEW approval without the listened item is refused (V2 requires it)', () => {
    const legacy = passHuman(REEL_HUMAN_CHECK_KEYS).map(i => (
      i.key === 'factual_claims_have_source' || i.key === 'factual_claims_source_verified' ? { ...i, source_ref: 'https://example.com/x' } : i
    ))
    const r = validateContentChecklist(legacy, REEL_HUMAN_CHECK_KEYS_V2, 'HUMAN')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('bgm_listened_no_vocals')
  })

  it('stored receipts: legacy 9-key receipts keep validating at publish time, V2 receipts need the item', () => {
    const withSource = (items: ContentCheckItemResult[]) => items.map(i => (
      i.key === 'factual_claims_have_source' || i.key === 'factual_claims_source_verified' ? { ...i, source_ref: 'https://example.com/x' } : i
    ))
    const legacy = withSource(passHuman(REEL_HUMAN_CHECK_KEYS))
    const v2 = withSource(passHuman(REEL_HUMAN_CHECK_KEYS_V2))
    // 切换日(2026-10-23)之后「没写批准时间」会按第三版处理，所以这里的旧收据都带一个切换前的批准时间，用例才不随日期变化
    const BEFORE_CUTOVER = '2026-10-20T00:00:00.000Z'
    const refOf = (checklist_human: unknown) => ({ approved_at: BEFORE_CUTOVER, checklist_human })
    expect(humanKeysForReviewRef(refOf(legacy))).toBe(REEL_HUMAN_CHECK_KEYS)
    expect(humanKeysForReviewRef(refOf(v2))).toBe(REEL_HUMAN_CHECK_KEYS_V2)
    expect(validateContentChecklist(legacy, humanKeysForReviewRef(refOf(legacy)), 'HUMAN').ok).toBe(true)
    expect(validateContentChecklist(v2, humanKeysForReviewRef(refOf(v2)), 'HUMAN').ok).toBe(true)
    // a V2 receipt whose listened item is missing a sibling cannot sneak through as legacy
    expect(validateContentChecklist(v2.filter(i => i.key !== 'logo_watermark_present'), humanKeysForReviewRef(refOf(v2)), 'HUMAN').ok).toBe(false)
    expect(humanKeysForReviewRef(refOf(null))).toBe(REEL_HUMAN_CHECK_KEYS)
    expect(humanKeysForReviewRef(refOf('x'))).toBe(REEL_HUMAN_CHECK_KEYS)
  })

  describe('V3 receipts (stand-alone understandable) and anti-downgrade', () => {
    const items = (keys: readonly ContentCheckItemKey[]) => passHuman(keys).map(i => (
      i.key === 'factual_claims_have_source' || i.key === 'factual_claims_source_verified' ? { ...i, source_ref: 'https://example.com/x' } : i
    ))
    const BEFORE = '2026-10-20T00:00:00.000Z'
    const AFTER = new Date(Date.parse(CHECKLIST_V3_REQUIRED_FROM) + 1000).toISOString()

    it('a receipt with checklist_version needs the V3 key set', () => {
      const ref = { checklist_version: 'v3', checklist_human: items(REEL_HUMAN_CHECK_KEYS_V3), approved_at: BEFORE }
      expect(humanKeysForReviewRef(ref)).toBe(REEL_HUMAN_CHECK_KEYS_V3)
      expect(validateContentChecklist(ref.checklist_human, humanKeysForReviewRef(ref), 'HUMAN').ok).toBe(true)
    })

    it('a v3-versioned receipt missing the new item is invalid (never silently downgraded to V2)', () => {
      const ref = { checklist_version: 'v3', checklist_human: items(REEL_HUMAN_CHECK_KEYS_V2), approved_at: BEFORE }
      expect(validateContentChecklist(ref.checklist_human, humanKeysForReviewRef(ref), 'HUMAN').ok).toBe(false)
    })

    it('old V2 receipts approved before the cutover still validate (unpublished approved orders keep working)', () => {
      const ref = { checklist_human: items(REEL_HUMAN_CHECK_KEYS_V2), approved_at: BEFORE }
      expect(humanKeysForReviewRef(ref)).toBe(REEL_HUMAN_CHECK_KEYS_V2)
      expect(validateContentChecklist(ref.checklist_human, humanKeysForReviewRef(ref), 'HUMAN').ok).toBe(true)
    })

    it('a receipt approved on/after the cutover WITHOUT a version cannot pass as V2', () => {
      const ref = { checklist_human: items(REEL_HUMAN_CHECK_KEYS_V2), approved_at: AFTER }
      expect(humanKeysForReviewRef(ref)).toBe(REEL_HUMAN_CHECK_KEYS_V3)
      expect(validateContentChecklist(ref.checklist_human, humanKeysForReviewRef(ref), 'HUMAN').ok).toBe(false)
    })

    it('once the cutover has passed, a missing or unreadable approval time cannot prove an old receipt (fail-closed)', () => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date(Date.parse(CHECKLIST_V3_REQUIRED_FROM) + 60_000))
        for (const approved_at of [undefined, null, 'garbage', 12345]) {
          const ref = { checklist_human: items(REEL_HUMAN_CHECK_KEYS_V2), approved_at }
          expect(humanKeysForReviewRef(ref)).toBe(REEL_HUMAN_CHECK_KEYS_V3)
          expect(validateContentChecklist(ref.checklist_human, humanKeysForReviewRef(ref), 'HUMAN').ok).toBe(false)
        }
        vi.setSystemTime(new Date(Date.parse(CHECKLIST_V3_REQUIRED_FROM) - 60_000))
        expect(humanKeysForReviewRef({ checklist_human: items(REEL_HUMAN_CHECK_KEYS_V2) })).toBe(REEL_HUMAN_CHECK_KEYS_V2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('a checklist that already carries the new item counts as V3 even without a version', () => {
      const ref = { checklist_human: items(REEL_HUMAN_CHECK_KEYS_V3), approved_at: BEFORE }
      expect(humanKeysForReviewRef(ref)).toBe(REEL_HUMAN_CHECK_KEYS_V3)
    })
  })
})
