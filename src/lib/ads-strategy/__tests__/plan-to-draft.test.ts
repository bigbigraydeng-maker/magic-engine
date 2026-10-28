import { describe, expect, it } from 'vitest'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { parsePromoSpec } from '@/lib/marketing-plan/promo/spec'
import type { AdDraft } from '../ad-draft'
import { draftNotYetBuildable, reviewDraftForBuild } from '../ad-draft-expansion'
import type { CreativePoolEntry } from '../config'
import { afterAssetPooled, assemblePausedDraftsForClient, emptyAssemblyState, type AssemblyDeps, type AssemblyPlan } from '../plan-to-draft'
import { promotionDedupeKey } from '@/lib/factory/promotion-signal'
import { EXPANSION_SOURCE, promotionWorkOrderIds } from '../plan-to-draft-rules'
import type { AdPlay } from '../plan-seed/ad-plays'

const ACCOUNT = 'act_1111111111'
const NOW = new Date('2026-11-01T12:00:00Z')

function promo(over: { creativeRefs?: string[]; leadFormId?: string } = {}) {
  return {
    schema: 'promo_v1',
    goal_id: 'goal-1',
    phases: [{
      id: 'phase-1',
      name: '推广',
      start_date: '2026-11-01',
      end_date: '2026-11-07',
      steps: [{
        id: 'step-1',
        kind: 'ads_campaign' as const,
        settings: {
          ad_account_id: ACCOUNT,
          daily_budget_cents: 1500,
          audience_ref: '',
          creative_refs: over.creativeRefs ?? ['creative-a'],
          placements: [],
          paused_ranges: [],
          ...(over.leadFormId ? { lead_form_id: over.leadFormId } : {}),
          targeting: { countries: ['NZ'], city_keys: [], excluded_audience_refs: [] },
        },
      }],
    }],
  }
}

function poolEntry(): CreativePoolEntry {
  return {
    kind: 'work_order',
    ref: 'creative-a',
    status: 'approved',
    promo_window: { kind: 'evergreen' },
    alias_refs: ['88888'],
  }
}

function plan(over: Partial<AssemblyPlan> = {}): AssemblyPlan {
  return {
    id: 'plan-1',
    clientId: 'client-1',
    title: 'Spring push',
    promo: promo(),
    prescriptionId: 'rx-1',
    state: emptyAssemblyState(),
    ...over,
  }
}

function world(patch: Partial<AssemblyDeps> = {}) {
  const plans = [plan()]
  const drafts: AdDraft[] = []
  const cards = new Map<string, string>()
  let copyCalls = 0
  const deps: AssemblyDeps = {
    now: () => NOW,
    loadPlans: async () => plans,
    loadPlays: async () => [{ step_key: 'step-1', play: 'lead_form_harvest' } satisfies AdPlay],
    accounts: async () => ({
      clientAccountId: ACCOUNT,
      spendAccountId: ACCOUNT,
      pageId: 'page-1',
      unreadable: false,
    }),
    pool: async () => [poolEntry()],
    promotionWorkOrders: async () => ({ unreadable: false, ids: [] }),
    forms: async () => ({ ok: true, forms: [{ id: '55555', name: 'Enquiry', active: true }] }),
    cover: async () => 'https://cdn.example/cover.jpg',
    linkUrl: async () => null,
    brandText: async () => 'A local studio with a clear offer.',
    copy: async () => {
      copyCalls += 1
      return { ok: true, primaryText: 'See the range', headline: 'Book a visit' }
    },
    reviewContext: async () => ({
      accountLabel: 'Ad account',
      review: {
        adAccountId: ACCOUNT,
        accounts: [{ ad_account_id: ACCOUNT, currency: 'NZD', daily_cap_cents: 5000, owned_by_client: true }],
        clientCapCents: 8000,
      },
    }),
    issue: async ({ draft }) => {
      const hash = canonicalHashOfInput(draft)
      const existing = cards.get(hash)
      if (existing) return { runId: existing }
      const runId = `run-${cards.size + 1}`
      cards.set(hash, runId)
      drafts.push(draft)
      return { runId }
    },
    save: async (saved, state) => {
      const hit = plans.find((row) => row.id === saved.id)
      if (hit) hit.state = state
    },
    ...patch,
  }
  return { deps, drafts, cards, plans, copyCalls: () => copyCalls }
}

