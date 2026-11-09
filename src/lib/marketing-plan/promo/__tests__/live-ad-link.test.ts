import { describe, expect, it } from 'vitest'
import {
  budgetChangesFromSnapshots, describeLiveAdLink, parseBudgetApproval, parseLaunchReceipts, pickCurrentApprovedPlan,
  type LaunchReceipt,
} from '../live-ad-link'

const plan = { id: 'plan-1', title: '春季计划', approvedAt: '2026-10-01T00:00:00.000Z' }
const adset = { id: 'set-1', name: '询盘组', accountLabel: '官方账户', campaignId: 'camp-1' }
const receipt: LaunchReceipt = {
  actionId: 'act-1', adSetIds: ['set-1'], campaignId: 'camp-1', authorizedAt: '2026-10-02T01:00:00.000Z', basis: 'pm',
}

const executed = (over: Record<string, unknown> = {}) => ({
  status: 'active',
  campaignId: 'camp-1',
  adSetId: 'set-1',
  readback: '广告组读回来了',
  activation: { status: 'executed', authorized_at: '2026-10-20T01:00:00.000Z', basis: 'global_admin' },
  ...over,
})

describe('live ad link', () => {
  it('keeps the original times and marks a budget change with no receipt', () => {
    const text = describeLiveAdLink({
      plan,
      adsets: [adset, { id: 'set-2', name: null, accountLabel: '官方账户', campaignId: 'camp-1' }],
      receipts: [receipt],
      changes: [
        { adSetId: 'set-1', at: '2026-10-05T00:00:00.000Z', afterMinor: 1200 },
        { adSetId: 'set-1', at: '2026-10-08T00:00:00.000Z', afterMinor: 1500 },
      ],
      approvals: [{ runId: 'run-1', adSetId: 'set-1', campaignId: 'camp-1', afterMinor: 1200, approvedAt: '2026-10-04T00:00:00.000Z' }],
      changesTruncated: false,
    }).join('\n')
    expect(text).toContain('春季计划')
    expect(text).toContain('2026-10-01')
    expect(text).toContain('对上当前已批准的计划「春季计划」')
    expect(text).toContain('由 PM 本人批的')
    expect(text).toContain('第 2 个开着的广告组')
    expect(text).toContain('无批准记录，没有对上已批准计划')
    expect(text).toContain('对上了改预算回执')
    expect(text).toContain('无批准记录。')
    expect(text).not.toContain('set-1')
    expect(text).not.toContain('1200')
  })

  it('picks the latest approved plan that has not been replaced', () => {
    expect(pickCurrentApprovedPlan([
      { id: 'old', title: '旧', status: 'approved', approvedAt: '2026-09-01T00:00:00.000Z', superseded: true },
      { id: 'new', title: '新', status: 'approved', approvedAt: '2026-10-01T00:00:00.000Z', superseded: false },
      { id: 'draft', title: '草稿', status: 'draft', approvedAt: null, superseded: false },
    ])?.id).toBe('new')
  })

  it('sees a budget change only when the amount changed, and ignores a run with no read-back or no time', () => {
    expect(budgetChangesFromSnapshots([
      { entityId: 'set-1', capturedAt: '2026-10-01T00:00:00.000Z', dailyBudgetMinor: 1000 },
      { entityId: 'set-1', capturedAt: '2026-10-02T00:00:00.000Z', dailyBudgetMinor: 1000 },
      { entityId: 'set-1', capturedAt: '2026-10-03T00:00:00.000Z', dailyBudgetMinor: 1200 },
    ])).toEqual([{ adSetId: 'set-1', at: '2026-10-03T00:00:00.000Z', afterMinor: 1200 }])
    expect(parseBudgetApproval({
      id: 'run-1', input: { adset_id: 'set-1', after_cents: 1200 },
      finishedAt: '2026-10-04T00:00:00.000Z', decisionAt: null, readbackPassed: false,
    })).toBeNull()
    expect(parseBudgetApproval({
      id: 'run-2', input: { adset_id: 'set-1', after_cents: 1200 },
      finishedAt: null, decisionAt: null, readbackPassed: true,
    })).toBeNull()
    expect(parseBudgetApproval({
      id: 'run-3', input: { adset_id: 'set-1', after_cents: 1200 },
      finishedAt: '2026-10-09T00:00:00.000Z', decisionAt: '2026-10-04T00:00:00.000Z', readbackPassed: true,
    })?.approvedAt).toBe('2026-10-04T00:00:00.000Z')
  })

  it('keeps an executed read-back, accepts a confirmation card, and uses the earliest time', () => {
    const rows = parseLaunchReceipts([
      { id: 'later', payload: executed({ activation: { status: 'executed', authorized_at: '2026-10-22T01:00:00.000Z', basis: 'global_admin' } }) },
      { id: 'earlier', payload: executed() },
      { id: 'pending', payload: executed({ adSetId: 'set-2', activation: { status: 'authorized_pending', authorized_at: '2026-10-20T01:00:00.000Z' } }) },
      { id: 'card', payload: executed({
        adSetId: 'set-9', readback: '', goLiveStartedAt: '2026-10-21T02:00:00.000Z',
        activation: { status: 'executed', authorized_at: '2026-10-21T01:00:00.000Z', basis: 'go_live_card' },
      }) },
    ])
    const text = describeLiveAdLink({
      plan, adsets: [adset, { id: 'set-9', name: '确认组', accountLabel: '官方账户', campaignId: 'camp-1' }],
      receipts: rows, changes: [], approvals: [], changesTruncated: false,
    }).join('\n')
    expect(text).toContain('由 PM 本人批的')
    expect(text).toContain('2026-10-20')
    expect(text).not.toContain('2026-10-22')
    expect(text).toContain('由确认卡批的')
  })
})
