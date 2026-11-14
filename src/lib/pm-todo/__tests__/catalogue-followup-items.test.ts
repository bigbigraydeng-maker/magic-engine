import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/crm/email-templates/settings-store', () => ({ loadEmailSettings: vi.fn() }))
vi.mock('@/lib/crm/email-templates/link-tracking/click-summary', () => ({ humanClicksByRequest: vi.fn() }))
vi.mock('@/lib/crm/send-stats/reactions', () => ({ loadReactions: vi.fn() }))

import { loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { humanClicksByRequest } from '@/lib/crm/email-templates/link-tracking/click-summary'
import { loadReactions } from '@/lib/crm/send-stats/reactions'
import {
  bucketCatalogueFollowups,
  buildCatalogueFollowupItems,
  defaultCatalogueFollowupDeps,
  pushCatalogueFollowupItems,
  type CatalogueFollowupRow,
} from '../catalogue-followup-items'

const NOW = new Date('2026-11-14T12:00:00.000Z')
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()
const row = (over: Partial<CatalogueFollowupRow> = {}): CatalogueFollowupRow => ({ sentAt: ago(3), takeoverOn: true, clicked: false, reacted: false, ...over })

describe('bucketCatalogueFollowups', () => {
  it('clicked and at least 2 days since the mail → "call" bucket; younger is not yet', () => {
    expect(bucketCatalogueFollowups([row({ clicked: true, sentAt: ago(2) })], NOW)).toEqual({ clicked: 1, quiet: 0 })
    expect(bucketCatalogueFollowups([row({ clicked: true, sentAt: ago(1) })], NOW)).toEqual({ clicked: 0, quiet: 0 })
  })

  it('a clicker stays in the "call" bucket however old (never demoted to "quiet")', () => {
    expect(bucketCatalogueFollowups([row({ clicked: true, sentAt: ago(20) })], NOW)).toEqual({ clicked: 1, quiet: 0 })
  })

  it('no click and no reply, 7 days or more → "quiet" bucket; 6 days is not yet', () => {
    expect(bucketCatalogueFollowups([row({ sentAt: ago(7) })], NOW)).toEqual({ clicked: 0, quiet: 1 })
    expect(bucketCatalogueFollowups([row({ sentAt: ago(6) })], NOW)).toEqual({ clicked: 0, quiet: 0 })
  })

  it('🔴 staff took the guest back, or the guest got in touch → not counted (he is back on the staff list)', () => {
    expect(bucketCatalogueFollowups([row({ clicked: true, takeoverOn: false }), row({ sentAt: ago(9), takeoverOn: false })], NOW)).toEqual({ clicked: 0, quiet: 0 })
    expect(bucketCatalogueFollowups([row({ clicked: true, reacted: true }), row({ sentAt: ago(9), reacted: true })], NOW)).toEqual({ clicked: 0, quiet: 0 })
  })

  it('🔴 clicks unreadable → counted nowhere (not pretended "nobody clicked")', () => {
    expect(bucketCatalogueFollowups([row({ clicked: null, sentAt: ago(30) })], NOW)).toEqual({ clicked: 0, quiet: 0 })
  })

  it('an unreadable send time is skipped, not counted', () => {
    expect(bucketCatalogueFollowups([row({ sentAt: 'not a date', clicked: true })], NOW)).toEqual({ clicked: 0, quiet: 0 })
  })
})

describe('buildCatalogueFollowupItems', () => {
  it('nothing in either bucket → no item', () => {
    expect(buildCatalogueFollowupItems('c1', 'Acme', { clicked: 0, quiet: 0 })).toEqual([])
  })

  it('one item per bucket, with the count, plain words, a direct link, and no guest names', () => {
    const items = buildCatalogueFollowupItems('c1', 'Acme', { clicked: 6, quiet: 12 })
    expect(items.map((i) => i.kind)).toEqual(['catalogue_followup_clicked', 'catalogue_followup_quiet'])
    expect(items[0]?.what).toContain('6 位')
    expect(items[0]?.what).toContain('AI 跟进中')
    expect(items[1]?.what).toContain('12 位')
    expect(items[1]?.how).toContain('没点链接不代表没看')
    for (const i of items) {
      expect(i.href).toBe('https://app.magicengine.com.au/dashboard/clients/c1/crm/send-stats')
      expect(i.how).toContain('收回人工')
      expect(`${i.what} ${i.how}`).not.toMatch(/@|\+\d{6,}/)
    }
  })
})

describe('pushCatalogueFollowupItems', () => {
  it('one client failing leaves a "could not compute" item and does not stop the next client', async () => {
    const items: Parameters<typeof pushCatalogueFollowupItems>[1] = []
    const load = vi.fn(async (_s: unknown, id: string) => {
      if (id === 'bad') throw new Error('boom')
      return [row({ clicked: true })]
    })
    await pushCatalogueFollowupItems({} as never, items, ['bad', 'good'], NOW, (id) => id.toUpperCase(), { load } as never)
    expect(items.map((i) => `${i.client_id}:${i.kind}`)).toEqual(['bad:catalogue_followup_check_failed', 'good:catalogue_followup_clicked'])
    expect(items[0]?.what).toContain('不等于没有人在等')
  })
})

describe('defaultCatalogueFollowupDeps.load', () => {
  const eqCalls: Array<[string, string, unknown]> = []
  const notCalls: Array<[string, string, string, unknown]> = []
  function db(tables: Record<string, unknown[] | 'error'>) {
    return {
      from(table: string) {
        const api: Record<string, unknown> = {}
        for (const m of ['select', 'gte', 'order', 'in', 'limit']) api[m] = () => api
        api.not = (col: string, op: string, val: unknown) => {
          notCalls.push([table, col, op, val])
          return api
        }
        api.eq = (col: string, val: unknown) => {
          eqCalls.push([table, col, val])
          return api
        }
        api.then = (r: (v: unknown) => unknown) => {
          const t = tables[table]
          return Promise.resolve(t === 'error' || t === undefined ? { data: null, error: { message: 'boom' } } : { data: t, error: null }).then(r)
        }
        return api
      },
    } as never
  }
  const okSettings = (templateKey: string | null) => ({ kind: 'ok', version: 1, settings: { providers: templateKey ? { catalogue: { templateKey } } : {} } })
  const receipts = [
    { contact_id: 'p1', request_id: 'q1', created_at: ago(3) },
    { contact_id: 'p1', request_id: 'q1b', created_at: ago(1) },
    { contact_id: 'p2', request_id: 'q2', created_at: ago(9) },
  ]

  beforeEach(() => {
    vi.resetAllMocks()
    eqCalls.length = 0
    notCalls.length = 0
    vi.mocked(loadEmailSettings).mockResolvedValue(okSettings('whatever-key') as never)
    vi.mocked(humanClicksByRequest).mockResolvedValue({ q1: [{ label: 'x', kind: 'catalogue', firstClickedAt: ago(2) }] } as never)
    vi.mocked(loadReactions).mockResolvedValue(new Map())
  })

  it('a client without a catalogue configured has nothing to count (no query, no error)', async () => {
    vi.mocked(loadEmailSettings).mockResolvedValue(okSettings(null) as never)
    expect(await defaultCatalogueFollowupDeps.load(db({}), 'c1', NOW)).toEqual([])
  })

  it('🔴 reads the client\'s OWN catalogue template (from its settings), counts the first mail per guest, only guests still in takeover', async () => {
    const rows = await defaultCatalogueFollowupDeps.load(db({ crm_email_send_receipts: receipts, contacts: [{ id: 'p1' }] }), 'c1', NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ takeoverOn: true, clicked: true, reacted: false, sentAt: ago(3) })
    expect(vi.mocked(humanClicksByRequest).mock.calls[0]?.[2]).toEqual(['q1'])
    expect(eqCalls).toContainEqual(['crm_email_send_receipts', 'template_key', 'whatever-key'])
    expect(eqCalls).toContainEqual(['crm_email_send_receipts', 'client_id', 'c1'])
    expect(eqCalls).toContainEqual(['contacts', 'client_id', 'c1'])
    expect(eqCalls).toContainEqual(['contacts', 'do_not_contact', false])
    expect(notCalls).toContainEqual(['contacts', 'ai_takeover_since', 'is', null])
  })

  it('🔴 a guest who got in touch is flagged reacted', async () => {
    vi.mocked(loadReactions).mockResolvedValue(new Map([['q1', { at: ago(1), kind: 'email' }]]))
    const rows = await defaultCatalogueFollowupDeps.load(db({ crm_email_send_receipts: receipts, contacts: [{ id: 'p1' }] }), 'c1', NOW)
    expect(rows[0]?.reacted).toBe(true)
  })

  it('🔴 clicks unreadable → clicked null; replies unreadable → throws (never "nobody replied")', async () => {
    vi.mocked(humanClicksByRequest).mockResolvedValue(null)
    const rows = await defaultCatalogueFollowupDeps.load(db({ crm_email_send_receipts: receipts, contacts: [{ id: 'p1' }] }), 'c1', NOW)
    expect(rows[0]?.clicked).toBeNull()
    vi.mocked(loadReactions).mockResolvedValue(null)
    await expect(defaultCatalogueFollowupDeps.load(db({ crm_email_send_receipts: receipts, contacts: [{ id: 'p1' }] }), 'c1', NOW)).rejects.toThrow('客人回应读不到')
  })

  it('a database read failure throws (the caller leaves a "could not compute" item)', async () => {
    await expect(defaultCatalogueFollowupDeps.load(db({ crm_email_send_receipts: 'error' }), 'c1', NOW)).rejects.toThrow('catalogue receipts')
  })
})
