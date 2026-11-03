import { describe, expect, it } from 'vitest'
import { buildDisagreeTodo, needsRuling, readClientBlocks, rulingUrl } from '../baozheng-items'
import { LANE_OF_KIND } from '../five-kinds'
import type { StoredReview } from '@/lib/baozheng/types'

const NOW = Date.parse('2026-11-05T00:00:00Z')
const DAY = 86_400_000

function review(p: Partial<StoredReview> = {}): StoredReview {
  return {
    judgment_id: '11111111-1111-1111-1111-111111111111',
    contact_id: 'c1',
    kind: 'sample',
    ai_stage: 'contacted',
    review_stage: 'quoted',
    result: 'disagree',
    reason: '客人 Jane 说 "please send the May price"',
    judged_at: '2026-10-30T00:00:00Z',
    reviewed_at: new Date(NOW - DAY).toISOString(),
    ...p,
  }
}

describe('needsRuling', () => {
  it('only unruled, fresh disagreements', () => {
    expect(needsRuling(review(), new Set(), NOW)).toBe(true)
    expect(needsRuling(review({ result: 'agree' }), new Set(), NOW)).toBe(false)
    expect(needsRuling(review(), new Set(['11111111-1111-1111-1111-111111111111']), NOW)).toBe(false)
    expect(needsRuling(review({ reviewed_at: new Date(NOW - 15 * DAY).toISOString() }), new Set(), NOW)).toBe(false)
  })
})

describe('buildDisagreeTodo', () => {
  it('uses stage labels, links to the ruling page, and never carries customer text (待办会发邮件)', () => {
    const labels = new Map([['contacted', '已联系'], ['quoted', '已报价']])
    const t = buildDisagreeTodo('client-1', review(), labels)
    expect(t.what).toContain('已联系')
    expect(t.what).toContain('已报价')
    expect(t.href).toBe(rulingUrl('client-1', '11111111-1111-1111-1111-111111111111'))
    expect(`${t.what}${t.how}`).not.toMatch(/Jane|May price|please/)
  })

  it('pool wording says a good customer may have been missed', () => {
    const t = buildDisagreeTodo('client-1', review({ kind: 'pool', ai_stage: 'new', review_stage: 'deposit_paid' }), new Map())
    expect(t.what).toContain('漏了')
  })
})

describe('readClientBlocks', () => {
  it('skips malformed entries and invalid reviews', () => {
    const blocks = readClientBlocks({ clients: [{ client_id: 'a', status: 'reviewed', reviews: [review(), { nope: 1 }] }, 'junk', { status: 'x' }] })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.reviews).toHaveLength(1)
  })
})

describe('lanes', () => {
  it('disagreements go to the PM "认一下" lane, run failures to dev', () => {
    expect(LANE_OF_KIND.baozheng_review_disagree).toBe('truth')
    expect(LANE_OF_KIND.baozheng_run_failed).toBe('dev')
  })
})
