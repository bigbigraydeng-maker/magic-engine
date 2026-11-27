// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/crm/email-templates/settings-store', () => ({ loadEmailSettings: vi.fn() }))

import { loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { CLIENT, NOW, at, db, world, type Row } from '@/lib/crm/ai-takeover/__tests__/pickup-db'
import { buildCatalogueAskItems, defaultCatalogueAskDeps, pushCatalogueAskItems } from '../catalogue-ask-items'
import type { ManualItem } from '../manual-item-types'

const note = (id: string, contact: string, minutes: number, raw: string): Row =>
  ({ id, client_id: CLIENT, contact_id: contact, channel: 'phone', direction: 'outbound', occurred_at: at(minutes), summary: null, raw, metadata: {}, source: 'me_manual' })
const settings = (over: Record<string, unknown> = {}) =>
  ({ kind: 'ok', version: 1, settings: { enabled: true, providers: { catalogue: { templateKey: 'catalogue-send' } }, ...over } }) as never

beforeEach(() => vi.mocked(loadEmailSettings).mockReset())

describe('buildCatalogueAskItems', () => {
  it('nobody waiting → no item', () => {
    expect(buildCatalogueAskItems('c1', 'Acme', 0)).toEqual([])
  })

  it('one item per client: how many, what to do, a link to the list; no guest names', () => {
    const [item] = buildCatalogueAskItems('c1', 'Acme', 3)
    expect(item).toMatchObject({ kind: 'catalogue_ask_waiting', client_id: 'c1', client_name: 'Acme' })
    expect(item.what).toContain('3 位')
    expect(item.how).toContain('员工留言要目录')
    expect(item.href).toMatch(/\/dashboard\/clients\/c1\/crm\/ai-pickup$/)
  })
})

describe('defaultCatalogueAskDeps.countWaiting (same rule as the list page)', () => {
  it('counts the guests whose note asks for the catalogue and whom the pickup rules do not take', async () => {
    vi.mocked(loadEmailSettings).mockResolvedValue(settings())
    const tables = world()
    tables.contact_touchpoints.push(
      note('nb', 'b', 310, 'Spoke, wants the 2027 catalogue'), // reached → staff keeps b → counted
      note('na', 'a', 62, 'Left voicemail, follow up catalogue'), // a goes to the AI by the pickup rule → not counted here
    )
    expect(await defaultCatalogueAskDeps.countWaiting(db(tables, []), CLIENT, NOW)).toBe(1)
  })

  it('a client without a catalogue (or with sending off) has no such item', async () => {
    vi.mocked(loadEmailSettings).mockResolvedValue(settings({ providers: {} }))
    expect(await defaultCatalogueAskDeps.countWaiting(db(world(), []), CLIENT, NOW)).toBeNull()
    vi.mocked(loadEmailSettings).mockResolvedValue(settings({ enabled: false }))
    expect(await defaultCatalogueAskDeps.countWaiting(db(world(), []), CLIENT, NOW)).toBeNull()
    vi.mocked(loadEmailSettings).mockResolvedValue({ kind: 'none' } as never)
    expect(await defaultCatalogueAskDeps.countWaiting(db(world(), []), CLIENT, NOW)).toBeNull()
  })
})

describe('pushCatalogueAskItems', () => {
  const run = async (countWaiting: (id: string) => Promise<number | null>) => {
    const items: ManualItem[] = []
    await pushCatalogueAskItems(db({}, []), items, ['c1', 'c2'], NOW, (id) => `Client ${id}`, { countWaiting: (_sb, id) => countWaiting(id) })
    return items
  }

  it('one client failing leaves a "not computed" item for it and still reports the others', async () => {
    const items = await run(async (id) => { if (id === 'c1') throw new Error('contacts: timeout'); return 2 })
    expect(items.map((i) => [i.kind, i.client_id])).toEqual([['catalogue_ask_check_failed', 'c1'], ['catalogue_ask_waiting', 'c2']])
    expect(items[0].what).toContain('contacts: timeout')
  })

  it('no catalogue and nobody waiting → nothing', async () => {
    expect(await run(async (id) => (id === 'c1' ? null : 0))).toEqual([])
  })
})
