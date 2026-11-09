import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../writeback-service', () => ({
  sendApprovedOutcome: vi.fn(async () => ({ status: 'confirmed', message: '已发送', writebackId: 'wb-1' })),
}))

import { DAY_MS } from '../event-window'
import { runQuotedLeadAutoSendForClient } from '../quoted-lead-auto-send'
import { sendApprovedOutcome } from '../writeback-service'

type Row = Record<string, unknown>

let clients: Row[]
let outcomes: Row[]
let contacts: Row[]
let audits: Row[]

function fakeDb(table: string) {
  const filters: Array<[string, string, unknown]> = []
  let pendingUpdate: Row | null = null
  let wantsIds = false
  const src = () =>
    table === 'clients' ? clients : table === 'me_sale_outcomes' ? outcomes : table === 'contacts' ? contacts : []
  const matched = () =>
    src().filter((r) =>
      filters.every(([op, col, val]) => {
        if (op === 'eq') return r[col] === val
        if (op === 'is') return val === null ? r[col] == null : r[col] === val
        if (op === 'in') return (val as unknown[]).includes(r[col])
        if (op === 'gte' && typeof r[col] === 'string' && typeof val === 'string') {
          return Date.parse(r[col] as string) >= Date.parse(val)
        }
        if (op === 'gte') return false
        return true
      }),
    )
  const builder: Record<string, unknown> = {
    select: () => {
      if (pendingUpdate) wantsIds = true
      return builder
    },
    eq: (col: string, val: unknown) => {
      filters.push(['eq', col, val])
      return builder
    },
    is: (col: string, val: unknown) => {
      filters.push(['is', col, val])
      return builder
    },
    in: (col: string, vals: unknown[]) => {
      filters.push(['in', col, vals])
      return builder
    },
    gte: (col: string, val: unknown) => {
      filters.push(['gte', col, val])
      return builder
    },
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
    update: (patch: Row) => {
      pendingUpdate = patch
      return builder
    },
    insert: (row: Row) => {
      if (table === 'me_conversion_audit') audits.push(row)
      return Promise.resolve({ error: null })
    },
    then: (resolve: (v: { data: Row[] | null; error: null }) => unknown) => {
      if (pendingUpdate) {
        const hit = matched()
        for (const r of hit) Object.assign(r, pendingUpdate)
        return resolve({ data: wantsIds ? hit.map((r) => ({ id: r.id })) : null, error: null })
      }
      return resolve({ data: matched(), error: null })
    },
  }
  return builder
}

const NOW = new Date('2026-11-10T00:00:00Z')
const supabase = { from: (table: string) => fakeDb(table) }

function lead(over: Partial<Row> = {}): Row {
  return {
    id: 'lead-1',
    client_id: 'c1',
    contact_id: 'person-1',
    outcome_kind: 'lead',
    review_status: 'pending_review',
    redacted_at: null,
    occurred_at: new Date(NOW.getTime() - 2 * DAY_MS).toISOString(),
    ...over,
  }
}

beforeEach(() => {
  clients = [{ id: 'c1', quoted_lead_auto_send_enabled: true }]
  outcomes = []
  contacts = [{ id: 'person-1', client_id: 'c1', stage: 'quoted' }]
  audits = []
  vi.mocked(sendApprovedOutcome).mockClear()
  vi.mocked(sendApprovedOutcome).mockResolvedValue({ status: 'confirmed', message: '已发送', writebackId: 'wb-1' })
})

function run() {
  return runQuotedLeadAutoSendForClient('c1', {
    supabase: supabase as never,
    sendDeps: { writer: {} as never, fetcher: fetch },
    now: NOW,
  })
}

describe('已报价自动回传', () => {
  it('开关关着什么都不发', async () => {
    clients = [{ id: 'c1', quoted_lead_auto_send_enabled: false }]
    outcomes.push(lead())
    const result = await run()
    expect(result).toEqual({ ran: false, reason: 'disabled' })
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
    expect(outcomes[0].review_status).toBe('pending_review')
  })

  it('没这列时当作关着', async () => {
    const broken = {
      from: () => ({
        select: () => broken.from(),
        eq: () => broken.from(),
        maybeSingle: async () => ({ data: null, error: { message: 'column quoted_lead_auto_send_enabled does not exist' } }),
      }),
    }
    const result = await runQuotedLeadAutoSendForClient('c1', {
      supabase: broken as never,
      sendDeps: { writer: {} as never, fetcher: fetch },
      now: NOW,
    })
    expect(result).toEqual({ ran: false, reason: 'disabled' })
  })

  it('当前是已报价、还在 7 天内的咨询才发，并记下规则', async () => {
    outcomes.push(lead())
    const result = await run()
    expect(result).toMatchObject({ ran: true, sent: 1 })
    expect(sendApprovedOutcome).toHaveBeenCalledTimes(1)
    expect(outcomes[0]).toMatchObject({ review_status: 'approved', reviewed_by: 'quoted-lead-auto-send@system' })
    expect(audits).toContainEqual(
      expect.objectContaining({
        action: 'quoted_lead_auto_approved',
        detail: expect.objectContaining({ rule: 'quoted_stage_within_window', stage: 'quoted' }),
      }),
    )
    expect(audits).toContainEqual(
      expect.objectContaining({ action: 'sent', detail: expect.objectContaining({ status: 'confirmed' }) }),
    )
  })

  it('正好 7 天还发得出去；过了 1 毫秒不发', async () => {
    outcomes.push(
      lead({ id: 'exact', occurred_at: new Date(NOW.getTime() - 7 * DAY_MS).toISOString() }),
      lead({ id: 'over', contact_id: 'person-1', occurred_at: new Date(NOW.getTime() - 7 * DAY_MS - 1).toISOString() }),
    )
    const result = await run()
    expect(result).toMatchObject({ ran: true, sent: 1 })
    expect(sendApprovedOutcome).toHaveBeenCalledTimes(1)
    expect(sendApprovedOutcome).toHaveBeenCalledWith('exact', expect.anything())
    expect(outcomes.find((r) => r.id === 'over')?.review_status).toBe('pending_review')
  })

  it('别的客户的已报价、成交、没有客人的咨询都不发', async () => {
    contacts.push({ id: 'other', client_id: 'c2', stage: 'quoted' })
    outcomes.push(
      lead({ id: 'foreign', contact_id: 'other' }),
      lead({ id: 'deal', outcome_kind: 'purchase' }),
      lead({ id: 'nocontact', contact_id: null }),
    )
    const result = await run()
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ran: true, sent: 0 })
  })

  it('发送失败也留下规则，不把整批扔掉', async () => {
    outcomes.push(lead({ id: 'a' }), lead({ id: 'b', contact_id: 'person-1' }))
    vi.mocked(sendApprovedOutcome)
      .mockRejectedValueOnce(new Error('平台没接上'))
      .mockResolvedValueOnce({ status: 'confirmed', message: '已发送', writebackId: 'wb-2' })
    const result = await run()
    expect(result).toMatchObject({ ran: true, sent: 1 })
    expect(audits).toContainEqual(
      expect.objectContaining({
        outcome_id: 'a',
        action: 'quoted_lead_auto_send_failed',
        detail: expect.objectContaining({ rule: 'quoted_stage_within_window' }),
      }),
    )
  })
})
