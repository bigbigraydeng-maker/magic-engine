import { describe, expect, it } from 'vitest'
import { deriveChainStatus } from './derive'
import type { ChainFacts, ChainStep, PrescriptionFact } from './types'
import { SNAPSHOT_STALE_MS } from './types'

const NOW = '2026-10-26T12:00:00.000Z'
const FRESH = new Date(Date.parse(NOW) - 60 * 60 * 1000).toISOString()

function rx(over: Partial<PrescriptionFact> = {}): PrescriptionFact {
  return {
    status: 'draft',
    goalId: 'goal-1',
    approvedAt: null,
    errorMessage: null,
    intake: { businessGoal: '推北岛', monthlyBudget: 3700 },
    contentPresent: true,
    adPlayCount: 1,
    targetCosts: [11],
    reviewAnchor: '2026-10-01',
    ...over,
  }
}

function facts(over: Partial<ChainFacts> = {}): ChainFacts {
  return {
    nowIso: NOW,
    prescriptionId: 'rx-1',
    prescription: { read: 'ok', value: rx() },
    goal: {
      read: 'ok',
      value: {
        targetValue: 30,
        baselineValue: 0,
        currentValue: 10,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
      },
    },
    outcome: { read: 'ok', value: { configured: true, targetCostPerPrimary: 11 } },
    strategy: { read: 'ok', value: { dailyCapCents: 10000, pool: [] } },
    plans: { read: 'ok', value: [] },
    workOrders: { read: 'ok', value: [] },
    drafts: { read: 'ok', value: [] },
    snapshot: { read: 'ok', value: { capturedAt: FRESH } },
    ...over,
  }
}

function step(status: ReturnType<typeof deriveChainStatus>, id: ChainStep['id']): ChainStep {
  const found = status.steps.find((item) => item.id === id)
  if (!found) throw new Error(`missing ${id}`)
  return found
}

