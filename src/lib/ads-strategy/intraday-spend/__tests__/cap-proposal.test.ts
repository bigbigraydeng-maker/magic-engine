import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyCapDecision,
  decreaseWithinStep,
  judgeIntradayCap,
  type CapFacts,
  type CapPorts,
  type CardPlan,
  type LiveBudget,
} from '../cap-proposal'
const NOW = new Date('2026-11-09T01:00:00.000Z')
function budget(dailyMinor: number): LiveBudget {
  return {
    level: 'adset', id: '123456', campaignId: '234567', accountId: 'act_111111',
    name: '合成组', dailyMinor, active: true,
  }
}
function ready(patch: Partial<CapFacts> = {}): CapFacts {
  return {
    now: NOW,
    nzDay: '2026-11-09',
    planCount: 1,
    capCents: 1000,
    sample: {
      readable: true,
      latestAt: NOW.toISOString(),
      accountDay: '2026-11-09',
      spendMinor: 400,
      forecastMinor: 1600,
    },
    snapshot: {
      readable: true,
      capturedAt: NOW.toISOString(),
      complete: true,
      error: null,
      budgets: [budget(2000)],
    },
    ...patch,
  }
}
function memory(): CapPorts & { issued: CardPlan[]; todos: string[] } {
  const issued: CardPlan[] = []
  const todos: string[] = []
  const open = new Set<string>()
  return {
    issued,
    todos,
    open: async (day) => open.has(day),
    issue: async (plan) => { open.add(plan.day); issued.push(plan); return true },
    todo: async (code) => { todos.push(code); return true },
  }
}
describe('intraday cap proposal', () => {
  it('issues one decrease card when the close is over the cap', async () => {
    const ports = memory()
    const decision = judgeIntradayCap(ready())
    expect(decision.kind).toBe('card')
    if (decision.kind !== 'card') return
    expect(decision.action).toBe('decrease')
    expect(decision.afterMinor).toBeLessThan(decision.beforeMinor ?? 0)
    expect(decision.afterMinor).toBeGreaterThan(0)
    const first = await applyCapDecision(decision, ports)
    const second = await applyCapDecision(decision, ports)
    expect(first).toMatchObject({ cards: 1, todos: 0, action: 'decrease' })
    expect(second.action).toBe('deduped')
    expect(ports.issued).toHaveLength(1)
    expect(ports.todos).toHaveLength(0)
  })
  it('issues nothing when the close stays under the cap', async () => {
    const ports = memory()
    const decision = judgeIntradayCap(ready({
      sample: {
        readable: true, latestAt: NOW.toISOString(), accountDay: '2026-11-09',
        spendMinor: 200, forecastMinor: 800,
      },
    }))
    const receipt = await applyCapDecision(decision, ports)
    expect(receipt).toEqual({ cards: 0, todos: 0, action: 'none' })
    expect(ports.issued).toHaveLength(0)
  })
  it('does not card when the snapshot is stale, and writes a todo', async () => {
    const ports = memory()
    const stale = new Date(NOW.getTime() - 13 * 60 * 60 * 1000).toISOString()
    const decision = judgeIntradayCap(ready({
      snapshot: {
        readable: true, capturedAt: stale, complete: true, error: null, budgets: [budget(2000)],
      },
    }))
    const receipt = await applyCapDecision(decision, ports)
    expect(receipt.cards).toBe(0)
    expect(receipt.todos).toBe(1)
    expect(receipt.action).toBe('stale_snapshot')
    expect(ports.issued).toHaveLength(0)
  })
  it('does not card when samples or the plan are missing', async () => {
    const missing = memory()
    const noSamples = await applyCapDecision(judgeIntradayCap(ready({
      sample: {
        readable: true, latestAt: null, accountDay: '2026-11-09',
        spendMinor: null, forecastMinor: null,
      },
    })), missing)
    expect(noSamples).toMatchObject({ cards: 0, todos: 1, action: 'no_samples' })
    const noPlan = memory()
    const plan = await applyCapDecision(judgeIntradayCap(ready({ planCount: 0, capCents: null })), noPlan)
    expect(plan).toMatchObject({ cards: 0, todos: 1, action: 'no_plan' })
    const noCap = memory()
    const cap = await applyCapDecision(judgeIntradayCap(ready({ capCents: null })), noCap)
    expect(cap.action).toBe('no_cap')
    expect(missing.issued).toHaveLength(0)
    expect(noPlan.issued).toHaveLength(0)
  })
  it('pauses only after spend has already passed the cap, and never raises', () => {
    const pause = judgeIntradayCap(ready({
      sample: {
        readable: true, latestAt: NOW.toISOString(), accountDay: '2026-11-09',
        spendMinor: 1200, forecastMinor: 1800,
      },
    }))
    expect(pause.kind).toBe('card')
    if (pause.kind === 'card') expect(pause.action).toBe('pause')
    const keep = judgeIntradayCap(ready({
      snapshot: {
        readable: true, capturedAt: NOW.toISOString(), complete: true, error: null,
        budgets: [budget(100)],
      },
    }))
    expect(keep.kind).toBe('card')
    if (keep.kind === 'card') {
      expect(keep.action).toBe('keep')
      expect(keep.afterMinor).toBeNull()
    }
    expect(decreaseWithinStep(2000, 2500)).toBe(false)
    expect(decreaseWithinStep(2000, 1800)).toBe(true)
  })
  it('does not call Meta from the proposal files', () => {
    const dir = path.join(__dirname, '..')
    const src = readFileSync(path.join(dir, 'cap-proposal.ts'), 'utf8')
      + readFileSync(path.join(dir, 'cap-proposal-run.ts'), 'utf8')
    expect(src).not.toContain('graph.facebook.com')
    expect(src).not.toContain('setCampaignStatus')
    expect(src).not.toContain('getMetaTokenForClient')
  })
})
