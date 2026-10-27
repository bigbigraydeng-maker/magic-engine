/**
 * Tuesday budget tune only issues a confirmation card.
 * A click records who pressed it and does not run a budget change.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createCapabilities } from '@/lib/capabilities'
import { decideConfirmationCard } from '@/lib/confirmation-card'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { CLIENT_A, makeFixture } from '@/lib/kernel/__tests__/fixtures'
import type { CardClicker } from '@/lib/confirmation-card'
import {
  issueTuesdayBudgetTunes,
  planTuesdayBudgetTunes,
  runTuesdayBudgetTune,
  type TuesdayBudgetProposal,
} from './tuesday-budget-tune'
import type { WeeklyCheckSummary } from './prescription-weekly-check'

const KEY = CONFIRMATION_ACTION_KEY
const OPC: CardClicker = { kind: 'opc', email: 'opc@example.com' }
const AGENT: CardClicker = { kind: 'agent', email: null }
const SUBJECT = 'a1b2c3d4-0000-4000-8000-000000000001'

const READY: TuesdayBudgetProposal = {
  clientId: CLIENT_A,
  subjectKey: SUBJECT,
  direction: 'increase',
  accountLabel: '主广告账户',
  beforeCents: 3000,
  afterCents: 3600,
  currencyLabel: '元',
  why: '近三天点击高于账户中位，现预算低于账户平均。',
  dateLabel: '这周二',
  scopeLabel: '只改这一次日预算',
}

function fixture() {
  const calls = vi.fn()
  const f = makeFixture({
    registry: ACTION_REGISTRY,
    startAt: '2026-10-27T00:00:00.000Z',
    capabilities: (sb) => {
      const impl = createCapabilities(sb)[KEY]
      return {
        [KEY]: {
          ...impl,
          steps: {
            hold: async (step) => {
              calls()
              return impl.steps.hold(step)
            },
          },
        },
      }
    },
  })
  return { f, calls }
}

function emptySummary(): WeeklyCheckSummary {
  return { considered: 1, checked: 1, outcomes: [] }
}

describe('周二加减预算只出确认卡', () => {
  it('加预算出卡，点了也不跑改预算', async () => {
    const { f, calls } = fixture()
    const [row] = await issueTuesdayBudgetTunes(f.kernel, [READY])
    expect(row.issued).toBe(true)
    expect(row.executed).toBe(false)
    expect(row.runId).toBeTruthy()
    const card = await decideConfirmationCard(f.kernel, {
      clientId: CLIENT_A,
      runId: row.runId ?? '',
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: expectDecision(f),
      fingerprint: row.fingerprint ?? '',
    })
    expect(card.confirmEnabled).toBe(false)
    expect(card.status).toBe('confirmed')
    expect(card.amount).toContain('30.00')
    expect(card.amount).toContain('36.00')
    expect(card.what).toContain('加上去')
    expect(card.what).toContain('不会自动改预算')
    expect(calls).not.toHaveBeenCalled()
    expect(actionKeys(f)).toEqual([KEY])
  })

  it('减预算同样只出卡', async () => {
    const { f, calls } = fixture()
    const [row] = await issueTuesdayBudgetTunes(f.kernel, [{
      ...READY,
      subjectKey: 'b1b2c3d4-0000-4000-8000-000000000002',
      direction: 'decrease',
      afterCents: 2400,
      why: '花费高出计划，结果没有跟上。',
    }])
    expect(row.issued).toBe(true)
    expect(row.executed).toBe(false)
    const card = await decideConfirmationCard(f.kernel, {
      clientId: CLIENT_A,
      runId: row.runId ?? '',
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: expectDecision(f),
      fingerprint: row.fingerprint ?? '',
    })
    expect(card.what).toContain('减下来')
    expect(card.amount).toContain('24.00')
    expect(calls).not.toHaveBeenCalled()
    expect(actionKeys(f)).toEqual([KEY])
  })

  it('代理人能出卡，不能点', async () => {
    const { f } = fixture()
    const [row] = await issueTuesdayBudgetTunes(f.kernel, [READY])
    await expect(decideConfirmationCard(f.kernel, {
      clientId: CLIENT_A,
      runId: row.runId ?? '',
      clicker: AGENT,
      resolution: 'confirm',
      expectedDecisionId: expectDecision(f),
      fingerprint: row.fingerprint ?? '',
    })).rejects.toThrow(/不能点/)
    expect(actionKeys(f)).toEqual([KEY])
  })

  it('金额读不到时不填 0，确认按钮是灰的', async () => {
    const { f } = fixture()
    const [row] = await issueTuesdayBudgetTunes(f.kernel, [{ ...READY, beforeCents: null }])
    expect(row.issued).toBe(true)
    expect(row.executed).toBe(false)
    const stored = cardText(f)
    expect(stored).toContain('现预算读不到')
    expect(stored).toContain('没有把现预算填成 0')
    expect(stored).not.toContain('现预算是 0')
    const card = await shownCard(f, row.runId ?? '')
    expect(card.amount.startsWith('现预算读不到')).toBe(true)
    expect(card.confirmEnabled).toBe(false)
  })

  it('账户号不写进卡里', async () => {
    const { f } = fixture()
    const secret = '123456789012345'
    await issueTuesdayBudgetTunes(f.kernel, [{ ...READY, accountLabel: secret }])
    expect(cardText(f)).not.toContain(secret)
    expect(cardText(f)).toContain('广告账户')
  })

  it('方向和金额对不上就不出卡，也不改预算', async () => {
    const { f } = fixture()
    const [row] = await issueTuesdayBudgetTunes(f.kernel, [{ ...READY, afterCents: 1000 }])
    expect(row.issued).toBe(false)
    expect(row.executed).toBe(false)
    expect(row.reason).toContain('没有出卡')
    expect(f.tables.action_runs).toHaveLength(0)
  })

  it('这周复查没有现成的加减金额时，不出卡，也不去准备执行', async () => {
    const open = vi.fn()
    const rows = await runTuesdayBudgetTune(open, emptySummary())
    expect(planTuesdayBudgetTunes(emptySummary())).toEqual([])
    expect(rows).toEqual([])
    expect(open).not.toHaveBeenCalled()
  })

  it('周二任务和这张卡的代码里没有改预算的入口', () => {
    const root = join(__dirname, '../../..')
    const tune = readFileSync(join(root, 'src/lib/diagnostic/tuesday-budget-tune.ts'), 'utf8')
    const route = readFileSync(join(root, 'src/app/api/cron/prescription-weekly/route.ts'), 'utf8')
    for (const src of [tune, route]) {
      expect(src).not.toContain('scale_unit_budget')
      expect(src).not.toContain('cut_unit_budget')
      expect(src).not.toContain('cut_campaign_budget')
      expect(src).not.toContain('getMetaToken')
      expect(src).not.toContain('ME_SERVICE_PAUSE')
      expect(src).not.toContain("@/lib/meta")
    }
    expect(tune).toContain('issueConfirmationCard')
    expect(route).toContain('runTuesdayBudgetTune')
  })
})

function expectDecision(f: ReturnType<typeof fixture>['f']): string {
  const run = f.tables.action_runs[0] as { authorization_decision_id?: string }
  return run.authorization_decision_id ?? ''
}

function actionKeys(f: ReturnType<typeof fixture>['f']): string[] {
  return (f.tables.action_runs as Array<{ action_key?: string }>).map((row) => row.action_key ?? '')
}

function cardText(f: ReturnType<typeof fixture>['f']): string {
  return JSON.stringify(f.tables.action_runs)
}

async function shownCard(f: ReturnType<typeof fixture>['f'], runId: string) {
  const { listConfirmationCards } = await import('@/lib/confirmation-card')
  const cards = await listConfirmationCards(f.kernel, CLIENT_A, OPC)
  const card = cards.find((row) => row.runId === runId)
  if (!card) throw new Error('确认卡没有列出来')
  return card
}
