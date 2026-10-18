import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountStatusRow } from '@/lib/ads-strategy/account-status'

const h = vi.hoisted(() => ({
  clients: [] as Array<{ id: string; name: string; meta_ad_account_id: string | null }>,
  accounts: {} as Record<string, Array<{ adAccountId: string; label: string | null; isPrimary: boolean }>>,
  rows: {} as Record<string, AccountStatusRow[]>,
  captures: {} as Record<string, Array<{ ad_account_id: string; captured_at: string }>>,
  captureError: null as string | null,
}))

vi.mock('@/lib/meta/client-ad-accounts', () => ({
  getActiveClientsWithMetaAccounts: vi.fn(async () => h.clients),
  getClientAdAccounts: vi.fn(async (id: string) => h.accounts[id] ?? []),
}))

vi.mock('@/lib/ads-strategy/account-status', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ads-strategy/account-status')>()
  return {
    ...real,
    loadAccountStatusRows: vi.fn(async (clientId: string) => h.rows[clientId] ?? []),
  }
})

import {
  evaluateAccountStatus,
  pushAdsAccountStatusItems,
  type AccountStatusEvalInput,
} from '../ads-account-status-items'
import { LANE_OF_KIND } from '../five-kinds'

const NOW = new Date('2026-10-18T01:00:00.000Z') // Sunday in New Zealand
const MONDAY = new Date('2026-10-19T01:00:00.000Z') // Monday in New Zealand
const MONDAY_EDGE = new Date('2026-10-18T12:00:00.000Z') // already Monday 01:00 NZDT

function hoursBefore(base: Date, n: number): string {
  return new Date(base.getTime() - n * 3_600_000).toISOString()
}

function hoursAgo(n: number): string {
  return hoursBefore(NOW, n)
}

function row(over: Partial<AccountStatusRow>): AccountStatusRow {
  return {
    ad_account_id: 'act_1',
    entity_name: 'Main',
    account_status: 1,
    timezone_name: 'Pacific/Auckland',
    capture_reason: 'daily',
    captured_at: hoursAgo(1),
    ...over,
  }
}

function input(over: Partial<AccountStatusEvalInput>): AccountStatusEvalInput {
  return {
    clientId: 'c-1',
    clientName: 'Client One',
    adAccountId: 'act_1',
    accountName: 'Main',
    rows: [row({})],
    lastCompleteCaptureAt: hoursAgo(2),
    now: NOW,
    ...over,
  }
}

function makeSb(): object {
  return {
    from(_table: string) {
      let clientId: string | null = null
      const builder = {
        select() {
          return builder
        },
        eq(_col: string, value: string) {
          if (_col === 'client_id') clientId = value
          return builder
        },
        gte() {
          return builder
        },
        order() {
          return builder
        },
        limit() {
          const data = clientId ? h.captures[clientId] ?? [] : []
          const error = h.captureError ? { message: h.captureError } : null
          return Promise.resolve({ data, error })
        },
      }
      return builder
    },
  }
}

function asSupabase(stub: object): SupabaseClient {
  return stub as SupabaseClient
}

const nameOf = (id: string) => `Client ${id}`

beforeEach(() => {
  h.clients = []
  h.accounts = {}
  h.rows = {}
  h.captures = {}
  h.captureError = null
})

