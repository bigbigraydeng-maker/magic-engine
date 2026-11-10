import { describe, it, expect } from 'vitest'
import type { CardPayload } from '@/components/confirmation-card/HeldCards'
import { autoPauseSummaryCounts } from '../auto-pause-summary-counts'
import type { PendingItem } from '../use-auto-pause-data'

function card(what: string): CardPayload {
  return {
    runId: 'c1',
    expectedDecisionId: 'd1',
    fingerprint: 'fp',
    what,
    account: 'acct',
    amount: '0',
    date: '2026-11-10',
    scope: '暂停广告组',
    expiresLabel: '今晚',
    statusLine: '等',
    status: 'waiting',
    confirmEnabled: true,
    declineEnabled: true,
    blockedReason: null,
  }
}

function pending(adsetName: string): PendingItem {
  return {
    runId: 'r1',
    expectedDecisionId: 'd1',
    adsetId: null,
    adsetName,
    adAccountId: null,
    diagnosisTitle: '花钱没结果',
    insightDate: '2026-11-10',
    createdAt: '2026-11-10T00:00:00Z',
  }
}

describe('autoPauseSummaryCounts', () => {
  it('一条待办配一张匹配卡时，确认卡已出计 1', () => {
    const items = [pending('示例广告组 A')]
    const cards = [card('暂停 示例广告组 A 的花费')]
    const summary = autoPauseSummaryCounts(items, cards, [])
    expect(summary).toEqual({ waiting: 0, issued: 1, paused: 0, dismissed: 0 })
  })
})
