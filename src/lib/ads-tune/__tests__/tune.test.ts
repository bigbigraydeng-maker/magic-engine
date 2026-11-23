import { describe, expect, it } from 'vitest'
import { createCapabilities } from '@/lib/capabilities'
import { NZ_DAY_EXPIRED } from '@/lib/ads-strategy/daily-card-guard'
import { ADD_CREATIVE_WHAT } from '@/lib/ads-strategy/paused-draft-copy'
import { RULE_CLEARED } from '@/lib/ads-strategy/daily-card-guard'
import { textsFromAds } from '@/lib/ads-creative-card/order'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { CLIENT_A, makeFixture } from '@/lib/kernel/__tests__/fixtures'
import type { FakeSupabaseOptions } from '@/lib/kernel/__tests__/fake-supabase'
import { confirmCreativeCard, type CreativeMeta } from '@/lib/ads-creative-card/flow'
import { clipImage, findingsFromSummary, pickUnusedImage, planTune, tuneCardsEnabled, withTuneSwitch, type TuneLive } from '../plan'
import { TUNE_ACTION } from '../plan'
import { blockTuneOnConfirm, genericTuneRefusal, issueTune, tuneAwareDeps } from '../run'
import { ticketItem } from '../ticket'

const NOW = '2026-11-21T00:00:00.000Z'
const IMAGE = `renders/${CLIENT_A}/poster.jpg`
const FINDING = {
  diagnosis_code: 'creative_fatigue',
  label_zh: '点击率比前一周低',
  subject: { level: 'adset', id: 'fixture-adset-group-a', name: 'Fixture group A', ad_set_id: '111' },
  suggested_tune: ['swap_creative'],
  severity: 'act_soon',
  source: 'rules',
}

function live(): TuneLive {
  return {
    accountId: 'act_111111', adSetId: '111', primaryText: 'Spring departure is open', headline: 'Spring tour',
    ctaType: 'LEARN_MORE', copy: { sourceAdId: 'ad1', pageId: 'pg1', link: 'https://example.com/go', leadFormId: null },
    imageUrl: 'https://cdn.example/poster.jpg', planId: 'plan-1', adSetActive: true,
  }
}

function decide(over: Partial<Parameters<typeof planTune>[0]> = {}) {
  return planTune({
    clientId: CLIENT_A, now: new Date(NOW), finding: FINDING, live: live(), already: false, enabled: true,
    images: [{ path: IMAGE, approved: true, usedInAds: false }], ...over,
  })
}

describe('tune dry run', () => {
  it('plans a paused add-image card, else a content ticket, and stays off by default', () => {
    const card = decide()
    expect(card.kind).toBe('creative')
    if (card.kind !== 'creative') return
    expect(card.order.status).toBe('PAUSED')
    expect(card.order).not.toHaveProperty('dailyBudget')
    expect(card.order.primaryText).toBe('Spring departure is open')
    expect(decide({ images: [] }).kind).toBe('ticket')
    expect(decide({ live: null }).kind).toBe('ticket')
    expect(decide({ enabled: false }).kind).toBe('skip')
    expect(decide({ already: true }).kind).toBe('skip')
    expect(decide({ finding: { ...FINDING, suggested_tune: ['narrow_audience'] } }).kind).toBe('skip')
    expect(decide({ finding: { ...FINDING, suggested_tune: undefined, suggestedTune: ['add_creative'] } }).kind).toBe('creative')
    expect(tuneCardsEnabled({})).toBe(false)
    expect(withTuneSwitch({ keep: 1 }, true)).toMatchObject({ keep: 1, ads_tune_cards: true })
    expect(pickUnusedImage(CLIENT_A, [{ path: IMAGE, approved: false, usedInAds: false }])).toBeNull()
    expect(clipImage(IMAGE, 'image/jpeg', 'active', new Set([IMAGE]))?.usedInAds).toBe(true)
    expect(findingsFromSummary({ client_id: CLIENT_A, findings: [FINDING] }, CLIENT_A)).toEqual([FINDING])
    expect(findingsFromSummary({ findings: [FINDING] }, CLIENT_A)).toBe('unread')
    expect(textsFromAds([{ creative: { object_story_spec: { link_data: { message: 'Spring departure is open', name: 'Spring tour' } } } }])?.headline).toBe('Spring tour')
  })
})

