import { describe, expect, it } from 'vitest'
import { applyApprove } from './review-apply'
import { defaultFactSourceRef, reviewErrorZh, reviewGate } from './review-ui'
import type { ReviewGateInput } from './review-ui'
import { REEL_HUMAN_CHECK_KEYS } from '@/lib/social/content-review'

const labelOf = (k: string) => (k === 'factual_claims_have_source' ? '事实性主张有来源' : k)

describe('defaultFactSourceRef', () => {
  it('prefills a valid https url', () => {
    expect(defaultFactSourceRef('https://ctstours.co.nz/tours/china/signature/grand-tour')).toBe('https://ctstours.co.nz/tours/china/signature/grand-tour')
  })
  it.each([undefined, null, '', 'https://ctstours.co.nz', 'https://ctstours.co.nz/', 'http://a.com/x', 'ftp://a.com', 'not a url', 42])('leaves %p empty (incl. homepage)', (v) => {
    expect(defaultFactSourceRef(v)).toBe('')
  })
})

describe('reviewErrorZh', () => {
  it('tells PM which item needs a source url', () => {
    const msg = reviewErrorZh('checklist factual_claims_have_source requires source_ref', labelOf)
    expect(msg).toContain('「事实性主张有来源」')
    expect(msg).toContain('来源网址')
  })
  it('maps known server errors and never returns raw english alone', () => {
    expect(reviewErrorZh('all human checklist items must PASS', labelOf)).toContain('PASS')
    expect(reviewErrorZh('checklist contains an invalid source_ref', labelOf)).toContain('https://')
    expect(reviewErrorZh('automatic checklist is incomplete or not measured', labelOf)).toContain('开发')
    expect(reviewErrorZh('something unexpected', labelOf)).toMatch(/^没通过成功/)
  })
})

describe('reviewGate', () => {
  const base: ReviewGateInput = {
    autoReady: true,
    redlineHits: [],
    qualityFlags: [],
    acceptedCategories: [],
    factSourcePrefilled: true,
  }

  it('allows one-click when everything is clean', () => {
    const gate = reviewGate(base)
    expect(gate.oneClick).toBe(true)
    expect(gate.reasons).toEqual([])
  })

  it('blocks when automatic media checks are not ready', () => {
    const gate = reviewGate({ ...base, autoReady: false })
    expect(gate.oneClick).toBe(false)
    expect(gate.reasons).toContain('自动媒体检测未通过')
  })

  it('blocks when a brand red-line phrase is hit', () => {
    const gate = reviewGate({ ...base, redlineHits: ['最便宜'] })
    expect(gate.oneClick).toBe(false)
  })

  it('blocks an unaccepted narrator_voice_mismatch flag but allows it once accepted', () => {
    const flag = { category: 'narrator_voice_mismatch' }
    const blocked = reviewGate({ ...base, qualityFlags: [flag] })
    expect(blocked.oneClick).toBe(false)

    const allowed = reviewGate({
      ...base,
      qualityFlags: [flag],
      acceptedCategories: ['narrator_voice_mismatch'],
    })
    expect(allowed.oneClick).toBe(true)
  })

  it.each(['competitor_brand', 'placeholder_caption', 'quality_check_unavailable'])(
    'never settles a non-acceptable flag %s even if listed as accepted',
    (category) => {
      const gate = reviewGate({
        ...base,
        qualityFlags: [{ category }],
        acceptedCategories: [category],
      })
      expect(gate.oneClick).toBe(false)
    },
  )

  it('blocks when the fact-source url is not prefilled', () => {
    const gate = reviewGate({ ...base, factSourcePrefilled: false })
    expect(gate.oneClick).toBe(false)
  })

  it('reports one reason per problem when several are present', () => {
    const gate = reviewGate({
      autoReady: false,
      redlineHits: ['最便宜'],
      qualityFlags: [{ category: 'narrator_voice_mismatch' }],
      acceptedCategories: [],
      factSourcePrefilled: false,
    })
    expect(gate.oneClick).toBe(false)
    expect(gate.reasons).toEqual([
      '自动媒体检测未通过',
      '文案命中品牌红线,需逐项核对',
      '品控提示未处理:narrator_voice_mismatch',
      '来源网址没有预填,需要手动填写',
    ])
  })
})

// 服务端把关规则没变:全 PASS 但「事实有来源」没填网址,仍被挡,且报错能被翻成「去哪填」。
describe('server gate unchanged', () => {
  it('rejects a PASS factual item without source_ref, and the message is translatable', async () => {
    const items = REEL_HUMAN_CHECK_KEYS.map(key => ({ key, judge: 'HUMAN', outcome: 'PASS', detail: null, source_ref: null }))
    const wo = { id: 'w', client_id: 'c', status: 'in_review', output: {}, review_ref: {} }
    const supabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: wo, error: null }) }) }) }) }
    const res = await applyApprove(supabase as never, 'w', 'pm', undefined, items)
    expect(res.ok).toBe(false)
    expect(reviewErrorZh(res.error ?? '', labelOf)).toContain('来源网址')
  })
})
