import { describe, expect, it } from 'vitest'
import { ADS_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import { guardPause, type LiveFacts } from '../guard'
import { readPauseOrder, type PauseAdSetOrder } from '../order'
import { sourceBlock, type SourceRows } from '../source'
import { pauseCardEnabled, withPauseCardSwitch } from '../switch'
import { PAUSE_AD_SET_WHAT, pausedDraftClickUrl } from '@/lib/ads-strategy/paused-draft-copy'

const order: PauseAdSetOrder = {
  prescriptionId: 'rx-1',
  version: 2,
  adAccountId: 'acct-a',
  campaignId: 'camp-a',
  adsetId: 'set-a',
  metric: ADS_METRIC_KEY.SPEND,
  direction: 'pause',
  observationDays: 7,
  basis: '这一组花钱但没有结果',
}

function content(extra: Record<string, unknown> = {}) {
  return { pause_ad_set: { ...pauseBody(), ...extra } }
}

function pauseBody() {
  return {
    ad_account_id: 'acct-a',
    campaign_id: 'camp-a',
    adset_id: 'set-a',
    metric: ADS_METRIC_KEY.SPEND,
    direction: 'pause',
    observation_days: 7,
    basis: '这一组花钱但没有结果',
  }
}

function live(overrides: Partial<LiveFacts> = {}): LiveFacts {
  return {
    registeredAccountIds: ['acct-a'],
    target: { id: 'set-a', status: 'ACTIVE', accountId: 'acct-a' },
    campaignAdSets: [
      { id: 'set-a', status: 'ACTIVE', accountId: 'acct-a' },
      { id: 'set-b', status: 'ACTIVE', accountId: 'acct-a' },
    ],
    ...overrides,
  }
}

function rows(overrides: Partial<SourceRows> = {}): SourceRows {
  return {
    clientId: 'client-1',
    prescriptionId: 'rx-1',
    prescriptionStatus: 'approved',
    version: 2,
    goalId: 'goal-1',
    goalStatus: 'active',
    goalClientId: 'client-1',
    planId: 'plan-1',
    planStatus: 'approved',
    planClientId: 'client-1',
    planPrescriptionId: 'rx-1',
    planVersion: 2,
    ...overrides,
  }
}

describe('pause ad set order', () => {
  it('reads one pause and refuses resume, budget, or a list', () => {
    expect(readPauseOrder('rx-1', 2, content()).ok).toBe(true)
    expect(readPauseOrder('rx-1', 2, content({ direction: 'resume' }))).toMatchObject({ ok: false })
    expect(readPauseOrder('rx-1', 2, content({ status: 'ACTIVE' }))).toMatchObject({ ok: false })
    expect(readPauseOrder('rx-1', 2, { pause_ad_set: [pauseBody()] })).toMatchObject({ ok: false })
    expect(readPauseOrder('rx-1', 2, {}).ok).toBe(false)
  })
})

describe('pause ad set guard', () => {
  it('allows a pause that leaves another active ad set', () => {
    expect(guardPause(order, live(), null).block).toBeNull()
  })

  it('refuses to empty the campaign', () => {
    const facts = live({
      campaignAdSets: [{ id: 'set-a', status: 'ACTIVE', accountId: 'acct-a' }],
    })
    expect(guardPause(order, facts, null).block).toContain('没有在投广告组')
  })

  it('refuses an ad set that is no longer active or has moved client', () => {
    expect(guardPause(order, live({ target: { id: 'set-a', status: 'PAUSED', accountId: 'acct-a' } }), null).block).toContain('不是在投')
    expect(guardPause(order, live({ registeredAccountIds: ['acct-b'] }), null).block).toContain('不在这个客户')
  })
})

describe('source recheck', () => {
  const expected = { prescriptionId: 'rx-1', version: 2, goalId: 'goal-1', planId: 'plan-1' }

  it('passes only while the prescription, goal, and plan stay in force', () => {
    expect(sourceBlock(rows(), expected)).toBeNull()
    expect(sourceBlock(rows({ version: 3 }), expected)).toContain('那一版')
    expect(sourceBlock(rows({ goalStatus: 'archived' }), expected)).toContain('目标')
    expect(sourceBlock(rows({ planStatus: 'draft' }), expected)).toContain('计划')
    expect(sourceBlock(rows({ planClientId: 'client-2' }), expected)).toContain('计划')
  })
})

describe('switch and click', () => {
  it('stays off unless the existing config says true, and keeps other keys', () => {
    expect(pauseCardEnabled(null)).toBe(false)
    expect(pauseCardEnabled({ pause_ad_set_card: false })).toBe(false)
    expect(pauseCardEnabled({ pause_ad_set_card: true })).toBe(true)
    expect(withPauseCardSwitch({ notify_emails: ['a@example.com'] }, true)).toMatchObject({
      notify_emails: ['a@example.com'],
      pause_ad_set_card: true,
    })
  })

  it('sends this card to its own confirm route', () => {
    expect(pausedDraftClickUrl('client-1', 'run-1', PAUSE_AD_SET_WHAT)).toBe(
      '/api/clients/client-1/meta-ads/pause-ad-set-card/run-1',
    )
  })
})
