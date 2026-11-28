// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/crm/email-templates/settings-store', () => ({ loadEmailSettings: vi.fn() }))

import { loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { CLIENT, NOW, db, world } from '@/lib/crm/ai-takeover/__tests__/pickup-db'
import { DEFAULT_PICKUP_CONFIG } from '@/lib/crm/ai-takeover/pickup'
import { decideAll, latestEnquiries, loadInputs } from '@/lib/crm/ai-takeover/pickup-run'
import { buildAiPickupWaitingItems, defaultAiPickupWaitingDeps, pushAiPickupWaitingItems, QUIET_DAYS } from '../ai-pickup-waiting-items'
import { LANE_OF_KIND } from '../five-kinds'
import type { ManualItem } from '../manual-item-types'

const settings = (over: Record<string, unknown> = {}) =>
  ({ kind: 'ok', version: 1, settings: { enabled: true, providers: { catalogue: { templateKey: 'catalogue-send' } }, ...over } }) as never
const release = (daysAgo: number) => ({ id: `ev-${daysAgo}`, client_id: CLIENT, contact_id: 'someone-else', kind: 'ai_takeover_on', created_at: new Date(NOW.getTime() - daysAgo * 86_400_000 - 3_600_000).toISOString() })

beforeEach(() => vi.mocked(loadEmailSettings).mockReset())

describe('buildAiPickupWaitingItems', () => {
  it('nobody waiting → no item', () => {
    expect(buildAiPickupWaitingItems('c1', 'Acme', { waiting: 0, daysSinceRelease: 30 })).toEqual([])
  })

  it('someone released within the quiet days → no item: people are clicking, no need to nag', () => {
    expect(buildAiPickupWaitingItems('c1', 'Acme', { waiting: 50, daysSinceRelease: QUIET_DAYS - 1 })).toEqual([])
    expect(buildAiPickupWaitingItems('c1', 'Acme', { waiting: 50, daysSinceRelease: QUIET_DAYS })).toHaveLength(1)
  })

  it('one item per client: how many, how long since the last release, what to do, a link to the list; no guest names', () => {
    const [item] = buildAiPickupWaitingItems('c1', 'Acme', { waiting: 216, daysSinceRelease: 14 })
    expect(item).toMatchObject({ kind: 'ai_pickup_waiting', client_id: 'c1', client_name: 'Acme' })
    expect(item.what).toContain('216 位')
    expect(item.what).toContain('已经 14 天没有人放行了')
    expect(item.how).toContain('交给 AI 跟进')
    expect(item.href).toMatch(/\/dashboard\/clients\/c1\/crm\/ai-pickup$/)
  })

  it('nobody has ever released: says so instead of a number of days', () => {
    const [item] = buildAiPickupWaitingItems('c1', 'Acme', { waiting: 3, daysSinceRelease: null })
    expect(item.what).toContain('还从来没有人放行过')
  })

  it('goes to the client-side column; the "not computed" one goes to developers', () => {
    expect(LANE_OF_KIND.ai_pickup_waiting).toBe('client_side')
    expect(LANE_OF_KIND.ai_pickup_waiting_check_failed).toBe('dev')
  })
})

describe('defaultAiPickupWaitingDeps.load (same rule as the list page)', () => {
  it('counts exactly the guests the pickup rules take, and reads the days since the last release', async () => {
    vi.mocked(loadEmailSettings).mockResolvedValue(settings())
    const tables = world()
    tables.contact_automation_events = [release(14)]
    const sb = db(tables, [])
    const leads = await latestEnquiries(sb, CLIENT, NOW)
    const expected = decideAll(await loadInputs(sb, CLIENT, [...leads.keys()]), leads, NOW, DEFAULT_PICKUP_CONFIG).length
    expect(expected).toBeGreaterThan(0)
    expect(await defaultAiPickupWaitingDeps.load(sb, CLIENT, NOW)).toEqual({ waiting: expected, daysSinceRelease: 14 })
  })

  it('no release on record → null days', async () => {
    vi.mocked(loadEmailSettings).mockResolvedValue(settings())
    const got = await defaultAiPickupWaitingDeps.load(db(world(), []), CLIENT, NOW)
    expect(got?.daysSinceRelease).toBeNull()
  })

  it('writes nothing', async () => {
    vi.mocked(loadEmailSettings).mockResolvedValue(settings())
    const writes: string[] = []
    await defaultAiPickupWaitingDeps.load(db(world(), writes), CLIENT, NOW)
    expect(writes).toEqual([])
  })

  it('a client that has not set its qualified stages has no list page, so no item (not a failure)', async () => {
    vi.mocked(loadEmailSettings).mockResolvedValue(settings())
    const tables = world()
    tables.ad_strategy_configs = []
    expect(await defaultAiPickupWaitingDeps.load(db(tables, []), CLIENT, NOW)).toBeNull()
  })

  it('a client without a catalogue (or with sending off) has no such item', async () => {
    vi.mocked(loadEmailSettings).mockResolvedValue(settings({ providers: {} }))
    expect(await defaultAiPickupWaitingDeps.load(db(world(), []), CLIENT, NOW)).toBeNull()
    vi.mocked(loadEmailSettings).mockResolvedValue(settings({ enabled: false }))
    expect(await defaultAiPickupWaitingDeps.load(db(world(), []), CLIENT, NOW)).toBeNull()
    vi.mocked(loadEmailSettings).mockResolvedValue({ kind: 'none' } as never)
    expect(await defaultAiPickupWaitingDeps.load(db(world(), []), CLIENT, NOW)).toBeNull()
  })
})

describe('pushAiPickupWaitingItems', () => {
  const run = async (load: (id: string) => Promise<{ waiting: number; daysSinceRelease: number | null } | null>) => {
    const items: ManualItem[] = []
    await pushAiPickupWaitingItems(db({}, []), items, ['c1', 'c2'], NOW, (id) => `Client ${id}`, { load: (_sb, id) => load(id) })
    return items
  }

  it('one client failing leaves a "not computed" item for it and still reports the others', async () => {
    const items = await run(async (id) => { if (id === 'c1') throw new Error('contacts: timeout'); return { waiting: 2, daysSinceRelease: 9 } })
    expect(items.map((i) => [i.kind, i.client_id])).toEqual([['ai_pickup_waiting_check_failed', 'c1'], ['ai_pickup_waiting', 'c2']])
    expect(items[0].what).toContain('contacts: timeout')
  })

  it('no list, nobody waiting, or released yesterday → nothing', async () => {
    expect(await run(async (id) => (id === 'c1' ? null : { waiting: 0, daysSinceRelease: null }))).toEqual([])
    expect(await run(async () => ({ waiting: 9, daysSinceRelease: 1 }))).toEqual([])
  })
})
