import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { HardCheck } from '@/lib/confirmation-card/facts'
import { createFakeSupabase } from '@/lib/kernel/__tests__/fake-supabase'
import { CLIENT_A } from '@/lib/kernel/__tests__/fixtures'
import { AGENT_EXAM_ITEMS } from '../exam/agent-catalog'
import { markOrHold } from '../independent-review-gate'
import { reviewAdsAgentText } from '../independent-review'
import {
  independentReviewEnabled,
  readIndependentReviewSwitch,
  withIndependentReviewSwitch,
  writeIndependentReviewSwitch,
} from '../independent-review-switch'

const GREEN: HardCheck = { label: '来源仍批准', state: 'green', reason: '' }

describe('independent review uses the exam red lines', () => {
  for (const item of AGENT_EXAM_ITEMS) {
    it(`${item.id} reference answer is not returned by the shared red lines`, () => {
      expect(reviewAdsAgentText(item.passAnswer.text).verdict).toBe('pass')
    })

    it(`${item.id} red-line answer is returned`, () => {
      if (!item.redlineAnswer) return
      const review = reviewAdsAgentText(item.redlineAnswer.text)
      expect(review.verdict).toBe('return')
      expect(review.reason.length).toBeGreaterThan(0)
    })
  }

  it('does not write, and does not import a database client', () => {
    const review = readFileSync('src/lib/ads-strategy/independent-review.ts', 'utf8')
    const gate = readFileSync('src/lib/ads-strategy/independent-review-gate.ts', 'utf8')
    const sw = readFileSync('src/lib/ads-strategy/independent-review-switch.ts', 'utf8')
    expect(review).not.toContain('supabase')
    expect(review).not.toContain('.insert')
    expect(gate).not.toContain('.insert')
    expect(gate).not.toContain('.update')
    expect(gate).not.toContain('issueConfirmationCard')
    expect(sw).not.toContain('@supabase/supabase-js')
  })
})

describe('per-client switch', () => {
  it('stays off unless the stored value is exactly true, and keeps other keys', () => {
    expect(independentReviewEnabled(null)).toBe(false)
    expect(independentReviewEnabled({ ads_independent_review: false })).toBe(false)
    expect(independentReviewEnabled({ ads_independent_review: 'true' })).toBe(false)
    expect(independentReviewEnabled({ ads_independent_review: true })).toBe(true)
    expect(withIndependentReviewSwitch({ notify_emails: ['a@example.com'] }, true)).toMatchObject({
      notify_emails: ['a@example.com'],
      ads_independent_review: true,
    })
  })

  it('reads and writes the existing config, and a missing table is unreadable', async () => {
    const tables = { clients: [{ id: CLIENT_A, leads_config: { notify_emails: ['a@example.com'] } }] }
    const sb = createFakeSupabase(tables)
    expect(await readIndependentReviewSwitch(sb, CLIENT_A)).toBe('off')
    expect(await writeIndependentReviewSwitch(sb, CLIENT_A, true)).toBe('on')
    expect(tables.clients[0]?.leads_config).toMatchObject({
      notify_emails: ['a@example.com'],
      ads_independent_review: true,
    })
    expect(await readIndependentReviewSwitch(sb, 'missing-client')).toBe('unreadable')
    expect(await readIndependentReviewSwitch(createFakeSupabase({}), CLIENT_A)).toBe('unreadable')
  })
})

describe('mark or hold', () => {
  it('leaves the checks alone when the switch is off, even if the text would be returned', async () => {
    const sb = createFakeSupabase({
      clients: [{ id: CLIENT_A, leads_config: { ads_independent_review: false } }],
    })
    const held = await markOrHold(sb, CLIENT_A, [GREEN], false, '已帮你暂停这条广告')
    expect(held).toEqual({ kind: 'keep', checks: [GREEN] })
  })

  it('returns instead of marking when eight checks are already full', async () => {
    const sb = createFakeSupabase({
      clients: [{ id: CLIENT_A, leads_config: { ads_independent_review: true } }],
    })
    const checks = Array.from({ length: 8 }, (_, index): HardCheck => ({
      label: `检查${index}`,
      state: 'green',
      reason: '',
    }))
    const held = await markOrHold(sb, CLIENT_A, checks, false, '先等人看过再决定')
    expect(held.kind).toBe('return')
  })

  it('does not review a proposal the existing guard already blocked', async () => {
    const sb = createFakeSupabase({
      clients: [{ id: CLIENT_A, leads_config: { ads_independent_review: true } }],
    })
    const held = await markOrHold(sb, CLIENT_A, [GREEN], true, '已帮你暂停这条广告')
    expect(held).toEqual({ kind: 'keep', checks: [GREEN] })
  })
})
