import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { KernelDeps } from '@/lib/kernel/deps'
import type { BudgetIssueResult } from '@/lib/ads-budget-card/flow'
import { issueOnePauseCard } from '@/lib/ads-pause-card/issue'
import type { PauseAdSetOrder } from '@/lib/ads-pause-card/order'
import { ADS_ACTION_TYPE, ADS_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import { parseLedgerFile } from '@/lib/ledger/parse'
import { fakeBudgetAction, fakePauseAction, pauseCardOrderFromAction } from '../prescription-action-list'
import {
  actionCardKey,
  issuePlannedCards,
  planActionCards,
  readStoredActionCards,
  withActionCards,
  type ActionCardItem,
  type ActionCardPorts,
} from '../prescription-action-cards'

const PRESCRIPTION = 'a1110000-0000-4000-8000-000000000001'
const VERSION = 2

const pauseOrder: PauseAdSetOrder = {
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

function content(actions: unknown) {
  return { summary: '测试处方', phases: [], kpi_targets: [], budget_allocation: [], action_list: actions }
}

function ports(): ActionCardPorts & { pause: ReturnType<typeof vi.fn>; budget: ReturnType<typeof vi.fn> } {
  const pause = vi.fn(async () => ({ prescriptionId: PRESCRIPTION, status: 'issued' as const, runId: 'pause-run' }))
  const budget = vi.fn(async () => ({
    status: 'issued' as const,
    reason: null,
    card: { runId: 'budget-run' },
  } as BudgetIssueResult))
  return { pause, budget, issuePause: pause, issueBudget: budget }
}

function issued(index: number, type: string, runId: string): ActionCardItem {
  return {
    key: actionCardKey(PRESCRIPTION, index, type),
    index,
    type,
    status: 'issued',
    reason: null,
    runId,
    wroteMeta: false,
  }
}

describe('prescription action cards', () => {
  it('issues one card per kept action and never writes', async () => {
    const planned = planActionCards(PRESCRIPTION, VERSION, content([
      fakePauseAction(),
      fakeBudgetAction({
        target: { ad_account_id: 'act_111111', campaign_id: 'camp_FAKE_B', adset_id: '111' },
        direction: 'down',
        expected_metric: ADS_METRIC_KEY.SPEND,
      }),
    ]))
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    const used = ports()
    const report = await issuePlannedCards({ prescriptionId: PRESCRIPTION, work: planned.work, prior: [], ports: used })
    expect(report.wroteMeta).toBe(false)
    expect(report.lifetime).toBe('nz_day')
    expect(report.items.map((item) => item.status)).toEqual(['issued', 'issued'])
    expect(report.items.map((item) => item.key)).toEqual([
      `${PRESCRIPTION}:0:${ADS_ACTION_TYPE.PAUSE_AD_SET}`,
      `${PRESCRIPTION}:1:${ADS_ACTION_TYPE.ADJUST_ADSET_DAILY_BUDGET}`,
    ])
    const pauseOrder = pauseCardOrderFromAction(PRESCRIPTION, VERSION, fakePauseAction())
    expect(pauseOrder.ok).toBe(true)
    if (!pauseOrder.ok) return
    expect(used.pause).toHaveBeenCalledTimes(1)
    expect(used.pause).toHaveBeenCalledWith(pauseOrder.order)
    expect(used.budget).toHaveBeenCalledTimes(1)
    expect(report.items.every((item) => item.wroteMeta === false)).toBe(true)
  })

  it('keeps going when one issuer throws', async () => {
    const planned = planActionCards(PRESCRIPTION, VERSION, content([
      fakePauseAction(),
      fakeBudgetAction({
        target: { ad_account_id: 'act_111111', campaign_id: 'camp_FAKE_B', adset_id: '111' },
        direction: 'up',
        expected_metric: ADS_METRIC_KEY.SPEND,
      }),
    ]))
    if (!planned.ok) throw new Error('plan')
    const used = ports()
    used.budget.mockRejectedValue(new Error('预算卡没出成'))
    const report = await issuePlannedCards({ prescriptionId: PRESCRIPTION, work: planned.work, prior: [], ports: used })
    expect(report.items[0]?.status).toBe('issued')
    expect(report.items[1]).toMatchObject({ status: 'failed', reason: '预算卡没出成', runId: null, wroteMeta: false })
  })

  it('does not issue again for the same prescription, index, and type', async () => {
    const planned = planActionCards(PRESCRIPTION, VERSION, content([fakePauseAction()]))
    if (!planned.ok) throw new Error('plan')
    const prior = [issued(0, ADS_ACTION_TYPE.PAUSE_AD_SET, 'pause-run')]
    const used = ports()
    const report = await issuePlannedCards({ prescriptionId: PRESCRIPTION, work: planned.work, prior, ports: used })
    expect(used.pause).not.toHaveBeenCalled()
    expect(used.budget).not.toHaveBeenCalled()
    expect(report.items[0]).toMatchObject({ status: 'duplicate', runId: 'pause-run', wroteMeta: false })
  })

  it('records a budget row the existing issuer will not accept, and does not call it', async () => {
    const planned = planActionCards(PRESCRIPTION, VERSION, content([fakeBudgetAction()]))
    if (!planned.ok) throw new Error('plan')
    const used = ports()
    const report = await issuePlannedCards({ prescriptionId: PRESCRIPTION, work: planned.work, prior: [], ports: used })
    expect(used.budget).not.toHaveBeenCalled()
    expect(report.items[0]?.status).toBe('failed')
    expect(report.items[0]?.reason).toMatch(/广告组编号/)
  })

  it('records a missing budget direction without calling the issuer', async () => {
    const planned = planActionCards(PRESCRIPTION, VERSION, content([
      fakeBudgetAction({
        target: { ad_account_id: 'act_111111', campaign_id: 'camp_FAKE_B', adset_id: '111' },
        direction: undefined,
        expected_metric: ADS_METRIC_KEY.SPEND,
      }),
    ]))
    if (!planned.ok) throw new Error('plan')
    const used = ports()
    const report = await issuePlannedCards({ prescriptionId: PRESCRIPTION, work: planned.work, prior: [], ports: used })
    expect(used.budget).not.toHaveBeenCalled()
    expect(report.items[0]?.reason).toMatch(/升高或降低/)
  })

  it('leaves an empty list alone', async () => {
    const planned = planActionCards(PRESCRIPTION, VERSION, { summary: '只有人话' })
    expect(planned).toEqual({ ok: true, work: [] })
  })

  it('keeps other prescription notes when it stores card outcomes', () => {
    const next = withActionCards(
      { plan_approval: { status: 'failed' } },
      [issued(0, ADS_ACTION_TYPE.PAUSE_AD_SET, 'pause-run')],
    )
    expect(next.plan_approval).toEqual({ status: 'failed' })
    expect(readStoredActionCards(next)[0]?.runId).toBe('pause-run')
    const again = withActionCards(next, [{ ...issued(0, ADS_ACTION_TYPE.PAUSE_AD_SET, 'pause-run'), status: 'duplicate' }])
    expect(readStoredActionCards(again)).toHaveLength(1)
  })

  it('ledger card is readable', () => {
    const path = 'docs/ledger/2026-11-13-ad3-prescription-approve-issue-cards.md'
    const name = '2026-11-13-ad3-prescription-approve-issue-cards.md'
    const parsed = parseLedgerFile(name, readFileSync(path, 'utf8'))
    expect(parsed.ok).toBe(true)
  })

  it('does not execute, and asks the existing issuers for a day card', () => {
    const src = readFileSync('src/lib/ads/prescription-approve-cards.ts', 'utf8')
    const planner = readFileSync('src/lib/ads/prescription-action-cards.ts', 'utf8')
    expect(src).toContain('issueOnePauseCard')
    expect(planner).toContain('pauseCardOrderFromAction')
    expect(src).toContain('issueBudgetCard')
    expect(src).toContain('APPROVE_CARD_LIFETIME')
    expect(src).not.toMatch(/submitBudgetCard|confirmPauseCard|kernelBudgetPath|writePauseCardSwitch/)
  })
})

describe('existing issuer guards still close the card', () => {
  it('does not issue a pause card when the client switch is off', async () => {
    const live = vi.fn()
    const item = await issueOnePauseCard({
      kernel: { supabase: clientsDb({}) } as KernelDeps,
      clientId: 'client-1',
      clicker: { kind: 'opc', email: 'opc@example.com' },
      order: pauseOrder,
      live,
      lifetime: 'nz_day',
    })
    expect(item.status).toBe('off')
    expect(item.reason).toMatch(/没开暂停/)
    expect(live).not.toHaveBeenCalled()
  })

})

function clientsDb(leadsConfig: unknown): SupabaseClient {
  return {
    from() {
      return {
        select() { return this },
        eq() { return this },
        maybeSingle: async () => ({ data: { leads_config: leadsConfig }, error: null }),
      }
    },
  } as unknown as SupabaseClient
}
