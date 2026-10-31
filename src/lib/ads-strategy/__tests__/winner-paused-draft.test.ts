import { describe, expect, it } from 'vitest'
import { validateDraft } from '../ad-draft'
import { pausedDraftFacts } from '../paused-draft-facts'
import { buildWinnerPausedDraft } from '@/lib/winner-reel-sync/paused-card'

const review = {
  adAccountId: 'act_1',
  accounts: [{
    ad_account_id: 'act_1',
    currency: 'NZD',
    daily_cap_cents: 10000,
    owned_by_client: true,
  }],
  clientCapCents: 20000,
}

describe('winner reel paused draft', () => {
  it('can be confirmed as an existing-ad-set card and does not describe a new budget', () => {
    const built = buildWinnerPausedDraft({
      clientId: 'c1',
      pageId: '11111',
      adSetId: '123456',
      adSetName: 'Pool',
      dailyBudgetMajor: 20,
      winners: [{ postId: '12345678', message: 'hello world reel', score: 3 }],
    })
    const draft = built.draft
    if (!draft) throw new Error('draft missing')
    expect(validateDraft(draft)).toEqual([])
    const facts = pausedDraftFacts(draft, '这位客户的广告账户', review)
    expect(facts.scope).toContain('不加预算')
    expect(facts.scope).toContain('不开')
    expect(facts.amount).toContain('不新增每天预算')
    expect(facts.date).toContain('不改这个广告组的结束日')
    expect(facts.hardChecks.every((check) => check.state === 'green')).toBe(true)
  })

  it('an unread budget cannot pass the card checks', () => {
    const built = buildWinnerPausedDraft({
      clientId: 'c1',
      pageId: '11111',
      adSetId: '123456',
      adSetName: 'Pool',
      dailyBudgetMajor: null,
      winners: [{ postId: '12345678', message: 'hello world reel', score: 3 }],
    })
    const draft = built.draft
    if (!draft) throw new Error('draft missing')
    const facts = pausedDraftFacts(draft, '这位客户的广告账户', review)
    expect(facts.hardChecks.some((check) => check.state !== 'green')).toBe(true)
    expect(facts.amount).toContain('还没读到')
  })
})