describe('deriveChainStatus', () => {
  it('marks a snapshot older than 12 hours and does not invent a fresh one', () => {
    const staleAt = new Date(Date.parse(NOW) - SNAPSHOT_STALE_MS - 1).toISOString()
    const status = deriveChainStatus(facts({ snapshot: { read: 'ok', value: { capturedAt: staleAt } } }))
    expect(status.snapshotStale).toBe(true)
    expect(step(status, 'inspect')).toMatchObject({
      state: 'blocked',
      stateLabel: '卡住',
      detail: '广告现状快照超过 12 小时没更新。',
    })
  })

  it('keeps a snapshot that is exactly 12 hours old', () => {
    const at = new Date(Date.parse(NOW) - SNAPSHOT_STALE_MS).toISOString()
    const status = deriveChainStatus(facts({ snapshot: { read: 'ok', value: { capturedAt: at } } }))
    expect(status.snapshotStale).toBe(false)
    expect(step(status, 'inspect').state).toBe('done')
  })

  it('says 读不到 when the snapshot read fails, and does not call it done', () => {
    const status = deriveChainStatus(facts({ snapshot: { read: 'unread' } }))
    expect(step(status, 'inspect')).toMatchObject({ state: 'unread', stateLabel: '读不到', detail: '读不到' })
    expect(status.snapshotStale).toBe(false)
  })

  it('says there is no snapshot when the read succeeded and the table was empty', () => {
    const status = deriveChainStatus(facts({ snapshot: { read: 'ok', value: null } }))
    expect(step(status, 'inspect').detail).toBe('还没有广告现状快照。')
  })

  it('stops measure when the two costs disagree and does not average them', () => {
    const status = deriveChainStatus(facts({
      prescription: { read: 'ok', value: rx({ targetCosts: [12] }) },
    }))
    const measure = step(status, 'measure')
    expect(measure.state).toBe('blocked')
    expect(measure.detail).toContain('不取平均')
    expect(measure.detail).toContain('11')
    expect(measure.detail).toContain('12')
    expect(measure.detail).not.toContain('11.5')
  })

  it('says 读不到 for measure when the cost row failed, even if the goal is present', () => {
    const status = deriveChainStatus(facts({ outcome: { read: 'unread' } }))
    expect(step(status, 'measure').state).toBe('unread')
  })

  it('blocks measure when the daily cap was read and is unset', () => {
    const status = deriveChainStatus(facts({
      strategy: { read: 'ok', value: { dailyCapCents: null, pool: [] } },
    }))
    expect(step(status, 'measure').detail).toBe('每天预算上限还没定。')
  })

  it('does not treat a missing current value as zero pace', () => {
    const status = deriveChainStatus(facts({
      goal: {
        read: 'ok',
        value: {
          targetValue: 30,
          baselineValue: 0,
          currentValue: null,
          periodStart: '2026-10-01',
          periodEnd: '2026-10-31',
        },
      },
    }))
    expect(step(status, 'measure').state).toBe('active')
    expect(step(status, 'measure').detail).toContain('归属数据不足')
  })

  it('marks confirm blocked when intake is missing the offer or the budget', () => {
    const status = deriveChainStatus(facts({
      prescription: { read: 'ok', value: rx({ intake: { businessGoal: '推北岛', monthlyBudget: null } }) },
    }))
    expect(step(status, 'confirm')).toMatchObject({ state: 'blocked', detail: '需求登记缺了推什么或花多少。' })
  })

  it('keeps consent waiting while the prescription is still being written', () => {
    const status = deriveChainStatus(facts({
      prescription: { read: 'ok', value: rx({ status: 'generating', contentPresent: false, adPlayCount: 0 }) },
    }))
    expect(step(status, 'prescribe')).toMatchObject({ state: 'active', detail: '正在开方。' })
    expect(step(status, 'consent').state).toBe('waiting')
    expect(step(status, 'consent').stateLabel).toBe('还没到')
  })

  it('hides database-shaped failure text', () => {
    const status = deriveChainStatus(facts({
      prescription: { read: 'ok', value: rx({ status: 'failed', errorMessage: 'relation "secret_tokens" does not exist' }) },
    }))
    expect(step(status, 'prescribe').detail).toBe('开方没有写成。')
  })

  it('waits for an internal consent click once the draft has plays', () => {
    const status = deriveChainStatus(facts())
    expect(step(status, 'prescribe').state).toBe('done')
    expect(step(status, 'consent')).toMatchObject({ state: 'active', detail: '等内部账号点同意。' })
    expect(step(status, 'plan')).toMatchObject({ state: 'active', detail: '还没有挂在这个目标上的推广计划。' })
  })

  it('does not attach another goal\'s plan', () => {
    const status = deriveChainStatus(facts({
      plans: {
        read: 'ok',
        value: [{
          id: 'plan-other',
          status: 'approved',
          createdAt: '2026-10-20T00:00:00.000Z',
          goalId: 'goal-other',
          adsStepCount: 1,
          creativeRefs: ['video-1'],
        }],
      },
    }))
    expect(step(status, 'plan').state).toBe('active')
    expect(step(status, 'plan').detail).not.toContain('已批准')
  })

  it('completes the plan step only for this goal\'s approved plan', () => {
    const status = deriveChainStatus(facts({
      plans: {
        read: 'ok',
        value: [{
          id: 'plan-1',
          status: 'approved',
          createdAt: '2026-10-20T00:00:00.000Z',
          goalId: 'goal-1',
          adsStepCount: 1,
          creativeRefs: ['video-1'],
        }],
      },
      strategy: {
        read: 'ok',
        value: {
          dailyCapCents: 10000,
          pool: [{ ref: 'video-1', status: 'approved', aliasRefs: [], promoWindow: { kind: 'evergreen' } }],
        },
      },
    }))
    expect(step(status, 'plan').state).toBe('done')
    expect(step(status, 'creative').state).toBe('done')
  })

  it('does not call an empty pool done when the pool column could not be read', () => {
    const status = deriveChainStatus(facts({
      plans: {
        read: 'ok',
        value: [{
          id: 'plan-1',
          status: 'approved',
          createdAt: '2026-10-20T00:00:00.000Z',
          goalId: 'goal-1',
          adsStepCount: 1,
          creativeRefs: ['video-1'],
        }],
      },
      strategy: { read: 'ok', value: { dailyCapCents: 10000, pool: null } },
    }))
    expect(step(status, 'creative')).toMatchObject({ state: 'unread', detail: '读不到' })
  })

  it('blocks creatives that have sat in review for more than 24 hours', () => {
    const status = deriveChainStatus(facts({
      workOrders: { read: 'ok', value: [{ status: 'in_review', updatedAt: '2026-10-25T11:00:00.000Z' }] },
    }))
    expect(step(status, 'creative').detail).toBe('有素材停在待审超过 24 小时。')
  })

  it('does not invent a review age when the timestamp is missing', () => {
    const status = deriveChainStatus(facts({
      workOrders: { read: 'ok', value: [{ status: 'in_review', updatedAt: null }] },
    }))
    expect(step(status, 'creative').state).toBe('active')
    expect(step(status, 'creative').detail).toContain('看不出等了多久')
  })

  it('shows a queued draft as waiting for the launch click', () => {
    const status = deriveChainStatus(facts({
      drafts: { read: 'ok', value: [{ status: 'awaiting_approval' }] },
    }))
    expect(step(status, 'draft').state).toBe('done')
    expect(step(status, 'launch')).toMatchObject({ state: 'active', detail: '等点开投。' })
  })

  it('marks launch done only from a linked active draft', () => {
    const status = deriveChainStatus(facts({
      drafts: { read: 'ok', value: [{ status: 'active' }] },
    }))
    expect(step(status, 'launch')).toMatchObject({ state: 'done', detail: '已经开投。' })
  })

  it('says 读不到 for draft and launch when the draft read failed', () => {
    const status = deriveChainStatus(facts({ drafts: { read: 'unread' } }))
    expect(step(status, 'draft').state).toBe('unread')
    expect(step(status, 'launch').state).toBe('unread')
  })

  it('keeps nine labels in order', () => {
    const status = deriveChainStatus(facts())
    expect(status.steps.map((item) => item.label)).toEqual(['看', '量', '确认', '开方', '同意', '计划', '素材', '草稿', '开投'])
  })
})
