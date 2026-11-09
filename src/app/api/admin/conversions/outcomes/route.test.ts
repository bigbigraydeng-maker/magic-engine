/**
 * GET /api/admin/conversions/outcomes
 *
 * 停发成交和停发咨询必须在截断之前分开。否则同一客户有 200 条更新的停发咨询时，
 * 还在补发期内的成交会被窗口挤掉，页面上的「需要你动手」是空的。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-admin', () => ({
  guardAdmin: vi.fn(async () => null),
  requireAdmin: vi.fn(async () => ({ ok: true, user: { email: 'fde@example.com' } })),
}))
vi.mock('@/lib/conversions/route-guard', () => ({
  assertClientScope: vi.fn(() => null),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { GET } from './route'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const DEAL = 'd1000000-0000-0000-0000-000000000001'

type Writeback = {
  status: string
  event_id?: string | null
  last_error_code?: string | null
  payload_preview?: { held?: boolean } | null
}
type Row = {
  id: string
  client_id: string
  outcome_kind: string
  review_status: string
  occurred_at: string
  source_ref?: string | null
  meta_lead_id?: string | null
  redacted_at?: string | null
  me_conversion_writebacks?: Writeback[]
}

let rows: Row[]

function held(status = 'queued'): Writeback[] {
  return [{ status, payload_preview: { held: true } }]
}

function matches(row: Row, op: string, col: string, val: unknown): boolean {
  if (op === 'eq') return row[col as keyof Row] === val
  if (op === 'in' && col === 'outcome_kind') return (val as string[]).includes(row.outcome_kind)
  if (op === 'in' && col === 'me_conversion_writebacks.status') {
    return (row.me_conversion_writebacks ?? []).some((w) => (val as string[]).includes(w.status))
  }
  if (op === 'contains') {
    return (row.me_conversion_writebacks ?? []).some((w) => w.payload_preview?.held === true)
  }
  if (op === 'like') return String((row as Record<string, unknown>)[col] ?? '').startsWith(String(val).replace(/%$/, ''))
  if (op === 'gte') return String((row as Record<string, unknown>)[col] ?? '') >= String(val)
  if (op === 'is') return ((row as Record<string, unknown>)[col] ?? null) === val
  if (op === 'not') return ((row as Record<string, unknown>)[col] ?? null) !== val
  return false
}

/** 先套筛选、再按时间倒序、最后才截断。漏掉类型筛选时，更新的咨询会占满 limit。 */
function listRows(
  filters: Array<[string, string, unknown]>,
  limitN: number | null,
  rangeFrom: number | null = null,
  rangeTo: number | null = null,
): Row[] {
  let out = rows.filter((row) => filters.every(([op, col, val]) => matches(row, op, col, val)))
  out = [...out].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
  if (rangeFrom != null && rangeTo != null) return out.slice(rangeFrom, rangeTo + 1)
  if (limitN != null) out = out.slice(0, limitN)
  return out
}

let clientConfig: unknown = null

function fakeDb(table = 'me_sale_outcomes') {
  const filters: Array<[string, string, unknown]> = []
  let limitN: number | null = null
  let rangeFrom: number | null = null
  let rangeTo: number | null = null
  const builder: Record<string, unknown> = {}
  const self = () => builder
  builder.select = self
  builder.eq = (col: string, val: unknown) => {
    filters.push(['eq', col, val])
    return builder
  }
  builder.in = (col: string, val: unknown) => {
    filters.push(['in', col, val])
    return builder
  }
  builder.contains = (col: string, val: unknown) => {
    filters.push(['contains', col, val])
    return builder
  }
  builder.like = (col: string, val: unknown) => {
    filters.push(['like', col, val])
    return builder
  }
  builder.gte = (col: string, val: unknown) => {
    filters.push(['gte', col, val])
    return builder
  }
  builder.is = (col: string, val: unknown) => {
    filters.push(['is', col, val])
    return builder
  }
  builder.not = (col: string, _op: string, val: unknown) => {
    filters.push(['not', col, val])
    return builder
  }
  builder.order = self
  builder.limit = (n: number) => {
    limitN = n
    return builder
  }
  builder.range = (from: number, to: number) => {
    rangeFrom = from
    rangeTo = to
    return builder
  }
  builder.maybeSingle = async () => {
    if (table === 'clients') return { data: { leads_config: clientConfig }, error: null }
    const found = listRows(filters, null)[0] ?? null
    return { data: found, error: null }
  }
  builder.then = (resolve: (v: { data: Row[]; error: null }) => unknown) =>
    Promise.resolve(resolve({ data: listRows(filters, limitN, rangeFrom, rangeTo), error: null }))
  return builder
}

