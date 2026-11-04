/**
 * 确认卡这条入口只会建单个广告组：多个广告组的草稿必须在卡上就被拦（红），
 * 不能走到「点了确认却只建出一个组」。多组只走起草接口。
 */
import { describe, it, expect } from 'vitest'
import { pausedDraftBlock, pausedDraftFacts } from '../paused-draft-facts'
import type { AdDraft } from '../ad-draft'

const REVIEW = {
  adAccountId: 'act_test',
  accounts: [{ ad_account_id: 'act_test', currency: 'NZD', daily_cap_cents: 10000, owned_by_client: true }],
  clientCapCents: 20000,
}

const CREATIVE = { name: 'A', primaryText: 'Hello there', headline: 'Read more', imageHash: 'hash-1' }

const MULTI: AdDraft = {
  kind: 'lead_form',
  clientId: 'c1',
  campaignName: 'lead campaign',
  adSetName: '',
  dailyBudget: 20,
  durationDays: 7,
  geoCountries: [],
  pageId: 'page-1',
  leadFormId: 'form-1',
  creatives: [],
  budgetMode: 'ad_set',
  adSets: [
    { name: 'a', dailyBudget: 10, geoCountries: ['NZ'], creatives: [CREATIVE] },
    { name: 'b', dailyBudget: 10, geoCountries: ['NZ'], creatives: [CREATIVE] },
  ],
}

describe('确认卡：多个广告组的草稿', () => {
  it('「能按草稿建成暂停」这一项是红的，原因写明要走起草接口', () => {
    const check = pausedDraftFacts(MULTI, 'acct', REVIEW).hardChecks.find((c) => c.label === '能按草稿建成暂停')
    expect(check?.state).toBe('red')
    expect(check?.reason).toContain('多个广告组')
  })

  it('整张卡因此被拦（有拦截原因，不能确认）', () => {
    expect(pausedDraftBlock(MULTI, 'acct', REVIEW)).not.toBeNull()
  })
})