describe('evaluateAccountStatus', () => {
  it('status 1 → null', () => {
    expect(evaluateAccountStatus(input({}))).toBeNull()
  })

  it('status 3 for 10 hours → null (not yet 24h)', () => {
    const finding = evaluateAccountStatus(
      input({
        rows: [
          row({ account_status: 3, captured_at: hoursAgo(1) }),
          row({ account_status: 3, captured_at: hoursAgo(10) }),
          row({ account_status: 1, captured_at: hoursAgo(20) }),
        ],
      }),
    )
    expect(finding).toBeNull()
  })

  it('status 3 for 30 hours → ads_account_not_active finding', () => {
    const finding = evaluateAccountStatus(
      input({
        rows: [
          row({ account_status: 3, captured_at: hoursAgo(1) }),
          row({ account_status: 3, captured_at: hoursAgo(30) }),
          row({ account_status: 1, captured_at: hoursAgo(50) }),
        ],
      }),
    )
    expect(finding).not.toBeNull()
    if (!finding) throw new Error('expected finding')
    expect(finding.item.kind).toBe('ads_account_not_active')
    expect(finding.key).toBe('ads_account_not_active:c-1:1')
    expect(finding.item.what).toContain('码 3')
    expect(finding.item.what).toContain('欠款')
    expect(finding.item.what).toContain('30 小时')
    expect(finding.item.href).toBe(
      'https://app.magicengine.com.au/dashboard/clients/c-1/ads-health',
    )
    expect(LANE_OF_KIND['ads_account_not_active']).toBe('one_click')
  })

  it('onset is counted from the first row of the current run, not the latest row', () => {
    const finding = evaluateAccountStatus(
      input({
        rows: [
          row({ account_status: 3, captured_at: hoursAgo(1) }),
          row({ account_status: 3, captured_at: hoursAgo(60) }),
          row({ account_status: 1, captured_at: hoursAgo(80) }),
        ],
      }),
    )
    expect(finding).not.toBeNull()
    if (!finding) throw new Error('expected finding')
    expect(finding.item.what).toContain('2 天')
  })

  it('recovered → null', () => {
    const finding = evaluateAccountStatus(
      input({
        rows: [
          row({ account_status: 1, captured_at: hoursAgo(1) }),
          row({ account_status: 3, captured_at: hoursAgo(40) }),
        ],
      }),
    )
    expect(finding).toBeNull()
  })

  it('flap: current run only 4 hours old → null', () => {
    const finding = evaluateAccountStatus(
      input({
        rows: [
          row({ account_status: 3, captured_at: hoursAgo(1) }),
          row({ account_status: 1, captured_at: hoursAgo(5) }),
          row({ account_status: 3, captured_at: hoursAgo(40) }),
        ],
      }),
    )
    expect(finding).toBeNull()
  })

  it('account_status null in newest row → unreadable', () => {
    const finding = evaluateAccountStatus(
      input({
        rows: [row({ account_status: null, captured_at: hoursAgo(1) })],
      }),
    )
    expect(finding).not.toBeNull()
    if (!finding) throw new Error('expected finding')
    expect(finding.item.kind).toBe('ads_account_status_unreadable')
    expect(LANE_OF_KIND['ads_account_status_unreadable']).toBe('dev')
  })

  it('newest row capture_reason disappeared → unreadable', () => {
    const finding = evaluateAccountStatus(
      input({
        rows: [row({ account_status: null, capture_reason: 'disappeared', captured_at: hoursAgo(1) })],
      }),
    )
    expect(finding).not.toBeNull()
    if (!finding) throw new Error('expected finding')
    expect(finding.item.kind).toBe('ads_account_status_unreadable')
  })

  it('lastCompleteCaptureAt null → unreadable even when rows show status 1', () => {
    const finding = evaluateAccountStatus(input({ lastCompleteCaptureAt: null }))
    expect(finding).not.toBeNull()
    if (!finding) throw new Error('expected finding')
    expect(finding.item.kind).toBe('ads_account_status_unreadable')
  })

  it('lastCompleteCaptureAt 40 hours ago → unreadable', () => {
    const finding = evaluateAccountStatus(input({ lastCompleteCaptureAt: hoursAgo(40) }))
    expect(finding).not.toBeNull()
    if (!finding) throw new Error('expected finding')
    expect(finding.item.kind).toBe('ads_account_status_unreadable')
  })

  it('lastCompleteCaptureAt 35 hours ago with status 1 → null', () => {
    const finding = evaluateAccountStatus(input({ lastCompleteCaptureAt: hoursAgo(35) }))
    expect(finding).toBeNull()
  })

  it('rows empty → unreadable', () => {
    const finding = evaluateAccountStatus(input({ rows: [] }))
    expect(finding).not.toBeNull()
    if (!finding) throw new Error('expected finding')
    expect(finding.item.kind).toBe('ads_account_status_unreadable')
  })

  it('closed status 101 on a non-Monday → null', () => {
    const finding = evaluateAccountStatus(
      input({
        rows: [
          row({ account_status: 101, captured_at: hoursAgo(1) }),
          row({ account_status: 101, captured_at: hoursAgo(100) }),
          row({ account_status: 1, captured_at: hoursAgo(200) }),
        ],
      }),
    )
    expect(finding).toBeNull()
  })

  it('closed status 101 on Monday → ads_account_closed_weekly', () => {
    const finding = evaluateAccountStatus(
      input({
        now: MONDAY,
        lastCompleteCaptureAt: hoursBefore(MONDAY, 2),
        rows: [
          row({ account_status: 101, captured_at: hoursBefore(MONDAY, 1) }),
          row({ account_status: 101, captured_at: hoursBefore(MONDAY, 100) }),
          row({ account_status: 1, captured_at: hoursBefore(MONDAY, 200) }),
        ],
      }),
    )
    expect(finding).not.toBeNull()
    if (!finding) throw new Error('expected finding')
    expect(finding.item.kind).toBe('ads_account_closed_weekly')
    expect(finding.key).toMatch(/^ads_account_closed_weekly:c-1:1:2026-W4\d$/)
    expect(LANE_OF_KIND['ads_account_closed_weekly']).toBe('decide')
  })

  it('closed status 2 on Monday → ads_account_closed_weekly', () => {
    const finding = evaluateAccountStatus(
      input({
        now: MONDAY,
        lastCompleteCaptureAt: hoursBefore(MONDAY, 2),
        rows: [
          row({ account_status: 2, captured_at: hoursBefore(MONDAY, 1) }),
          row({ account_status: 2, captured_at: hoursBefore(MONDAY, 100) }),
          row({ account_status: 1, captured_at: hoursBefore(MONDAY, 200) }),
        ],
      }),
    )
    expect(finding).not.toBeNull()
    if (!finding) throw new Error('expected finding')
    expect(finding.item.kind).toBe('ads_account_closed_weekly')
  })

  it('closed status 100 on Monday → ads_account_closed_weekly', () => {
    const finding = evaluateAccountStatus(
      input({
        now: MONDAY,
        lastCompleteCaptureAt: hoursBefore(MONDAY, 2),
        rows: [
          row({ account_status: 100, captured_at: hoursBefore(MONDAY, 1) }),
          row({ account_status: 100, captured_at: hoursBefore(MONDAY, 100) }),
          row({ account_status: 1, captured_at: hoursBefore(MONDAY, 200) }),
        ],
      }),
    )
    expect(finding).not.toBeNull()
    if (!finding) throw new Error('expected finding')
    expect(finding.item.kind).toBe('ads_account_closed_weekly')
  })

  it('MONDAY_EDGE counts as Monday', () => {
    const finding = evaluateAccountStatus(
      input({
        now: MONDAY_EDGE,
        lastCompleteCaptureAt: hoursBefore(MONDAY_EDGE, 2),
        rows: [
          row({ account_status: 101, captured_at: hoursBefore(MONDAY_EDGE, 1) }),
          row({ account_status: 101, captured_at: hoursBefore(MONDAY_EDGE, 100) }),
          row({ account_status: 1, captured_at: hoursBefore(MONDAY_EDGE, 200) }),
        ],
      }),
    )
    expect(finding).not.toBeNull()
    if (!finding) throw new Error('expected finding')
    expect(finding.item.kind).toBe('ads_account_closed_weekly')
  })

  it('status 7 with a 30h run → ads_account_not_active without 欠款', () => {
    const finding = evaluateAccountStatus(
      input({
        rows: [
          row({ account_status: 7, captured_at: hoursAgo(1) }),
          row({ account_status: 7, captured_at: hoursAgo(30) }),
          row({ account_status: 1, captured_at: hoursAgo(50) }),
        ],
      }),
    )
    expect(finding).not.toBeNull()
    if (!finding) throw new Error('expected finding')
    expect(finding.item.kind).toBe('ads_account_not_active')
    expect(finding.item.what).toContain('码 7')
    expect(finding.item.what).not.toContain('欠款')
  })

  it('account id without act_ prefix and with prefix produce the same key', () => {
    const rows: AccountStatusRow[] = [
      row({ account_status: 3, captured_at: hoursAgo(1) }),
      row({ account_status: 3, captured_at: hoursAgo(30) }),
      row({ account_status: 1, captured_at: hoursAgo(50) }),
    ]
    const withPrefix = evaluateAccountStatus(input({ adAccountId: 'act_1', rows }))
    const withoutPrefix = evaluateAccountStatus(input({ adAccountId: '1', rows }))
    expect(withPrefix).not.toBeNull()
    expect(withoutPrefix).not.toBeNull()
    if (!withPrefix || !withoutPrefix) throw new Error('expected findings')
    expect(withPrefix.key).toBe(withoutPrefix.key)
  })
})

