import { describe, expect, it, vi } from 'vitest'
import { createCapabilities } from '@/lib/capabilities'
import { bindLaunchToApprovedPlan } from '@/lib/ads-launch/plan-gate'
import { ADD_CREATIVE_WHAT, pausedDraftClickUrl } from '@/lib/ads-strategy/paused-draft-copy'
import type { CardClicker } from '@/lib/confirmation-card/actor'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { CLIENT_A, makeFixture } from '@/lib/kernel/__tests__/fixtures'
import { confirmCreativeCard, issueCreativeCard, type CreativeMeta } from '../flow'
import type { LiveFacts } from '../guard'
import type { CreativeHold } from '../ledger'
import { copyFromAds, parseCreativeRequest, storyFor, type CopiedStory, type CreativeOrder } from '../order'

const OPC: CardClicker = { kind: 'opc', email: 'opc@example.com' }
const NOW = '2026-11-14T00:00:00.000Z'
const AT = '2026-11-13T20:00:00.000Z'
const COPY: CopiedStory = { sourceAdId: 'ad1', pageId: 'pg1', link: 'https://example.com/go', leadFormId: null }

function order(status: CreativeOrder['status'] = 'PAUSED'): CreativeOrder {
  return {
    adAccountId: 'act_111111',
    adSetId: '111',
    imagePath: `renders/${CLIENT_A}/wo/poster.jpg`,
    primaryText: 'See the spring departure',
    headline: 'Spring tour',
    ctaType: 'LEARN_MORE',
    adName: 'Spring image',
    status,
  }
}

function live(over: Partial<LiveFacts> = {}): LiveFacts {
  return { accountKnown: true, adSetStatus: 'ACTIVE', copy: COPY, ...over }
}

function fixture(on = true) {
  const base = { client_id: CLIENT_A, ad_account_id: 'act_111111', captured_at: AT, complete: true, error: null, skipped_shared: false }
  return makeFixture({
    registry: ACTION_REGISTRY,
    capabilities: (sb) => createCapabilities(sb),
    startAt: NOW,
    options: {
      extraTables: {
        clients: [{ id: CLIENT_A, leads_config: { add_creative_card: on } }],
        marketing_plans: [{
          id: 'plan-1',
          client_id: CLIENT_A,
          status: 'approved',
          plan_data: { promo: { daily_total_cap_cents: 2000 } },
        }],
        client_meta_ad_accounts: [{ client_id: CLIENT_A, ad_account_id: 'act_111111' }],
        ad_snapshot_captures: [{ ...base, level: 'campaign' }, { ...base, level: 'adset' }],
        ad_entity_snapshots: [],
      },
    },
  })
}

function metaMock(creativeOk = true) {
  const calls: string[] = []
  const stories: Record<string, unknown>[] = []
  const ads: Array<{ status?: string; dailyBudget?: unknown }> = []
  let opened = 0
  const client: CreativeMeta = {
    uploadImage: async () => { calls.push('image'); return { ok: true, id: 'hash1' } },
    createCreative: async (input) => {
      calls.push('creative')
      stories.push(input.story)
      return creativeOk ? { ok: true, id: 'cr1' } : { ok: false, error: 'rejected' }
    },
    createAd: async (input) => {
      calls.push('ad')
      ads.push(input)
      return { ok: true, id: 'ad9' }
    },
  }
  return { calls, stories, ads, client, opened: () => opened, open: () => { opened += 1; return client } }
}

async function ready(status: CreativeOrder['status'] = 'PAUSED', creativeOk = true) {
  const f = fixture()
  const meta = metaMock(creativeOk)
  const seen = { live: live() }
  const deps = {
    switchState: async () => ((f.tables.clients[0] as { leads_config: { add_creative_card?: boolean } }).leads_config.add_creative_card === true ? 'on' as const : 'off' as const),
    inspect: async () => ({
      plan: await bindLaunchToApprovedPlan(f.supabase, CLIENT_A, { mode: 'ad_only' }, f.clock.now),
      live: seen.live,
      imageUrl: 'https://cdn.example/poster.jpg',
    }),
    meta: async () => meta.open(),
  }
  const issued = await issueCreativeCard({ kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order: order(status), deps })
  if (!issued.card) throw new Error(issued.reason ?? 'no card')
  return { f, meta, seen, deps, issued }
}

function confirmArgs(box: Awaited<ReturnType<typeof ready>>) {
  return {
    kernel: box.f.kernel,
    clientId: CLIENT_A,
    runId: box.issued.card?.runId ?? '',
    clicker: OPC,
    resolution: 'confirm' as const,
    expectedDecisionId: box.issued.card?.expectedDecisionId ?? '',
    fingerprint: box.issued.card?.fingerprint ?? '',
    deps: box.deps,
  }
}

