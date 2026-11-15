import { describe, expect, it } from 'vitest'
import { bindLaunchToApprovedPlan } from '@/lib/ads-launch/plan-gate'
import { ACTIVATE_AD_SENTENCE, ACTIVATE_AD_WHAT, pausedDraftClickUrl } from '@/lib/ads-strategy/paused-draft-copy'
import type { CardClicker } from '@/lib/confirmation-card/actor'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import { createCapabilities } from '@/lib/capabilities'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { CLIENT_A, makeFixture } from '@/lib/kernel/__tests__/fixtures'
import { confirmActivateCard, issueActivateCard, type ActivateDeps } from '../flow'
import type { ActivateLive } from '../guard'
import type { ActivateHold } from '../ledger'
import { parseActivateRequest } from '../order'
import { describePausedAd } from '../paused'
import { readActivateSwitch } from '../switch'

const OPC: CardClicker = { kind: 'opc', email: 'opc@example.com' }
const NOW = '2026-11-14T00:00:00.000Z'
const AT = '2026-11-13T20:00:00.000Z'
const AD = '111111'
const PASTE = '444444'

function live(over: Partial<ActivateLive> = {}): ActivateLive {
  return {
    adStatus: 'PAUSED',
    accountId: 'act_111111',
    adsetStatus: 'ACTIVE',
    campaignStatus: 'ACTIVE',
    owned: true,
    ...over,
  }
}

function fixture(on = true) {
  const base = { client_id: CLIENT_A, ad_account_id: 'act_111111', captured_at: AT, complete: true, error: null, skipped_shared: false }
  return makeFixture({
    registry: ACTION_REGISTRY,
    capabilities: (sb) => createCapabilities(sb),
    startAt: NOW,
    options: {
      extraTables: {
        clients: [{ id: CLIENT_A, leads_config: { activate_ad_card: on } }],
        marketing_plans: [{
          id: 'plan-1',
          client_id: CLIENT_A,
          status: 'approved',
          plan_data: { promo: { daily_total_cap_cents: 2000 } },
        }],
        client_meta_ad_accounts: [{ client_id: CLIENT_A, ad_account_id: 'act_111111' }],
        ad_snapshot_captures: [{ ...base, level: 'campaign' }, { ...base, level: 'adset' }],
        ad_entity_snapshots: [
          {
            client_id: CLIENT_A,
            level: 'ad',
            entity_id: AD,
            entity_name: '春季图',
            ad_account_id: 'act_111111',
            adset_id: '222222',
            campaign_id: '333333',
            status: 'PAUSED',
            captured_at: AT,
            targeting_summary: { image_url: 'https://cdn.example/ad.jpg' },
          },
          {
            client_id: CLIENT_A,
            level: 'ad',
            entity_id: AD,
            entity_name: '旧名字',
            status: 'ACTIVE',
            captured_at: '2026-11-01T00:00:00.000Z',
          },
          { client_id: CLIENT_A, level: 'adset', entity_id: '222222', entity_name: '春季组', status: 'ACTIVE', captured_at: AT },
          { client_id: CLIENT_A, level: 'campaign', entity_id: '333333', entity_name: '春季系列', status: 'ACTIVE', captured_at: AT },
        ],
      },
    },
  })
}

function counters() {
  return { reads: 0, writes: 0, readBacks: 0 }
}

function depsFor(
  f: ReturnType<typeof fixture>,
  meta: ReturnType<typeof counters>,
  seen: { live: ActivateLive },
): ActivateDeps {
  return {
    switchState: () => readActivateSwitch(f.supabase, CLIENT_A),
    describe: (adId) => describePausedAd(f.supabase, CLIENT_A, adId),
    plan: () => bindLaunchToApprovedPlan(f.supabase, CLIENT_A, { mode: 'ad_only' }, f.clock.now),
    live: async () => { meta.reads += 1; return seen.live },
    activate: async () => { meta.writes += 1; return true },
    readBack: async () => { meta.readBacks += 1; return 'ACTIVE' },
  }
}

