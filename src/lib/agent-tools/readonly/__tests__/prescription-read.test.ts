/**
 * 诸葛抽屉三个只读工具：读得到 / 读不到 / 没权限。
 * 执行链不写库。没传 prescription_id 时用当前客户最新一份已批准或草稿处方。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(),
  requirePlanApproverAccess: vi.fn(),
}))
vi.mock('@/lib/prescription-chain/load', () => ({ loadChainFacts: vi.fn(), serviceReader: vi.fn((d: unknown) => d) }))
vi.mock('@/lib/prescription-chain/derive', () => ({ deriveChainStatus: vi.fn(() => ({ steps: [] })) }))
vi.mock('@/lib/ads-strategy/plan-seed/read-for-client', () => ({ readPlanSeedForClient: vi.fn() }))
vi.mock('@/lib/ads-tracking-preflight/load-receipt', () => ({ loadTrackingGateFacts: vi.fn() }))
vi.mock('@/lib/kernel/store', () => ({ insertRun: vi.fn(async () => ({})) }))

import { requirePaidClientAccess, requirePlanApproverAccess } from '@/lib/auth/client-access'
import { loadChainFacts } from '@/lib/prescription-chain/load'
import { readPlanSeedForClient } from '@/lib/ads-strategy/plan-seed/read-for-client'
import { loadTrackingGateFacts } from '@/lib/ads-tracking-preflight/load-receipt'
import { insertRun } from '@/lib/kernel/store'
import { readPlanSeed, readPrescriptionProgress, readSpendAndLeads } from '../prescription-read'
import type { ReadonlyToolContext } from '../types'

const okAccess = { ok: true } as never
const noAccess = { ok: false, status: 403, error: 'x' } as never

function ctxWithRow(row: unknown): ReadonlyToolContext {
  const q: Record<string, unknown> = {}
  q.select = () => q
  q.eq = () => q
  q.maybeSingle = async () => ({ data: row, error: null })
  return {
    clientId: 'client-A', domain: null, siteUrl: null, propertyId: null, market: 'AU',
    supabase: { from: (table: string) => { tables.push(table); return q } } as unknown as ReadonlyToolContext['supabase'],
  }
}

interface LatestProbe {
  ctx: ReadonlyToolContext
  eqs: Array<[string, unknown]>
  ins: Array<[string, unknown]>
  orders: Array<[string, unknown]>
  limitCalls: () => number
}

function ctxWithLatest(latestId: string | null, detail: unknown = null): LatestProbe {
  const eqs: Array<[string, unknown]> = []
  const ins: Array<[string, unknown]> = []
  const orders: Array<[string, unknown]> = []
  let limits = 0
  const q: Record<string, unknown> = {}
  q.select = () => q
  q.eq = (col: string, val: unknown) => { eqs.push([col, val]); return q }
  q.in = (col: string, val: unknown) => { ins.push([col, val]); return q }
  q.order = (col: string, opts: unknown) => { orders.push([col, opts]); return q }
  q.limit = async () => {
    limits += 1
    return { data: latestId ? [{ id: latestId }] : [], error: null }
  }
  q.maybeSingle = async () => ({ data: detail, error: null })
  const ctx: ReadonlyToolContext = {
    clientId: 'client-A', domain: null, siteUrl: null, propertyId: null, market: 'AU',
    supabase: { from: (table: string) => { tables.push(table); return q } } as unknown as ReadonlyToolContext['supabase'],
  }
  return { ctx, eqs, ins, orders, limitCalls: () => limits }
}

const tables: string[] = []
const parse = (s: string) => JSON.parse(s) as Record<string, unknown>

function dialogLogs(): Array<Record<string, unknown>> {
  return vi.mocked(console.info).mock.calls
    .map(c => String(c[0]))
    .filter(s => s.includes('zhuge_dialog_read'))
    .map(s => JSON.parse(s) as Record<string, unknown>)
}

beforeEach(() => {
  vi.resetAllMocks()
  tables.length = 0
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  expect(insertRun).not.toHaveBeenCalled()
  expect(tables).not.toContain('action_runs')
  vi.mocked(console.info).mockRestore()
})

describe('read_prescription_progress', () => {
  it('读得到：返回处方 + 走到哪一步，且不写库', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue(okAccess)
    vi.mocked(loadChainFacts).mockResolvedValue({ prescription: { read: 'ok', value: { id: 'p1' } } } as never)
    const out = parse(await readPrescriptionProgress.handler({ prescription_id: 'p1' }, ctxWithRow({ id: 'p1', status: 'approved' })))
    expect(out.read).toBe('ok')
    expect(dialogLogs()).toEqual([{
      event: 'zhuge_dialog_read', client_id: 'client-A',
      tool: 'read_prescription_progress', outcome: 'read', read_only: true,
    }])
  })

  it('处方不存在 → 读不到，且不写库', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue(okAccess)
    vi.mocked(loadChainFacts).mockResolvedValue({ prescription: { read: 'ok', value: null } } as never)
    const out = parse(await readPrescriptionProgress.handler({ prescription_id: 'p1' }, ctxWithRow(null)))
    expect(out.read).toBe('读不到')
    expect(dialogLogs()[0]).toMatchObject({ outcome: 'unread', read_only: true })
  })

  it('没权限 → 读不到，且不取数、不写库', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue(noAccess)
    const probe = ctxWithLatest('p-latest')
    const out = parse(await readPrescriptionProgress.handler({ prescription_id: 'p1' }, probe.ctx))
    expect(out.read).toBe('读不到')
    expect(loadChainFacts).not.toHaveBeenCalled()
    expect(probe.limitCalls()).toBe(0)
    expect(dialogLogs()[0]).toMatchObject({ outcome: 'denied', read_only: true })
  })

  it('取数抛错 → 读不到，不填默认值', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue(okAccess)
    vi.mocked(loadChainFacts).mockRejectedValue(new Error('boom'))
    const out = parse(await readPrescriptionProgress.handler({ prescription_id: 'p1' }, ctxWithRow(null)))
    expect(out).toEqual({ read: '读不到', reason: '读取出错' })
  })

  it('不传 prescription_id → 用当前客户最新一份已批准或草稿处方', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue(okAccess)
    vi.mocked(loadChainFacts).mockResolvedValue({ prescription: { read: 'ok', value: { id: 'p-latest' } } } as never)
    const probe = ctxWithLatest('p-latest', { id: 'p-latest', status: 'approved' })
    const out = parse(await readPrescriptionProgress.handler({ client_id: 'client-OTHER' }, probe.ctx))
    expect(out.read).toBe('ok')
    expect(loadChainFacts).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      clientId: 'client-A', prescriptionId: 'p-latest',
    }))
    expect(probe.eqs.filter(([col]) => col === 'client_id').map(([, val]) => val)).toEqual(['client-A', 'client-A'])
    expect(probe.eqs.map(([, val]) => val)).not.toContain('client-OTHER')
    expect(probe.ins).toEqual([['status', ['approved', 'draft']]])
    expect(probe.orders).toEqual([['created_at', { ascending: false }]])
    expect(probe.limitCalls()).toBe(1)
  })

  it('不传处方编号且没有可读处方 → 读不到，不取链条', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue(okAccess)
    const probe = ctxWithLatest(null)
    const out = parse(await readPrescriptionProgress.handler({}, probe.ctx))
    expect(out).toEqual({ read: '读不到', reason: '这个客户还没有可读的处方' })
    expect(loadChainFacts).not.toHaveBeenCalled()
  })

  it('prescription_id 不是必填', () => {
    const schema = readPrescriptionProgress.tool.input_schema as { required?: string[] }
    expect(schema.required).toBeUndefined()
    expect(readPlanSeed.tool.input_schema).toEqual(readPrescriptionProgress.tool.input_schema)
  })
})

describe('read_plan_seed', () => {
  it('读得到：返回种子；沿用 plan-seed 的内部账号检查', async () => {
    vi.mocked(requirePlanApproverAccess).mockResolvedValue(okAccess)
    vi.mocked(readPlanSeedForClient).mockResolvedValue({ status: 200, body: { success: true, seed: null, reason: 'none' } })
    const out = parse(await readPlanSeed.handler({ prescription_id: 'p1' }, ctxWithRow(null)))
    expect(out).toMatchObject({ read: 'ok', success: true })
    expect(readPlanSeedForClient).toHaveBeenCalledWith('client-A', 'p1')
    expect(requirePaidClientAccess).not.toHaveBeenCalled()
  })

  it('不传 prescription_id → 用当前客户最新一份', async () => {
    vi.mocked(requirePlanApproverAccess).mockResolvedValue(okAccess)
    vi.mocked(readPlanSeedForClient).mockResolvedValue({ status: 200, body: { success: true, seed: null } })
    const probe = ctxWithLatest('p-latest')
    const out = parse(await readPlanSeed.handler({}, probe.ctx))
    expect(out.read).toBe('ok')
    expect(readPlanSeedForClient).toHaveBeenCalledWith('client-A', 'p-latest')
    expect(probe.eqs).toEqual([['client_id', 'client-A']])
  })

  it('非内部账号 → 读不到，不算种子、不查处方', async () => {
    vi.mocked(requirePlanApproverAccess).mockResolvedValue(noAccess)
    const probe = ctxWithLatest('p-latest')
    const out = parse(await readPlanSeed.handler({}, probe.ctx))
    expect(out.read).toBe('读不到')
    expect(readPlanSeedForClient).not.toHaveBeenCalled()
    expect(probe.limitCalls()).toBe(0)
  })

  it('算不出 → 读不到', async () => {
    vi.mocked(requirePlanApproverAccess).mockResolvedValue(okAccess)
    vi.mocked(readPlanSeedForClient).mockResolvedValue({ status: 500, body: { success: false, error: '算不出' } })
    const out = parse(await readPlanSeed.handler({ prescription_id: 'p1' }, ctxWithRow(null)))
    expect(out).toEqual({ read: '读不到', reason: '算不出' })
  })

  it('没有可读处方 → 读不到，不算种子', async () => {
    vi.mocked(requirePlanApproverAccess).mockResolvedValue(okAccess)
    const out = parse(await readPlanSeed.handler({}, ctxWithLatest(null).ctx))
    expect(out).toEqual({ read: '读不到', reason: '这个客户还没有可读的处方' })
    expect(readPlanSeedForClient).not.toHaveBeenCalled()
  })
})

describe('read_spend_and_leads', () => {
  const gate = (key: string) => ({ key, status: 'green', reason: 'r', as_of: 't', how: '', evidence: {}, hard: true })

  it('读得到：只返回线索进 CRM 与花费两道门', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue(okAccess)
    vi.mocked(loadTrackingGateFacts).mockResolvedValue({
      client_id: 'client-A',
      receipt: { checked_at: 'T', gates: [gate('tracking.lead_reaches_crm'), gate('env.account_billing'), gate('tracking.pixel_alive')] },
    } as never)
    const out = parse(await readSpendAndLeads.handler({}, ctxWithRow(null)))
    expect(out.read).toBe('ok')
    expect((out.gates as { key: string }[]).map(g => g.key)).toEqual(['tracking.lead_reaches_crm', 'env.account_billing'])
  })

  it('没配置追踪检查 → 读不到', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue(okAccess)
    vi.mocked(loadTrackingGateFacts).mockResolvedValue(undefined)
    expect(parse(await readSpendAndLeads.handler({}, ctxWithRow(null))).read).toBe('读不到')
  })

  it('没有回执 → 读不到', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue(okAccess)
    vi.mocked(loadTrackingGateFacts).mockResolvedValue({ client_id: 'client-A', receipt: null } as never)
    expect(parse(await readSpendAndLeads.handler({}, ctxWithRow(null))).read).toBe('读不到')
  })

  it('日志失败不影响返回，且仍然不写库', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue(okAccess)
    vi.mocked(loadTrackingGateFacts).mockResolvedValue(undefined)
    vi.mocked(console.info).mockImplementation(() => { throw new Error('log down') })
    expect(parse(await readSpendAndLeads.handler({}, ctxWithRow(null))).read).toBe('读不到')
  })
})