describe('tune issue', () => {
  it('issues the card without an ad write, then refuses confirm once the finding is gone', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY, capabilities: (sb) => createCapabilities(sb), startAt: NOW,
      options: { extraTables: {
        clients: [{ id: CLIENT_A, leads_config: { ads_tune_cards: true, add_creative_card: false } }],
        cron_run_logs: [{ job_name: 'ads-daily-trend-check', status: 'completed', finished_at: NOW, summary: { client_id: CLIENT_A, findings: [FINDING] } }],
      } },
    })
    const issued = await issueTune({ kernel: f.kernel, clientId: CLIENT_A, decision: decide(), now: new Date(NOW) })
    expect(issued).toMatchObject({ kind: 'creative', issued: true, wroteMeta: false })
    expect(f.tables.action_runs[0]?.input).toMatchObject({ what: ADD_CREATIVE_WHAT, lifetime: 'nz_day' })
    const metaCalls: string[] = []
    const meta: CreativeMeta = {
      uploadImage: async () => { metaCalls.push('image'); return { ok: true, id: 'hash1' } },
      createCreative: async () => { metaCalls.push('creative'); return { ok: true, id: 'cr1' } },
      createAd: async (input) => { metaCalls.push('ad'); return { ok: true, id: input.status === 'PAUSED' ? 'ad9' : 'bad' } },
    }
    const run = f.tables.action_runs[0]
    const input = run?.input as { content_fingerprint?: string }
    const gate = await blockTuneOnConfirm(f.kernel, CLIENT_A, issued.runId ?? '', 'confirm', new Date(NOW))
    expect(gate.block).toBeNull()
    expect(genericTuneRefusal({ ...gate, remedy: 'creative' })).toContain('不能在这里点')
    const done = await confirmCreativeCard({
      kernel: f.kernel, clientId: CLIENT_A, runId: issued.runId ?? '', clicker: { kind: 'opc', email: 'opc@example.com' },
      resolution: 'confirm', expectedDecisionId: String(run?.authorization_decision_id ?? ''), fingerprint: input.content_fingerprint ?? '',
      now: new Date(NOW),
      deps: tuneAwareDeps({
        switchState: async () => 'off',
        inspect: async () => ({ plan: { ok: true as const, planId: 'plan-1' }, live: { accountKnown: true, adSetStatus: 'ACTIVE', copy: live().copy }, imageUrl: live().imageUrl }),
        meta: async () => meta,
      }, true, async () => 'on'),
    })
    expect(done.status).toBe('executed')
    expect(metaCalls).toEqual(['image', 'creative', 'ad'])
    f.tables.cron_run_logs[0].summary = { client_id: CLIENT_A, findings: [] }
    expect((await blockTuneOnConfirm(f.kernel, CLIENT_A, issued.runId ?? '', 'confirm', new Date(NOW))).block).toBe(RULE_CLEARED)
    expect(metaCalls).toEqual(['image', 'creative', 'ad'])
  })

  it('turns a slug-only finding into a content todo and not an ad write', async () => {
    const f = makeFixture({ registry: ACTION_REGISTRY, capabilities: (sb) => createCapabilities(sb), startAt: NOW })
    const slug = { ...FINDING, subject: { level: 'adset', id: 'fixture-adset-group-a', name: 'Fixture group A' } }
    const issued = await issueTune({
      kernel: f.kernel, clientId: CLIENT_A, now: new Date(NOW),
      decision: decide({ finding: slug, images: [], live: null }),
    })
    expect(issued).toMatchObject({ kind: 'ticket', wroteMeta: false, runId: null })
    expect(f.tables.action_runs).toHaveLength(0)
    const row = f.tables.flywheel_actions.find((item) => item.action_type === TUNE_ACTION)
    const item = ticketItem(row?.client_id, row?.payload, () => 'Fixture client')
    expect(item?.kind).toBe('ads_tune_content_ticket')
    expect(item?.how).toContain('不要自己去广告后台改')
  })

  it('refuses confirm and does not write the ad when the tune marker is unreadable', async () => {
    const failures: NonNullable<FakeSupabaseOptions['failOn']> = []
    const f = opened(failures)
    const issued = await issueTune({ kernel: f.kernel, clientId: CLIENT_A, decision: decide(), now: new Date(NOW) })
    const metaCalls: string[] = []
    failures.push({ table: 'flywheel_actions', op: 'select', message: 'down' })
    await expectRefused(f, issued.runId ?? '', metaCalls)
    failures.splice(0, failures.length)
    f.tables.flywheel_actions = f.tables.flywheel_actions.filter((row) => row.action_type !== TUNE_ACTION)
    await expectRefused(f, issued.runId ?? '', metaCalls)
    const again = await issueTune({ kernel: f.kernel, clientId: CLIENT_A, decision: decide(), now: new Date(NOW) })
    const marker = [...f.tables.flywheel_actions].reverse().find((row) => row.action_type === TUNE_ACTION)
    if (!marker) throw new Error('missing marker')
    f.tables.flywheel_actions.push(JSON.parse(JSON.stringify({ ...marker, id: 'marker-copy' })) as typeof marker)
    await expectRefused(f, again.runId ?? '', metaCalls)
    expect(metaCalls).toEqual([])
  })

  it('voids the card and asks content for an image when the marker is not saved', async () => {
    const f = opened([])
    const orig = f.kernel.supabase.from.bind(f.kernel.supabase)
    let inserts = 0
    f.kernel.supabase.from = ((table: string) => {
      const builder = orig(table) as { insert?: (row: unknown) => unknown }
      if (table !== 'flywheel_actions' || typeof builder.insert !== 'function') return builder
      const insert = builder.insert.bind(builder)
      builder.insert = (row: unknown) => {
        const action = row && typeof row === 'object' ? (row as { action_type?: string }).action_type : undefined
        if (action === TUNE_ACTION && inserts === 0) {
          inserts += 1
          return { then: (fn: (v: { data: null; error: { message: string } }) => unknown) => Promise.resolve({ data: null, error: { message: 'down' } }).then(fn) }
        }
        return insert(row)
      }
      return builder
    }) as typeof f.kernel.supabase.from
    const issued = await issueTune({ kernel: f.kernel, clientId: CLIENT_A, decision: decide(), now: new Date(NOW) })
    expect(issued).toMatchObject({ kind: 'ticket', wroteMeta: false, runId: null })
    expect(f.tables.action_runs[0]?.status).toBe('denied')
    expect((await blockTuneOnConfirm(f.kernel, CLIENT_A, String(f.tables.action_runs[0]?.id), 'confirm', new Date(NOW))).block).toBe('读不到调方标记，没有改广告')
  })

  it('refuses a tune confirm when the switch is off or the card is past the New Zealand day', async () => {
    const f = opened([])
    const issued = await issueTune({ kernel: f.kernel, clientId: CLIENT_A, decision: decide(), now: new Date(NOW) })
    f.tables.clients[0].leads_config = { ads_tune_cards: false }
    expect((await blockTuneOnConfirm(f.kernel, CLIENT_A, issued.runId ?? '', 'confirm', new Date(NOW))).block).toContain('没开调方')
    f.tables.clients[0].leads_config = { ads_tune_cards: true }
    expect((await blockTuneOnConfirm(f.kernel, CLIENT_A, issued.runId ?? '', 'confirm', new Date('2026-11-21T12:00:00.000Z'))).block).toBe(NZ_DAY_EXPIRED)
  })
})