async function ready() {
  const f = fixture()
  const meta = counters()
  const seen = { live: live() }
  const deps = depsFor(f, meta, seen)
  const issued = await issueActivateCard({
    kernel: f.kernel,
    clientId: CLIENT_A,
    clicker: OPC,
    order: { adId: AD },
    deps,
  })
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

describe('activate ad card', () => {
  it('issues a card for one paused ad and does not call Meta', async () => {
    const box = await ready()
    expect(box.issued.status).toBe('issued')
    expect(box.issued.card?.what).toBe(ACTIVATE_AD_WHAT)
    expect(box.issued.card?.account).toContain('春季图')
    expect(box.issued.card?.date).toContain('春季组')
    expect(box.issued.card?.scope).toBe(ACTIVATE_AD_SENTENCE)
    expect(box.issued.card?.amount).toBe('不加预算')
    expect(box.issued.card?.expiresLabel).toContain('新西兰')
    expect(box.issued.previewUrl).toBe('https://cdn.example/ad.jpg')
    expect(box.meta.reads).toBe(0)
    expect(box.meta.writes).toBe(0)
    expect(box.meta.readBacks).toBe(0)
    expect(box.f.tables.flywheel_actions[0]?.action_type).toBe(ADS_ACTION_TYPE.ACTIVATE_AD)
    expect(pausedDraftClickUrl(CLIENT_A, 'run-1', ACTIVATE_AD_WHAT)).toContain('/activate-ad-card/run-1')

    const pasted = await issueActivateCard({
      kernel: box.f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      order: { adId: PASTE },
      deps: box.deps,
    })
    expect(pasted.status).toBe('issued')
    expect(pasted.card?.account).toContain('这条广告')
    expect(box.meta.reads).toBe(0)
    expect(box.meta.writes).toBe(0)
    expect(() => parseActivateRequest({ adId: AD, dailyBudget: 1 })).toThrow(ConfirmationCardError)
  })

  it('turns the ad on once and stores the result', async () => {
    const box = await ready()
    const done = await confirmActivateCard(confirmArgs(box))
    expect(done.status).toBe('executed')
    expect(done.reason.startsWith('已做完')).toBe(true)
    expect(done.reason).toContain('没有加预算')
    expect(box.meta.writes).toBe(1)
    expect(box.meta.readBacks).toBe(1)
    const row = box.f.tables.flywheel_actions.find((item) => (item.payload as ActivateHold).adId === AD)
    expect(row?.payload).toMatchObject({ status: 'executed', wrote: true, planId: 'plan-1', readback: 'ACTIVE' })
  })

  it('refuses an ad that is already on', async () => {
    const box = await ready()
    box.seen.live = live({ adStatus: 'ACTIVE' })
    const done = await confirmActivateCard(confirmArgs(box))
    expect(done.wrote).toBe(false)
    expect(done.status).toBe('blocked')
    expect(done.reason).toContain('已经不是暂停')
    expect(done.reason.startsWith('没做成')).toBe(true)
    expect(box.meta.writes).toBe(0)
  })

  it('refuses when the ad set or the campaign is not on', async () => {
    for (const patch of [{ adsetStatus: 'PAUSED' }, { campaignStatus: 'PAUSED' }] as const) {
      const box = await ready()
      box.seen.live = live(patch)
      const done = await confirmActivateCard(confirmArgs(box))
      expect(done.wrote, JSON.stringify(patch)).toBe(false)
      expect(done.status, JSON.stringify(patch)).toBe('blocked')
      expect(done.reason, JSON.stringify(patch)).toContain('不是在投')
      expect(box.meta.writes, JSON.stringify(patch)).toBe(0)
    }
  })

  it('refuses when the approved-plan gate fails', async () => {
    const box = await ready()
    box.f.tables.marketing_plans.length = 0
    const done = await confirmActivateCard(confirmArgs(box))
    expect(done.wrote).toBe(false)
    expect(done.status).toBe('blocked')
    expect(done.reason.startsWith('没做成')).toBe(true)
    expect(box.meta.writes).toBe(0)
  })

  it('refuses an expired card without calling Meta', async () => {
    const box = await ready()
    box.f.clock.now = new Date(Date.parse(NOW) + 30 * 60 * 1000)
    const done = await confirmActivateCard(confirmArgs(box))
    expect(done.wrote).toBe(false)
    expect(done.card?.status).toBe('expired')
    expect(done.reason).toContain('30 分钟')
    expect(box.meta.reads).toBe(0)
    expect(box.meta.writes).toBe(0)
  })

  it('writes once on a second confirm and on two confirms at the same time', async () => {
    const box = await ready()
    const first = await confirmActivateCard(confirmArgs(box))
    const second = await confirmActivateCard(confirmArgs(box))
    expect(first.status).toBe('executed')
    expect(second.wrote).toBe(true)
    expect(second.reason).toBe(first.reason)
    expect(box.meta.writes).toBe(1)

    const again = await ready()
    const [left, right] = await Promise.all([
      confirmActivateCard(confirmArgs(again)),
      confirmActivateCard(confirmArgs(again)),
    ])
    const executed = [left, right].filter((item) => item.status === 'executed')
    expect(executed).toHaveLength(1)
    expect(again.meta.writes).toBe(1)

    const stuck = await ready()
    const hold = stuck.f.tables.flywheel_actions[0]
    ;(hold?.payload as ActivateHold).status = 'writing'
    const skipped = await confirmActivateCard(confirmArgs(stuck))
    expect(skipped.wrote).toBe(false)
    expect(skipped.reason).toContain('不会自动再写一次')
    expect(stuck.meta.writes).toBe(0)
  })

  it('refuses when the switch is off', async () => {
    const f = fixture(false)
    const meta = counters()
    const issued = await issueActivateCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      clicker: OPC,
      order: { adId: AD },
      deps: depsFor(f, meta, { live: live() }),
    })
    expect(issued.status).toBe('blocked')
    expect(issued.reason).toContain('没开')
    expect(meta.reads).toBe(0)
    expect(meta.writes).toBe(0)
    expect(f.tables.flywheel_actions).toEqual([])

    const box = await ready()
    const config = (box.f.tables.clients[0] as { leads_config: { activate_ad_card: boolean } }).leads_config
    config.activate_ad_card = false
    const done = await confirmActivateCard(confirmArgs(box))
    expect(done.wrote).toBe(false)
    expect(done.status).toBe('blocked')
    expect(done.reason).toContain('没开')
    expect(box.meta.reads).toBe(0)
    expect(box.meta.writes).toBe(0)
  })
})
