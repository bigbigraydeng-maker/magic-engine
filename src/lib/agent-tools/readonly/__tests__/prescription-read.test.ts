/**
 * 诸葛抽屉三个只读工具：读得到 / 读不到 / 没权限，以及每次调用都记一条动作记录。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

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
    supabase: { from: () => q } as unknown as ReadonlyToolContext['supabase'],
  }
}

const parse = (s: string) => JSON.parse(s) as Record<string, unknown>
const recorded = () => vi.mocked(insertRun).mock.calls.map(c => c[1])

beforeEach(() => vi.resetAllMocks())

describe('read_prescription_progress', () => {
  it('读得到：返回处方 + 走到哪一步，并记 succeeded 动作记录', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue(okAccess)
    vi.mocked(loadChainFacts).mockResolvedValue({ prescription: { read: 'ok', value: { id: 'p1' } } } as never)
    const out = parse(await readPrescriptionProgress.handler({ prescription_id: 'p1' }, ctxWithRow({ id: 'p1', status: 'approved' })))
    expect(out.read).toBe('ok')
    expect(recorded()).toHaveLength(1)
    expect(recorded()[0]).toMatchObject({
      client_id: 'client-A', action_key: 'zhuge.read_prescription_progress',
      triggered_by: 'agent', triggered_by_ref: 'zhuge_dialog', status: 'succeeded',
    })
  })

  it('处方不存在 → 读不到', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue(okAccess)
    vi.mocked(loadChainFacts).mockResolvedValue({ prescription: { read: 'ok', value: null } } as never)
    const out = parse(await readPrescriptionProgress.handler({ prescription_id: 'p1' }, ctxWithRow(null)))
    expect(out.read).toBe('读不到')
    expect(recorded()[0]).toMatchObject({ status: 'failed', last_error: 'read_unread' })
  })

  it('没权限 → 读不到，且不取数', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue(noAccess)
    const out = parse(await readPrescriptionProgress.handler({ prescription_id: 'p1' }, ctxWithRow(null)))
    expect(out.read).toBe('读不到')
    expect(loadChainFacts).not.toHaveBeenCalled()
    expect(recorded()[0]).toMatchObject({ last_error: 'read_denied' })
  })

  it('取数抛错 → 读不到，不填默认值', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue(okAccess)
    vi.mocked(loadChainFacts).mockRejectedValue(new Error('boom'))
    const out = parse(await readPrescriptionProgress.handler({ prescription_id: 'p1' }, ctxWithRow(null)))
    expect(out).toEqual({ read: '读不到', reason: '读取出错' })
  })

  it('缺 prescription_id → 读不到', async () => {
    const out = parse(await readPrescriptionProgress.handler({}, ctxWithRow(null)))
    expect(out.read).toBe('读不到')
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

  it('非内部账号 → 读不到，不算种子', async () => {
    vi.mocked(requirePlanApproverAccess).mockResolvedValue(noAccess)
    const out = parse(await readPlanSeed.handler({ prescription_id: 'p1' }, ctxWithRow(null)))
    expect(out.read).toBe('读不到')
    expect(readPlanSeedForClient).not.toHaveBeenCalled()
  })

  it('算不出 → 读不到', async () => {
    vi.mocked(requirePlanApproverAccess).mockResolvedValue(okAccess)
    vi.mocked(readPlanSeedForClient).mockResolvedValue({ status: 500, body: { success: false, error: '算不出' } })
    const out = parse(await readPlanSeed.handler({ prescription_id: 'p1' }, ctxWithRow(null)))
    expect(out).toEqual({ read: '读不到', reason: '算不出' })
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

  it('记录失败不影响返回', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue(okAccess)
    vi.mocked(loadTrackingGateFacts).mockResolvedValue(undefined)
    vi.mocked(insertRun).mockRejectedValueOnce(new Error('db down'))
    expect(parse(await readSpendAndLeads.handler({}, ctxWithRow(null))).read).toBe('读不到')
  })
})