describe('add creative card', () => {
  it('creates image, creative, then a paused ad and does not touch budget', async () => {
    const box = await ready()
    expect(box.meta.opened()).toBe(0)
    const done = await confirmCreativeCard(confirmArgs(box))
    expect(done.status).toBe('executed')
    expect(box.meta.calls).toEqual(['image', 'creative', 'ad'])
    expect(box.meta.ads[0]).toMatchObject({ status: 'PAUSED', adSetId: '111' })
    expect(box.meta.ads[0]).not.toHaveProperty('dailyBudget')
    expect(box.meta.stories[0]).toMatchObject({
      page_id: 'pg1',
      link_data: { link: 'https://example.com/go', image_hash: 'hash1', call_to_action: { type: 'LEARN_MORE' } },
    })
    const row = box.f.tables.flywheel_actions[0]
    expect(row?.action_type).toBe('ads.add_ad_creative')
    expect(row?.payload).toMatchObject({ status: 'executed', adId: 'ad9', wrote: true, planId: 'plan-1' })
    expect(pausedDraftClickUrl(CLIENT_A, 'run-1', ADD_CREATIVE_WHAT)).toContain('/add-creative-card/run-1')
  })

  it('keeps ACTIVE only when the card says so', async () => {
    const box = await ready('ACTIVE')
    await confirmCreativeCard(confirmArgs(box))
    expect(box.meta.ads[0]?.status).toBe('ACTIVE')
    const body: Record<string, unknown> = { ...order() }
    delete body.status
    expect(parseCreativeRequest(body, CLIENT_A).status).toBe('PAUSED')
    expect(parseCreativeRequest({ ...order(), status: 'ACTIVE' }, CLIENT_A).status).toBe('ACTIVE')
    expect(() => parseCreativeRequest({ ...order(), dailyBudget: 1 }, CLIENT_A)).toThrow(ConfirmationCardError)
  })

  it('refuses a missing plan, a stale account, an inactive ad set, and a switch that is off', async () => {
    for (const name of ['plan', 'stale', 'inactive', 'switch'] as const) {
      const box = await ready()
      if (name === 'plan') box.f.tables.marketing_plans.length = 0
      if (name === 'stale') {
        for (const row of box.f.tables.ad_snapshot_captures) row.captured_at = '2026-11-01T00:00:00.000Z'
      }
      if (name === 'inactive') box.seen.live = live({ adSetStatus: 'PAUSED' })
      if (name === 'switch') {
        (box.f.tables.clients[0] as { leads_config: { add_creative_card: boolean } }).leads_config.add_creative_card = false
      }
      const done = await confirmCreativeCard(confirmArgs(box))
      expect(done.wrote, name).toBe(false)
      expect(done.status, name).toBe('blocked')
      expect(box.meta.calls, name).toEqual([])
      expect(box.meta.opened(), name).toBe(0)
    }
  })

  it('refuses an expired card without calling Meta', async () => {
    const box = await ready()
    box.f.clock.now = new Date(Date.parse(NOW) + 30 * 60 * 1000)
    const done = await confirmCreativeCard(confirmArgs(box))
    expect(done.wrote).toBe(false)
    expect(done.card?.status).toBe('expired')
    expect(box.meta.calls).toEqual([])
    expect(box.meta.opened()).toBe(0)
  })

  it('reports a creative failure after the image upload and does not retry', async () => {
    const box = await ready('PAUSED', false)
    const done = await confirmCreativeCard(confirmArgs(box))
    expect(done.status).toBe('failed')
    expect(done.wrote).toBe(true)
    expect(done.reason).toContain('没有自动再试')
    expect(box.meta.calls).toEqual(['image', 'creative'])
    const again = await confirmCreativeCard(confirmArgs(box))
    expect(again.status).toBe('failed')
    expect(again.wrote).toBe(true)
    expect(again.reason).toBe(done.reason)
    expect(box.meta.calls).toEqual(['image', 'creative'])
    const payload = box.f.tables.flywheel_actions[0]?.payload as CreativeHold
    expect(payload).toMatchObject({ status: 'failed', imageHash: 'hash1', creativeId: null, adId: null })
  })

  it('copies a lead form instead of asking for one', () => {
    const copy = copyFromAds([{
      id: 'ad1',
      creative: {
        object_story_spec: {
          page_id: 'pg1',
          link_data: { link: 'https://example.com/go', call_to_action: { type: 'SIGN_UP', value: { lead_gen_form_id: 'form1' } } },
        },
      },
    }])
    expect(copy).toMatchObject({ leadFormId: 'form1', link: null })
    expect(storyFor(order(), copy as CopiedStory, 'hash1')).toMatchObject({
      link_data: { link: 'https://fb.me/', call_to_action: { value: { lead_gen_form_id: 'form1' } } },
    })
  })

  it('does not issue when the switch is off', async () => {
    const f = fixture(false)
    const inspect = vi.fn()
    const issued = await issueCreativeCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      order: order(),
      deps: { switchState: async () => 'off', inspect, meta: async () => { throw new Error('meta') } },
    })
    expect(issued.status).toBe('blocked')
    expect(inspect).not.toHaveBeenCalled()
    expect(f.tables.flywheel_actions).toEqual([])
  })
})
