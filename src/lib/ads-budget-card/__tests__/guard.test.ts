import { describe, expect, it } from 'vitest'
import { pausedDraftClickUrl } from '@/lib/ads-strategy/paused-draft-copy'
import { capNumbers, sumOtherLive } from '../caps'
import { budgetWhat } from '../copy'
import { guardBudget, stepProblem } from '../guard'
import { parseBudgetRequest } from '../request'
import { ratioFromMetadata } from '../ratio'
import type { BudgetOrder, BudgetSnapshot } from '../types'
import type { BudgetFacts, OtherAccountFact } from '@/lib/ads-tracking-preflight/types'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'

const order: BudgetOrder = {
  adsetId: '111',
  adAccountId: 'act_111111',
  newDailyBudgetCents: 120,
  name: '春季组',
}

function live(over: Partial<BudgetSnapshot> = {}): BudgetSnapshot {
  return {
    registeredAccountIds: ['act_111111'],
    accountId: '111111',
    adsetId: '111',
    status: 'ACTIVE',
    currentCents: 100,
    name: '春季组',
    accountCapCents: 500,
    accountLiveCents: 400,
    countedInLive: true,
    otherAccountsLiveCents: 0,
    clientCapCents: 900,
    lifetimeBlocks: false,
    stepRatio: 0.2,
    ...over,
  }
}

function other(cents: number, lifetime = 0): OtherAccountFact {
  return {
    tail: '2222',
    label: null,
    hidden: false,
    account_status: 1,
    currency: null,
    open_campaign_count: 1,
    live_daily_budget_cents: cents,
    live_lifetime_budget_count: lifetime,
    live_entity_count: 1,
    snapshot_at: '2026-11-02T00:00:00.000Z',
  }
}

describe('ad set budget step', () => {
  it('allows exactly twenty percent either way and rejects one unit past it', () => {
    expect(stepProblem(100, 120, 0.2)).toBeNull()
    expect(stepProblem(100, 80, 0.2)).toBeNull()
    expect(stepProblem(100, 121, 0.2)).toMatch(/超过了/)
    expect(stepProblem(100, 79, 0.2)).toMatch(/超过了/)
    expect(stepProblem(100, 110, 0.1)).toBeNull()
    expect(stepProblem(100, 111, 0.1)).toMatch(/10%/)
  })

  it('uses the platform default when the client has not set a tighter step', () => {
    expect(ratioFromMetadata({})).toBe(0.2)
    expect(ratioFromMetadata(null)).toBe(0.2)
    expect(ratioFromMetadata({ max_budget_step_ratio: 0.1 })).toBe(0.1)
    expect(ratioFromMetadata({ max_budget_step_ratio: 0.5 })).toBe('invalid')
  })

  it('rejects a raise that fits this account but not the client total once other accounts are counted', () => {
    const ok = guardBudget(order, live({ otherAccountsLiveCents: 0, clientCapCents: 600 }), null)
    expect(ok.block).toBeNull()
    const over = guardBudget(order, live({ otherAccountsLiveCents: 200, clientCapCents: 600 }), null)
    expect(over.block).toMatch(/所有广告账户加在一起/)
    const account = guardBudget(order, live({ accountCapCents: 410 }), null)
    expect(account.block).toMatch(/这个广告账户的每日上限/)
  })

  it('does not treat an unread other-account total as zero', () => {
    const unread = guardBudget(order, live({ otherAccountsLiveCents: null }), null)
    expect(unread.block).toMatch(/其它广告账户/)
    expect(sumOtherLive(null, '读不到')).toEqual({ cents: null, lifetime: false })
    expect(sumOtherLive([other(200), other(50)], null).cents).toBe(250)
  })

  it('fails closed when the live budget is no longer the one on the card', () => {
    const stale = guardBudget(order, live({ currentCents: 110 }), 100)
    expect(stale.block).toMatch(/不一样/)
    const same = guardBudget(order, live(), 100)
    expect(same.block).toBeNull()
  })

  it('only accepts an active or paused ad set in a registered account', () => {
    expect(guardBudget(order, live({
      status: 'PAUSED', countedInLive: false, accountCapCents: 900,
    }), null).block).toBeNull()
    expect(guardBudget(order, live({ status: 'DELETED' }), null).block).toMatch(/不是在投或暂停/)
    expect(guardBudget(order, live({ accountId: '999999' }), null).block).toMatch(/不在这位客户/)
  })

  it('says the change in plain language and keeps one ad set per card', () => {
    expect(budgetWhat('春季组', 100, 120)).toBe('把广告组 春季组 的日预算从 1.00 调到 1.20（+20%）')
    expect(pausedDraftClickUrl('client', 'run', budgetWhat('春季组', 100, 120))).toContain('/budget-cards/run')
    expect(() => parseBudgetRequest({ adsetIds: ['111', '222'] })).toThrow(ConfirmationCardError)
    expect(parseBudgetRequest({
      adsetId: '111',
      adAccountId: 'act_111111',
      newDailyBudgetCents: 120,
    }).adsetId).toBe('111')
  })

  it('adds other-account live budgets from the existing budget facts', () => {
    const facts: BudgetFacts = {
      read: true,
      error: null,
      as_of: '2026-11-02T00:00:00.000Z',
      account_cap_cents: 500,
      client_cap_cents: 900,
      registered_account_count: 2,
      live_daily_budget_cents: 400,
      live_lifetime_budget_count: 0,
      live_entity_count: 1,
      other_accounts: [other(200)],
      other_accounts_error: null,
    }
    expect(capNumbers(facts, 'ACTIVE').otherAccountsLiveCents).toBe(200)
    expect(capNumbers({ ...facts, other_accounts: null, other_accounts_error: '读不到' }, 'ACTIVE').otherAccountsLiveCents).toBeNull()
  })
})
