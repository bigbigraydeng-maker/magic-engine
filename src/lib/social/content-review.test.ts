import { describe, expect, it } from 'vitest'
import {
  POST_AUTO_CHECK_KEYS,
  POST_HUMAN_CHECK_KEYS,
  type ContentCheckItemKey,
  type ContentCheckItemResult,
  REEL_AUTO_CHECK_KEYS,
  REEL_HUMAN_CHECK_KEYS,
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

  it('requires B-class evidence refs and a detail when an item fails', () => {
    const missingSource = passHuman(POST_HUMAN_CHECK_KEYS).map(item =>
      item.key === 'factual_claims_have_source' ? { ...item, source_ref: null } : item,
    )
    expect(validateContentChecklist(missingSource, POST_HUMAN_CHECK_KEYS, 'HUMAN').ok).toBe(false)

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
