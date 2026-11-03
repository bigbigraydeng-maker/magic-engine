import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StageEvent } from '../outcome'
import type { StoredReview } from '../types'

const DAY = 86_400_000
const NOW = new Date('2026-11-04T21:00:00Z')
const JUDGE = 'ai:conversation-read'

const load = vi.hoisted(() => ({
  config: { enabled: true, stageCategories: {} as Record<string, string>, humanWriterPrefixes: [] as string[] },
  events: [] as StageEvent[],
  rewritten: false,
  past: [] as StoredReview[],
}))

vi.mock('../load', () => ({
  loadClientConfig: async () => load.config,
  loadStageOptions: async () =>
    Object.entries(load.config.stageCategories).map(([key, category]) => ({ key, label: key, category })),
  loadStageEvents: async () => load.events,
  loadSentMails: async () => [],
  resolveMailIngestedAt: () => null,
  hasRewrittenTouchpoints: async () => load.rewritten,
  loadPastReviews: async () => load.past,
  loadRulings: async () => new Map(),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import { WEEKLY_CAP, WEEKLY_COST_CAP_USD, buildRunSummary, isGloballyEnabled, isoWeekKey, planReviews, runClient, type BaozhengDeps } from '../run'

const CATS = {
  new: 'untouched', contacted: 'engaged', quoted: 'deep', deposit_paid: 'won',
  no_response: 'no_reply', deferred: 'declined', not_enquiry: 'not_lead',
}

let seq = 0
function ev(p: Partial<StageEvent> & { toStage: string; daysAgo: number }): StageEvent {
  seq += 1
  return {
    id: p.id ?? `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
    contactId: p.contactId ?? `c${seq}`,
    fromStage: p.fromStage ?? null,
    toStage: p.toStage,
    changedBy: p.changedBy ?? JUDGE,
    note: p.note === undefined ? '读往来记录判的：x｜原话：「hello there friend」' : p.note,
    createdAt: new Date(NOW.getTime() - p.daysAgo * DAY).toISOString(),
  }
}

function deps(reply: (n: number) => { text: string; cost_usd: number }): BaozhengDeps & { calls: number } {
  const d = {
    calls: 0,
    db: {} as BaozhengDeps['db'],
    llm: async () => reply(d.calls++),
    loadTranscript: async () => [{ at: NOW.toISOString(), direction: 'inbound' as const, body: 'Can you send me the price for May?', channel: 'email' }],
    now: () => NOW,
  }
  return d
}

beforeEach(() => {
  load.config = { enabled: true, stageCategories: { ...CATS }, humanWriterPrefixes: [] }
  load.events = []
  load.rewritten = false
  load.past = []
})

describe('switches and week key', () => {
  it('global switch is on only for the exact string true', () => {
    expect(isGloballyEnabled({ BAOZHENG_ENABLED: 'true' })).toBe(true)
    expect(isGloballyEnabled({ BAOZHENG_ENABLED: '1' })).toBe(false)
    expect(isGloballyEnabled({})).toBe(false)
  })

  it('ISO week key', () => {
    expect(isoWeekKey(new Date('2026-11-04T21:00:00Z'))).toBe('2026-W45')
    expect(isoWeekKey(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53')
  })
})

describe('planReviews (BZ-15 / BZ-16)', () => {
  it('samples last week only, adds disagreements once, and pool only from quote-less writes into the pool stage', () => {
    const lastWeek = Array.from({ length: 25 }, () => ev({ toStage: 'contacted', daysAgo: 2 }))
    const old = ev({ toStage: 'quoted', daysAgo: 20 })
    const pool = [ev({ toStage: 'new', daysAgo: 1, note: '读往来记录判的：他还没跟我们说过话' })]
    const rule = [ev({ toStage: 'no_response', daysAgo: 1, note: '读往来记录判的：两周没回' })]
    const events = [...lastWeek, old, ...pool, ...rule]
    const judgments = [...lastWeek, old]
    const firstSampled = lastWeek[0] as StageEvent
    const plan = planReviews(events, judgments, [old, firstSampled], 'c:2026-W45', NOW.getTime() - 7 * DAY, NOW.getTime())
    const kinds = plan.tasks.map((t) => t.kind)
    expect(kinds.filter((k) => k === 'sample')).toHaveLength(WEEKLY_CAP)
    expect(plan.tasks.filter((t) => t.kind === 'disagreement').map((t) => t.event.id)).toContain(old.id)
    expect(plan.tasks.filter((t) => t.event.id === firstSampled.id).length).toBeLessThanOrEqual(1)
    expect(plan.tasks.filter((t) => t.kind === 'pool').map((t) => t.event.toStage)).toEqual(['new'])
    expect(plan.poolWrites).toBe(2)
  })
})

describe('runClient', () => {
  it('disabled client → disabled, no model call', async () => {
    load.config = { ...load.config, enabled: false }
    const d = deps(() => ({ text: '{}', cost_usd: 0 }))
    const r = await runClient(d, 'client-1', '2026-W45')
    expect(r.status).toBe('disabled')
    expect(d.calls).toBe(0)
  })

  it('reviews last week, compares by category, and counts history outcomes', async () => {
    load.events = [
      ev({ id: '00000000-0000-0000-0000-00000000000a', toStage: 'contacted', daysAgo: 1 }),
      ev({ id: '00000000-0000-0000-0000-00000000000b', toStage: 'quoted', daysAgo: 2 }),
      ev({ toStage: 'contacted', daysAgo: 60, contactId: 'old' }),
      ev({ toStage: 'not_enquiry', daysAgo: 59, contactId: 'old', changedBy: 'human:pm@x.com', note: '测试账号' }),
    ]
    // contacted judgment: reviewer says quoted (different category); quoted judgment: reviewer agrees
    const d = deps((n) => ({ text: n === 0 ? '{"stage":"quoted","reason":"发过报价"}' : '{"stage":"quoted","reason":"发过报价"}', cost_usd: 0.01 }))
    const r = await runClient(d, 'client-1', '2026-W45')
    expect(r.status).toBe('reviewed')
    expect(r.outcomes?.wrong).toBe(1)
    const results = Object.fromEntries(r.reviews.map((x) => [x.ai_stage, x.result]))
    expect(results).toEqual({ contacted: 'disagree', quoted: 'agree' })
    expect(r.cost_usd).toBeCloseTo(0.02)
    expect(r.accuracy.map((a) => a.stage).sort()).toEqual(['contacted', 'quoted'])
  })

  it('rewritten source → not_reviewed without calling the model (BZ-17)', async () => {
    load.events = [ev({ toStage: 'contacted', daysAgo: 1 })]
    load.rewritten = true
    const d = deps(() => ({ text: '{"stage":"quoted","reason":"x"}', cost_usd: 0.01 }))
    const r = await runClient(d, 'client-1', '2026-W45')
    expect(d.calls).toBe(0)
    expect(r.reviews[0]).toMatchObject({ result: 'not_reviewed', reason: '原文可能被改过' })
  })

  it('reviewer failure is recorded, not thrown; cost cap stops further calls', async () => {
    load.events = [ev({ toStage: 'contacted', daysAgo: 1 }), ev({ toStage: 'contacted', daysAgo: 1 }), ev({ toStage: 'contacted', daysAgo: 1 })]
    const d = deps((n) => {
      if (n === 0) return { text: '{"stage":"engaged??","reason":"x"}', cost_usd: WEEKLY_COST_CAP_USD }
      return { text: '{"stage":"contacted","reason":"x"}', cost_usd: 0.01 }
    })
    const r = await runClient(d, 'client-1', '2026-W45')
    expect(d.calls).toBe(1)
    expect(r.reviews.map((x) => x.result)).toEqual(['not_reviewed', 'not_reviewed', 'not_reviewed'])
    expect(r.reviews.filter((x) => x.reason === '本周复核花费到上限')).toHaveLength(2)
  })

  it('pool review flags only suspected misses (deep / won) as disagree', async () => {
    load.events = [
      ev({ toStage: 'new', daysAgo: 1, note: '读往来记录判的：他还没跟我们说过话' }),
      ev({ toStage: 'new', daysAgo: 1, note: '读往来记录判的：他还没跟我们说过话' }),
    ]
    const d = deps((n) => ({ text: n === 0 ? '{"stage":"contacted","reason":"x"}' : '{"stage":"deposit_paid","reason":"x"}', cost_usd: 0 }))
    const r = await runClient(d, 'client-1', '2026-W45')
    expect(r.reviews.map((x) => x.result).sort()).toEqual(['agree', 'disagree'])
    expect(r.suspected_missed).toBe(1)
    expect(r.accuracy).toEqual([])
  })
})

describe('buildRunSummary', () => {
  it('carries the five keys and never publishes', () => {
    const s = buildRunSummary('2026-W45', [], ['总开关没开'])
    expect(s).toMatchObject({ agent: 'baozheng', produced: 0, undeterminable: 0, reasons: ['总开关没开'], cost_usd: 0, no_publish: true })
  })
})
