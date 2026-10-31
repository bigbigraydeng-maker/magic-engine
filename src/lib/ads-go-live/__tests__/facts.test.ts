import { describe, expect, it } from 'vitest'
import { ConfirmationCardError } from '@/lib/confirmation-card'
import { chooseAccountLabel } from '../account'
import { goLiveSubjectKey, parsePausedDraft, type PausedDraftView } from '../draft'
import { buildGoLiveFacts } from '../facts'
import { gatesFromReceipt } from '../checks'
import { PREFLIGHT_GATE_KEYS } from '@/lib/ads-tracking-preflight/types'

const NOW = new Date('2026-10-28T12:00:00.000Z')

function greenGates() {
  return gatesFromReceipt({
    receipt: {
      checkedAt: '2026-10-28T11:00:00.000Z',
      gates: PREFLIGHT_GATE_KEYS.map((key) => ({ key, status: 'green', reason: '过了' })),
    },
    now: NOW,
  })
}

function view(patch: Partial<PausedDraftView> = {}): PausedDraftView {
  return {
    status: 'awaiting_approval',
    kind: 'lead_form',
    dailyBudget: 40,
    durationDays: 7,
    accountLabel: '演示广告账户',
    ids: { campaignId: 'camp', adSetId: 'set', adIds: ['ad'] },
    ...patch,
  }
}

describe('go-live facts', () => {
  it('builds a subject key from the draft id and refuses a bad id', () => {
    expect(goLiveSubjectKey('AbC_1')).toBe('go-live:abc_1')
    expect(goLiveSubjectKey('../nope')).toBeNull()
    expect(() => buildGoLiveFacts({
      draftId: '../nope',
      view: view(),
      gates: greenGates(),
      boundLabels: [],
    })).toThrow(ConfirmationCardError)
  })

  it('prints amount, date, and the three layers when the draft is readable', () => {
    const facts = buildGoLiveFacts({
      draftId: 'draft-1',
      view: view(),
      gates: greenGates(),
      boundLabels: [],
    })
    expect(facts.what).toBe('开投：把暂停的广告改成在投')
    expect(facts.account).toBe('演示广告账户')
    expect(facts.amount).toBe('每天 40，按这个广告账户自己的货币')
    expect(facts.date).toBe('从点下去的这一天开始，计划跑 7 天')
    expect(facts.scope).toBe('开到广告、广告组和广告系列这三层')
    expect(facts.hardChecks).toEqual([
      { label: '开投前十道检查', state: 'green', reason: '十道都是绿灯' },
    ])
  })

  it('blocks when the account, amount, date, kind, or ids cannot be read', () => {
    expect(chooseAccountLabel('act_99887766', ['演示广告账户'])).toEqual({ label: '演示广告账户' })
    expect(chooseAccountLabel(null, [])).toEqual({ problem: '读不到广告账户' })
    expect(chooseAccountLabel(null, ['甲', '乙'])).toEqual({ problem: '草稿没写明是哪个广告账户' })
    expect(chooseAccountLabel(null, ['act_1'])).toEqual({ problem: '账户名称没记下' })

    const facts = buildGoLiveFacts({
      draftId: 'draft-1',
      view: view({
        accountLabel: null,
        dailyBudget: null,
        durationDays: 0,
        kind: 'messenger',
        ids: null,
      }),
      gates: greenGates(),
      boundLabels: null,
    })
    expect(facts.account).toBe('读不到广告账户')
    expect(facts.amount).toBe('每天多少钱读不到')
    expect(facts.date).toBe('开始日读不到')
    const labels = facts.hardChecks.map((row) => row.label)
    expect(labels).toEqual(expect.arrayContaining(['广告类型', '广告编号', '广告账户', '每天多少钱', '开始日']))
    expect(facts.hardChecks.every((row) => row.state !== 'green')).toBe(true)
  })

  it('keeps a reused campaign out of the switch promise', () => {
    const parsed = parsePausedDraft({
      status: 'awaiting_approval',
      campaignId: 'camp',
      adSetId: 'set',
      adIds: ['ad'],
      draft: { kind: 'lead_form', existingCampaignId: 'camp', dailyBudget: 40, durationDays: 7 },
    })
    expect(parsed?.ids).toEqual({
      campaignId: 'camp', adSetId: 'set', adIds: ['ad'], reusedCampaign: true,
    })
    const facts = buildGoLiveFacts({
      draftId: 'draft-1',
      view: view({ ids: parsed?.ids ?? null }),
      gates: greenGates(),
      boundLabels: [],
    })
    expect(facts.scope).toBe('开到新的广告和广告组。原来的广告系列这次不改开关')
  })

  it('uses the existing ad set budget instead of the unused draft numbers', () => {
    const parsed = parsePausedDraft({
      status: 'awaiting_approval',
      campaignId: 'camp',
      adSetId: 'set',
      adIds: ['ad'],
      draft: {
        kind: 'video_thruplay',
        existingAdSetId: 'set',
        dailyBudget: 15,
        durationDays: 7,
        inheritedSpend: { dailyBudget: 100, durationDays: null },
      },
    })
    expect(parsed?.dailyBudget).toBe(100)
    expect(parsed?.durationDays).toBeNull()
    expect(parsed?.inheritedSchedule).toBe(true)
    expect(parsed?.ids?.reusedAdSet).toBe(true)
    expect(parsed?.ids?.reusedCampaign).toBe(true)
    const facts = buildGoLiveFacts({
      draftId: 'draft-1',
      view: view({
        dailyBudget: parsed?.dailyBudget ?? null,
        durationDays: parsed?.durationDays ?? null,
        inheritedSchedule: true,
        ids: parsed?.ids ?? null,
      }),
      gates: greenGates(),
      boundLabels: [],
    })
    expect(facts.amount).toBe('每天 100，按这个广告账户自己的货币')
    expect(facts.date).toBe('这个广告组没有结束日')
    expect(facts.scope).toBe('只开这次新加的广告。原来的广告组和广告系列这次不改开关')
    expect(facts.hardChecks.every((row) => row.state === 'green')).toBe(true)

    const unread = parsePausedDraft({
      status: 'awaiting_approval',
      campaignId: 'camp',
      adSetId: 'set',
      adIds: ['ad'],
      draft: { kind: 'video_thruplay', existingAdSetId: 'set', dailyBudget: 15, durationDays: 7 },
    })
    expect(unread?.dailyBudget).toBeNull()
    expect(unread?.durationDays).toBeNull()
  })

  it('reads the optional account name and does not invent ids', () => {
    const parsed = parsePausedDraft({
      status: 'awaiting_approval',
      accountLabel: '  演示广告账户  ',
      campaignId: 'camp',
      adSetId: 'set',
      adIds: ['ad'],
      draft: { kind: 'video_thruplay', dailyBudget: 12.5, durationDays: 3 },
    })
    expect(parsed?.accountLabel).toBe('演示广告账户')
    expect(parsed?.dailyBudget).toBe(12.5)
    expect(JSON.stringify(parsed)).not.toMatch(/act_\d/)
  })
})