describe('plan step to paused-draft card', () => {
  it('happy path issues one card and writes expansion on', async () => {
    const harness = world()
    const result = await assemblePausedDraftsForClient('client-1', harness.deps)
    expect(result.steps).toEqual([{ planId: 'plan-1', stepId: 'step-1', status: 'issued', runId: 'run-1' }])
    expect(harness.cards.size).toBe(1)
    const draft = harness.drafts[0]
    expect(draft?.expansion).toEqual({
      advantageAudience: true,
      customAudienceRelaxed: false,
      lookalikeRelaxed: false,
      source: EXPANSION_SOURCE,
    })
    expect(draft?.leadFormId).toBe('55555')
    expect(draft?.creatives[0]?.videoId).toBe('88888')
    expect(reviewDraftForBuild(draft as AdDraft)).toEqual([])
    expect(draftNotYetBuildable(draft as AdDraft)).toBeNull()
  })

  it('re-run reuses the same copy and does not issue a second card', async () => {
    const harness = world()
    await assemblePausedDraftsForClient('client-1', harness.deps)
    const again = await assemblePausedDraftsForClient('client-1', harness.deps)
    expect(again.steps[0]?.status).toBe('issued')
    expect(again.steps[0]?.runId).toBe('run-1')
    expect(harness.cards.size).toBe(1)
    expect(harness.drafts).toHaveLength(1)
    expect(harness.copyCalls()).toBe(1)
  })

  it('missing creative blocks with a reason', async () => {
    const harness = world({ pool: async () => [] })
    const result = await assemblePausedDraftsForClient('client-1', harness.deps)
    expect(result.steps[0]?.status).toBe('blocked')
    expect(result.steps[0]?.reason).toContain('素材还没准备好')
    expect(harness.cards.size).toBe(0)
  })

  it('missing copy blocks with a reason', async () => {
    const harness = world({
      copy: async () => ({ ok: false, reason: '广告文案没有写出来。' }),
    })
    const result = await assemblePausedDraftsForClient('client-1', harness.deps)
    expect(result.steps[0]?.status).toBe('blocked')
    expect(result.steps[0]?.reason).toContain('广告文案没有写出来')
    expect(harness.cards.size).toBe(0)
  })

  it('missing form blocks with a reason', async () => {
    const harness = world({ forms: async () => ({ ok: true, forms: [] }) })
    const result = await assemblePausedDraftsForClient('client-1', harness.deps)
    expect(result.steps[0]?.status).toBe('blocked')
    expect(result.steps[0]?.reason).toContain('需要选定一个已经存在的表单')
    expect(harness.cards.size).toBe(0)
  })

  it('ambiguous active forms block until one is named', async () => {
    const harness = world({
      forms: async () => ({
        ok: true,
        forms: [
          { id: '55555', name: 'Enquiry', active: true },
          { id: '66666', name: 'Visit', active: true },
        ],
      }),
    })
    const result = await assemblePausedDraftsForClient('client-1', harness.deps)
    expect(result.steps[0]?.status).toBe('blocked')
    expect(result.steps[0]?.reason).toContain('需要选定一个已经存在的表单')
    expect(harness.cards.size).toBe(0)
  })

  it('account mismatch blocks and does not guess', async () => {
    const harness = world({
      accounts: async () => ({
        clientAccountId: 'act_2222222222',
        spendAccountId: ACCOUNT,
        pageId: 'page-1',
        unreadable: false,
      }),
    })
    const result = await assemblePausedDraftsForClient('client-1', harness.deps)
    expect(result.steps[0]?.status).toBe('blocked')
    expect(result.steps[0]?.reason).toContain('不一致')
    expect(harness.cards.size).toBe(0)
  })

  it('a new optional form field is absent from plans that do not set it', () => {
    const parsed = parsePromoSpec(promo())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const step = parsed.spec.phases[0]?.steps[0]
    expect(step?.kind).toBe('ads_campaign')
    if (step?.kind !== 'ads_campaign') return
    expect('lead_form_id' in step.settings).toBe(false)
    expect('lead_form_name' in step.settings).toBe(false)
  })

  it('plan, then signal, then work order, then admitted asset, then one card', async () => {
    const prescriptionId = '22222222-2222-4222-8222-222222222222'
    const signal = {
      id: 'sig-1',
      clientId: 'client-1',
      source: 'prescription-approved',
      dedupeKey: promotionDedupeKey(prescriptionId),
      workOrderId: 'wo-1',
    }
    const order = { id: 'wo-1', clientId: 'client-1', signalId: 'sig-1' }
    const ids = promotionWorkOrderIds({
      clientId: 'client-1',
      prescriptionId,
      signals: [signal],
      orders: [order],
    })
    expect(ids).toEqual(['wo-1'])
    const admitted: CreativePoolEntry = {
      kind: 'work_order',
      ref: 'wo-1',
      status: 'approved',
      alias_refs: ['88888'],
    }
    expect(admitted.promo_window).toBeUndefined()
    const harness = world({
      loadPlans: async () => [plan({ prescriptionId, promo: promo({ creativeRefs: [] }) })],
      pool: async () => [admitted],
      promotionWorkOrders: async () => ({ unreadable: false, ids }),
    })
    const result = await assemblePausedDraftsForClient('client-1', harness.deps)
    expect(result.steps).toEqual([{ planId: 'plan-1', stepId: 'step-1', status: 'issued', runId: 'run-1' }])
    expect(harness.drafts[0]?.creatives[0]?.videoId).toBe('88888')
    expect(admitted.promo_window).toBeUndefined()
  })

  it('an admitted asset with no promotion link and no window still blocks', async () => {
    const prescriptionId = '22222222-2222-4222-8222-222222222222'
    const ids = promotionWorkOrderIds({
      clientId: 'client-1',
      prescriptionId,
      signals: [{
        id: 'sig-9',
        clientId: 'client-1',
        source: 'manual',
        dedupeKey: promotionDedupeKey(prescriptionId),
        workOrderId: 'wo-9',
      }],
      orders: [{ id: 'wo-9', clientId: 'client-1', signalId: 'sig-9' }],
    })
    expect(ids).toEqual([])
    const harness = world({
      loadPlans: async () => [plan({
        prescriptionId,
        promo: promo({ creativeRefs: ['wo-9'] }),
      })],
      pool: async () => [{ kind: 'work_order', ref: 'wo-9', status: 'approved', alias_refs: ['88888'] }],
      promotionWorkOrders: async () => ({ unreadable: false, ids }),
    })
    const result = await assemblePausedDraftsForClient('client-1', harness.deps)
    expect(result.steps[0]?.status).toBe('blocked')
    expect(result.steps[0]?.reason).toContain('没有声明推广期')
    expect(harness.cards.size).toBe(0)
  })

  it('does not assemble when a creative was not admitted', async () => {
    let calls = 0
    await afterAssetPooled(false, 'client-1', async () => { calls += 1 })
    expect(calls).toBe(0)
    await afterAssetPooled(true, 'client-1', async () => { calls += 1 })
    expect(calls).toBe(1)
  })
})