describe('pushAdsAccountStatusItems', () => {
  it('registered account with status 3 for 30h → one ads_account_not_active item', async () => {
    h.clients = [{ id: 'c-1', name: 'Client One', meta_ad_account_id: 'act_1' }]
    h.accounts['c-1'] = [{ adAccountId: 'act_1', label: 'Main', isPrimary: true }]
    h.rows['c-1'] = [
      row({ account_status: 3, captured_at: hoursAgo(1) }),
      row({ account_status: 3, captured_at: hoursAgo(30) }),
      row({ account_status: 1, captured_at: hoursAgo(50) }),
    ]
    h.captures['c-1'] = [{ ad_account_id: 'act_1', captured_at: hoursAgo(2) }]

    const items: import('../manual-item-types').ManualItem[] = []
    await pushAdsAccountStatusItems(asSupabase(makeSb()), items, NOW, nameOf)

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('ads_account_not_active')
    expect(items[0].client_id).toBe('c-1')
    expect(items[0].client_name).toBe('Client c-1')
  })

  it('unbound account is ignored', async () => {
    h.clients = [{ id: 'c-1', name: 'Client One', meta_ad_account_id: 'act_1' }]
    h.accounts['c-1'] = [{ adAccountId: 'act_1', label: 'Main', isPrimary: true }]
    h.rows['c-1'] = [
      row({ ad_account_id: 'act_1', account_status: 1, captured_at: hoursAgo(1) }),
      row({ ad_account_id: 'act_old', account_status: 3, captured_at: hoursAgo(1) }),
      row({ ad_account_id: 'act_old', account_status: 3, captured_at: hoursAgo(100) }),
      row({ ad_account_id: 'act_old', account_status: 1, captured_at: hoursAgo(200) }),
    ]
    h.captures['c-1'] = [
      { ad_account_id: 'act_1', captured_at: hoursAgo(2) },
      { ad_account_id: 'act_old', captured_at: hoursAgo(2) },
    ]

    const items: import('../manual-item-types').ManualItem[] = []
    await pushAdsAccountStatusItems(asSupabase(makeSb()), items, NOW, nameOf)

    expect(items).toHaveLength(0)
  })

  it('two clients sharing an account each get their own item', async () => {
    h.clients = [
      { id: 'c-1', name: 'Client One', meta_ad_account_id: 'act_shared' },
      { id: 'c-2', name: 'Client Two', meta_ad_account_id: 'act_shared' },
    ]
    h.accounts['c-1'] = [{ adAccountId: 'act_shared', label: 'Shared', isPrimary: true }]
    h.accounts['c-2'] = [{ adAccountId: 'act_shared', label: 'Shared', isPrimary: true }]
    h.rows['c-1'] = [
      row({ ad_account_id: 'act_shared', account_status: 3, captured_at: hoursAgo(1) }),
      row({ ad_account_id: 'act_shared', account_status: 3, captured_at: hoursAgo(30) }),
      row({ ad_account_id: 'act_shared', account_status: 1, captured_at: hoursAgo(50) }),
    ]
    h.rows['c-2'] = [
      row({ ad_account_id: 'act_shared', account_status: 3, captured_at: hoursAgo(1) }),
      row({ ad_account_id: 'act_shared', account_status: 3, captured_at: hoursAgo(30) }),
      row({ ad_account_id: 'act_shared', account_status: 1, captured_at: hoursAgo(50) }),
    ]
    h.captures['c-1'] = [{ ad_account_id: 'act_shared', captured_at: hoursAgo(2) }]
    h.captures['c-2'] = [{ ad_account_id: 'act_shared', captured_at: hoursAgo(2) }]

    const items: import('../manual-item-types').ManualItem[] = []
    await pushAdsAccountStatusItems(asSupabase(makeSb()), items, NOW, nameOf)

    expect(items).toHaveLength(2)
    const ids = items.map((i) => i.client_id).sort()
    expect(ids).toEqual(['c-1', 'c-2'])
  })

  it('closed account on Monday → one weekly item; same data on Sunday → none', async () => {
    h.clients = [{ id: 'c-1', name: 'Client One', meta_ad_account_id: 'act_1' }]
    h.accounts['c-1'] = [{ adAccountId: 'act_1', label: 'Main', isPrimary: true }]

    h.rows['c-1'] = [
      row({ account_status: 101, captured_at: hoursBefore(MONDAY, 1) }),
      row({ account_status: 101, captured_at: hoursBefore(MONDAY, 100) }),
      row({ account_status: 1, captured_at: hoursBefore(MONDAY, 200) }),
    ]
    h.captures['c-1'] = [{ ad_account_id: 'act_1', captured_at: hoursBefore(MONDAY, 2) }]

    const mondayItems: import('../manual-item-types').ManualItem[] = []
    await pushAdsAccountStatusItems(asSupabase(makeSb()), mondayItems, MONDAY, nameOf)
    expect(mondayItems).toHaveLength(1)
    expect(mondayItems[0].kind).toBe('ads_account_closed_weekly')

    h.rows['c-1'] = [
      row({ account_status: 101, captured_at: hoursAgo(1) }),
      row({ account_status: 101, captured_at: hoursAgo(100) }),
      row({ account_status: 1, captured_at: hoursAgo(200) }),
    ]
    h.captures['c-1'] = [{ ad_account_id: 'act_1', captured_at: hoursAgo(2) }]

    const sundayItems: import('../manual-item-types').ManualItem[] = []
    await pushAdsAccountStatusItems(asSupabase(makeSb()), sundayItems, NOW, nameOf)
    expect(sundayItems).toHaveLength(0)
  })

  it('account_status null in newest row → one unreadable item, no not_active', async () => {
    h.clients = [{ id: 'c-1', name: 'Client One', meta_ad_account_id: 'act_1' }]
    h.accounts['c-1'] = [{ adAccountId: 'act_1', label: 'Main', isPrimary: true }]
    h.rows['c-1'] = [row({ account_status: null, captured_at: hoursAgo(1) })]
    h.captures['c-1'] = [{ ad_account_id: 'act_1', captured_at: hoursAgo(2) }]

    const items: import('../manual-item-types').ManualItem[] = []
    await pushAdsAccountStatusItems(asSupabase(makeSb()), items, NOW, nameOf)

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('ads_account_status_unreadable')
    expect(items.some((i) => i.kind === 'ads_account_not_active')).toBe(false)
  })

  it('capture query error → one unreadable item containing the message, does not throw', async () => {
    h.clients = [{ id: 'c-1', name: 'Client One', meta_ad_account_id: 'act_1' }]
    h.accounts['c-1'] = [{ adAccountId: 'act_1', label: 'Main', isPrimary: true }]
    h.rows['c-1'] = [row({ account_status: 1, captured_at: hoursAgo(1) })]
    h.captureError = 'boom'

    const items: import('../manual-item-types').ManualItem[] = []
    await expect(
      pushAdsAccountStatusItems(asSupabase(makeSb()), items, NOW, nameOf),
    ).resolves.toBeUndefined()

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('ads_account_status_unreadable')
    expect(items[0].what).toContain('boom')
  })

  it('client with zero registered accounts → no items', async () => {
    h.clients = [{ id: 'c-1', name: 'Client One', meta_ad_account_id: null }]
    h.accounts['c-1'] = []

    const items: import('../manual-item-types').ManualItem[] = []
    await pushAdsAccountStatusItems(asSupabase(makeSb()), items, NOW, nameOf)

    expect(items).toHaveLength(0)
  })

  it('healthy status 1 everywhere → no items', async () => {
    h.clients = [{ id: 'c-1', name: 'Client One', meta_ad_account_id: 'act_1' }]
    h.accounts['c-1'] = [{ adAccountId: 'act_1', label: 'Main', isPrimary: true }]
    h.rows['c-1'] = [row({ account_status: 1, captured_at: hoursAgo(1) })]
    h.captures['c-1'] = [{ ad_account_id: 'act_1', captured_at: hoursAgo(2) }]

    const items: import('../manual-item-types').ManualItem[] = []
    await pushAdsAccountStatusItems(asSupabase(makeSb()), items, NOW, nameOf)

    expect(items).toHaveLength(0)
  })
})
