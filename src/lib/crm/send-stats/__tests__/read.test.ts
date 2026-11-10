import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/crm/email-templates/receipt-store', () => ({ listReceiptsSince: vi.fn() }))
vi.mock('@/lib/crm/email-templates/template-store', () => ({ listCurrentTemplates: vi.fn() }))
vi.mock('@/lib/crm/email-templates/link-tracking/click-summary', () => ({ humanClicksByRequest: vi.fn() }))
vi.mock('../reactions', () => ({ loadReactions: vi.fn() }))

import { listReceiptsSince } from '@/lib/crm/email-templates/receipt-store'
import { listCurrentTemplates } from '@/lib/crm/email-templates/template-store'
import { humanClicksByRequest } from '@/lib/crm/email-templates/link-tracking/click-summary'
import { loadReactions } from '../reactions'
import { clampDays, readSendStats, SEND_STATS_MAX_ROWS } from '../read'

const NOW = new Date('2026-11-11T00:00:00.000Z')
const receipt = (over: Record<string, unknown> = {}) => ({ id: 'r1', contactId: 'p1', requestId: 'q1', templateKey: 'catalogue-send', outcome: 'sent', blockReason: null, createdAt: '2026-11-10T02:00:00.000Z', ...over })

function db(names: Array<{ id: string; display_name: string | null }> | 'error' = [{ id: 'p1', display_name: 'Amy Lee' }]) {
  const api: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in']) api[m] = () => api
  api.then = (r: (v: unknown) => unknown) => Promise.resolve(names === 'error' ? { data: null, error: { message: 'boom' } } : { data: names, error: null }).then(r)
  return { from: () => api } as never
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(listCurrentTemplates).mockResolvedValue([{ templateKey: 'catalogue-send', name: '④一键发目录：2027 手册' }] as never)
  vi.mocked(humanClicksByRequest).mockResolvedValue({})
  vi.mocked(loadReactions).mockResolvedValue(new Map())
})

describe('clampDays', () => {
  it('default 7, at least 1, at most 90', () => {
    expect([clampDays(null), clampDays('0'), clampDays('-3'), clampDays('x'), clampDays('30'), clampDays('500'), clampDays('2.9')]).toEqual([7, 7, 7, 7, 30, 90, 2])
  })
})

describe('readSendStats', () => {
  it('asks for the window and one row more than it shows (to know it was cut), and says so when it was', async () => {
    vi.mocked(listReceiptsSince).mockResolvedValue(Array.from({ length: SEND_STATS_MAX_ROWS + 1 }, (_, i) => receipt({ id: `r${i}` })) as never)
    const out = await readSendStats(db(), 'c1', 7, NOW)
    expect(listReceiptsSince).toHaveBeenCalledWith(expect.anything(), 'c1', '2026-11-04T00:00:00.000Z', SEND_STATS_MAX_ROWS + 1)
    expect(out.truncated).toBe(true)
    expect(out.rows).toHaveLength(SEND_STATS_MAX_ROWS)
  })

  it('joins name, template name, clicks and the guest\'s reaction; a mail that did not go out has no clicks', async () => {
    vi.mocked(listReceiptsSince).mockResolvedValue([receipt(), receipt({ id: 'r2', outcome: 'blocked', blockReason: 'frequency_cap', requestId: 'q2' })] as never)
    vi.mocked(humanClicksByRequest).mockResolvedValue({ q1: [{ label: '目录', kind: 'catalogue', firstClickedAt: '2026-11-10T03:00:00.000Z' }] })
    vi.mocked(loadReactions).mockResolvedValue(new Map([['r1', { at: '2026-11-10T05:00:00.000Z', channel: 'email' }]]))
    const out = await readSendStats(db(), 'c1', 7, NOW)
    expect(out.rows[0]).toMatchObject({ contactName: 'Amy Lee', templateName: '④一键发目录：2027 手册', clicks: [{ label: '目录' }], reaction: { channel: 'email' } })
    expect(out.rows[1]).toMatchObject({ outcome: 'blocked', blockReason: 'frequency_cap', clicks: [], reaction: null })
    expect(out.reactionsReadable).toBe(true)
    expect(vi.mocked(loadReactions).mock.calls[0]?.[2]).toEqual([{ key: 'r1', contactId: 'p1', sentAt: '2026-11-10T02:00:00.000Z' }])
  })

  it('🔴 clicks unreadable → clicks null (not an empty list); reactions unreadable → flagged (not zero)', async () => {
    vi.mocked(listReceiptsSince).mockResolvedValue([receipt()] as never)
    vi.mocked(humanClicksByRequest).mockResolvedValue(null)
    vi.mocked(loadReactions).mockResolvedValue(null)
    const out = await readSendStats(db(), 'c1', 7, NOW)
    expect(out.rows[0]?.clicks).toBeNull()
    expect(out.reactionsReadable).toBe(false)
  })

  it('a hand-written mail has no template; a template since removed has no name', async () => {
    vi.mocked(listReceiptsSince).mockResolvedValue([receipt({ templateKey: null }), receipt({ id: 'r2', templateKey: 'gone' })] as never)
    const out = await readSendStats(db(), 'c1', 7, NOW)
    expect(out.rows.map((r) => [r.templateKey, r.templateName])).toEqual([[null, null], ['gone', null]])
  })

  it('receipts or names unreadable → throws (the page shows an error, never an empty table)', async () => {
    vi.mocked(listReceiptsSince).mockResolvedValue([receipt()] as never)
    await expect(readSendStats(db('error'), 'c1', 7, NOW)).rejects.toThrow('contacts: boom')
  })
})
