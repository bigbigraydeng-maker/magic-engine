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

type Writeback = { status: string; payload_preview?: { held?: boolean } | null }
type Row = {
  id: string
  client_id: string
  outcome_kind: string
  review_status: string
  occurred_at: string
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
  return false
}

/** 先套筛选、再按时间倒序、最后才截断。漏掉类型筛选时，更新的咨询会占满 limit。 */
function listRows(filters: Array<[string, string, unknown]>, limitN: number | null): Row[] {
  let out = rows.filter((row) => filters.every(([op, col, val]) => matches(row, op, col, val)))
  out = [...out].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
  if (limitN != null) out = out.slice(0, limitN)
  return out
}

function fakeDb() {
  const filters: Array<[string, string, unknown]> = []
  let limitN: number | null = null
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
  builder.order = self
  builder.limit = (n: number) => {
    limitN = n
    return builder
  }
  builder.maybeSingle = async () => {
    const found = listRows(filters, null)[0] ?? null
    return { data: found, error: null }
  }
  builder.then = (resolve: (v: { data: Row[]; error: null }) => unknown) =>
    Promise.resolve(resolve({ data: listRows(filters, limitN), error: null }))
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
  vi.mocked(supabaseAdmin.from).mockImplementation(() => fakeDb() as never)
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