function opened(failures: NonNullable<FakeSupabaseOptions['failOn']>) {
  return makeFixture({
    registry: ACTION_REGISTRY, capabilities: (sb) => createCapabilities(sb), startAt: NOW,
    options: {
      supabaseOptions: { failOn: failures },
      extraTables: {
        clients: [{ id: CLIENT_A, leads_config: { ads_tune_cards: true, add_creative_card: false } }],
        cron_run_logs: [{ job_name: 'ads-daily-trend-check', status: 'completed', finished_at: NOW, summary: { client_id: CLIENT_A, findings: [FINDING] } }],
      },
    },
  })
}

async function expectRefused(
  f: ReturnType<typeof opened>,
  runId: string,
  metaCalls: string[],
): Promise<void> {
  const gate = await blockTuneOnConfirm(f.kernel, CLIENT_A, runId, 'confirm', new Date(NOW))
  expect(gate.block).toBe('读不到调方标记，没有改广告')
  if (gate.block) return
  const run = f.tables.action_runs.find((row) => row.id === runId)
  const input = run?.input as { content_fingerprint?: string }
  await confirmCreativeCard({
    kernel: f.kernel, clientId: CLIENT_A, runId, clicker: { kind: 'opc', email: 'opc@example.com' },
    resolution: 'confirm', expectedDecisionId: String(run?.authorization_decision_id ?? ''), fingerprint: input.content_fingerprint ?? '',
    now: new Date(NOW),
    deps: tuneAwareDeps({
      switchState: async () => 'on',
      inspect: async () => ({ plan: { ok: true as const, planId: 'plan-1' }, live: { accountKnown: true, adSetStatus: 'ACTIVE', copy: live().copy }, imageUrl: live().imageUrl }),
      meta: async () => ({
        uploadImage: async () => { metaCalls.push('image'); return { ok: true, id: 'hash1' } },
        createCreative: async () => { metaCalls.push('creative'); return { ok: true, id: 'cr1' } },
        createAd: async () => { metaCalls.push('ad'); return { ok: true, id: 'ad9' } },
      }),
    }, true, async () => 'on'),
  })
}