function seedCrowdedWindow() {
  rows = Array.from({ length: 200 }, (_, i) => ({
    id: `lead-${i}`,
    client_id: CLIENT,
    outcome_kind: 'lead',
    review_status: 'approved',
    occurred_at: `2026-10-31T12:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
    me_conversion_writebacks: held(),
  }))
  rows.push({
    id: DEAL,
    client_id: CLIENT,
    outcome_kind: 'purchase',
    review_status: 'approved',
    occurred_at: '2026-10-28T00:00:00.000Z',
    me_conversion_writebacks: held(),
  })
}

beforeEach(() => {
  rows = []
  clientConfig = null
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => fakeDb(table) as never)
})

function get(query: string) {
  return GET(new Request(`http://x/api/admin/conversions/outcomes?client_id=${CLIENT}&${query}`))
}

describe('GET outcomes · 停发成交不被更新的咨询挤出窗口', () => {
  it('不按类型筛时，200 条更新咨询占满 limit，更老的成交不在结果里', async () => {
    seedCrowdedWindow()
    const res = await get('limit=200&review_status=approved&send_status=queued&held=1')
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.outcomes).toHaveLength(200)
    expect(body.outcomes.some((o: Row) => o.id === DEAL)).toBe(false)
  })

  it('按成交类型筛之后再截断，窗口里的成交还在', async () => {
    seedCrowdedWindow()
    const res = await get(
      'limit=200&review_status=approved&send_status=queued&held=1&outcome_kind=purchase,balance',
    )
    const body = await res.json()
    expect(body.outcomes.map((o: Row) => o.id)).toEqual([DEAL])
  })

  it('咨询提示单独按 lead 取，不占用成交窗口', async () => {
    seedCrowdedWindow()
    const res = await get('limit=1&review_status=approved&send_status=queued&held=1&outcome_kind=lead')
    const body = await res.json()
    expect(body.outcomes).toHaveLength(1)
    expect(body.outcomes[0].outcome_kind).toBe('lead')
  })

  it('深链按 id 直查，不走最新 N 条窗口', async () => {
    seedCrowdedWindow()
    const res = await get(`id=${DEAL}`)
    const body = await res.json()
    expect(body.outcomes.map((o: Row) => o.id)).toEqual([DEAL])
  })

  it('不认识的类型直接拒绝', async () => {
    const res = await get('outcome_kind=purchase,other')
    expect(res.status).toBe(400)
  })
})

describe('GET outcomes · 已报价排队和成交下一步', () => {
  const LEAD = '1687504185706630'

  it('排队中或没有发送记录的已报价会返回，已经发出和普通成交不会', async () => {
    rows = [
      {
        id: 'quoted-queued',
        client_id: CLIENT,
        outcome_kind: 'lead',
        review_status: 'approved',
        source_ref: 'crm_qualified:c:quoted',
        occurred_at: new Date().toISOString(),
        me_conversion_writebacks: [{ status: 'queued', payload_preview: null }],
      },
      {
        id: 'quoted-missing',
        client_id: CLIENT,
        outcome_kind: 'lead',
        review_status: 'approved',
        source_ref: 'crm_qualified:c:missing',
        occurred_at: new Date().toISOString(),
        me_conversion_writebacks: [],
      },
      {
        id: 'quoted-sent',
        client_id: CLIENT,
        outcome_kind: 'lead',
        review_status: 'approved',
        source_ref: 'crm_qualified:c:sent',
        occurred_at: new Date().toISOString(),
        me_conversion_writebacks: [{ status: 'confirmed' }],
      },
      {
        id: DEAL,
        client_id: CLIENT,
        outcome_kind: 'purchase',
        review_status: 'approved',
        occurred_at: new Date().toISOString(),
        me_conversion_writebacks: [{ status: 'queued' }],
      },
    ]
    const res = await get('qualified_open=1')
    const body = await res.json()
    expect(body.outcomes.map((o: Row) => o.id).sort()).toEqual(['quoted-missing', 'quoted-queued'])
  })

  it('最新 200 条已报价都已发出时，更早还在排队的仍在补发列表里', async () => {
    const sent = Array.from({ length: 200 }, (_, i) => ({
      id: `sent-${i}`,
      client_id: CLIENT,
      outcome_kind: 'lead',
      review_status: 'approved',
      source_ref: `crm_qualified:c:sent-${i}`,
      occurred_at: new Date(Date.now() - i * 1000).toISOString(),
      me_conversion_writebacks: [{ status: 'confirmed' }],
    }))
    rows = [
      ...sent,
      {
        id: 'older-queued',
        client_id: CLIENT,
        outcome_kind: 'lead',
        review_status: 'approved',
        source_ref: 'crm_qualified:c:older',
        occurred_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        me_conversion_writebacks: [{ status: 'queued' }],
      },
    ]
    const res = await get('qualified_open=1&limit=200')
    const body = await res.json()
    expect(body.outcomes.map((o: Row) => o.id)).toEqual(['older-queued'])
  })

  it('打开了下一步、又有线索编号、但还没那条发送记录的成交会被标出来', async () => {
    clientConfig = { capi_conversion_leads: true, capi_conversion_deal_stage_key: 'balance_received' }
    rows = [
      {
        id: DEAL,
        client_id: CLIENT,
        outcome_kind: 'purchase',
        review_status: 'approved',
        meta_lead_id: LEAD,
        occurred_at: new Date().toISOString(),
        me_conversion_writebacks: [{ status: 'confirmed', event_id: DEAL }],
      },
      {
        id: 'no-lead',
        client_id: CLIENT,
        outcome_kind: 'purchase',
        review_status: 'approved',
        meta_lead_id: null,
        occurred_at: new Date().toISOString(),
        me_conversion_writebacks: [{ status: 'confirmed', event_id: 'no-lead' }],
      },
    ]
    const res = await get('companion_open=1')
    const body = await res.json()
    expect(body.outcomes.map((o: Row) => o.id)).toEqual([DEAL])
    expect(body.outcomes[0].companion_expected).toBe(true)
  })

  it('最新 200 笔成交的下一步都已发出时，更早还没记下的仍在补发列表里', async () => {
    clientConfig = { capi_conversion_leads: true, capi_conversion_deal_stage_key: 'balance_received' }
    const sent = Array.from({ length: 200 }, (_, i) => ({
      id: `deal-sent-${i}`,
      client_id: CLIENT,
      outcome_kind: 'purchase',
      review_status: 'approved',
      meta_lead_id: LEAD,
      occurred_at: new Date(Date.now() - i * 1000).toISOString(),
      me_conversion_writebacks: [
        { status: 'confirmed', event_id: `deal-sent-${i}` },
        { status: 'confirmed', event_id: `deal-sent-${i}:conversion-stage` },
      ],
    }))
    rows = [
      ...sent,
      {
        id: 'older-open',
        client_id: CLIENT,
        outcome_kind: 'purchase',
        review_status: 'approved',
        meta_lead_id: LEAD,
        occurred_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        me_conversion_writebacks: [{ status: 'confirmed', event_id: 'older-open' }],
      },
    ]
    const res = await get('companion_open=1&limit=200')
    const body = await res.json()
    expect(body.outcomes.map((o: Row) => o.id)).toEqual(['older-open'])
    expect(body.outcomes[0].companion_expected).toBe(true)
  })
})
