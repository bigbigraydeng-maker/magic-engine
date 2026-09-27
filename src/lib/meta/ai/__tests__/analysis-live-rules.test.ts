import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), metaGraphGet: vi.fn(), callClaudeChat: vi.fn(), activeConnection: vi.fn(),
  reserveRead: vi.fn(), requirePilot: vi.fn(), runLiveRules: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc } }))
vi.mock('@/lib/anthropic/client', () => ({ MODEL_HAIKU: 'claude-haiku-test', callClaudeChat: mocks.callClaudeChat }))
vi.mock('../store', () => ({ activeConnectionForPrincipal: mocks.activeConnection, reserveRead: mocks.reserveRead }))
vi.mock('../entitlement', () => ({ requirePilotActive: mocks.requirePilot }))
vi.mock('../live-rules', () => ({ runLiveRules: mocks.runLiveRules, LIVE_RULES_BUDGET_MS: 15_000 }))
vi.mock('../../graph-read', async () => {
  const actual = await vi.importActual<typeof import('../../graph-read')>('../../graph-read')
  return { ...actual, metaGraphGet: mocks.metaGraphGet }
})

import { generateAnalysis } from '../analysis'
import type { RuleSectionInput } from '@/lib/ads-strategy/rules/client-copy'

const CLIENT = 'a1000000-0000-4000-8000-000000000001'
const PRINCIPAL = '50000000-0000-4000-8000-000000000001'
const grant = { id: '10000000-0000-4000-8000-000000000001', connection_id: '20000000-0000-4000-8000-000000000001',
  ad_account_id: 'act_1234567890', revision: '30000000-0000-4000-8000-000000000001', entitlement_revision: '40000000-0000-4000-8000-000000000001' }

/** How many patrol rows the client has ever had (null = the count query fails). */
let patrolRowsEver: number | null = 0
/** clients.source; null = the clients read fails. */
let clientSource: 'self_serve' | 'fde' | null = 'self_serve'
let patrolRecentRows: unknown[] = []

function thenable<T>(chain: Record<string, unknown>, result: () => T) {
  chain.then = (resolve: (v: T) => unknown) => Promise.resolve(result()).then(resolve)
  return chain
}

function query(table: string) {
  const chain: Record<string, unknown> = {}
  let head = false
  for (const method of ['eq', 'is', 'order', 'limit', 'gte']) chain[method] = vi.fn(() => chain)
  chain.select = vi.fn((_cols: string, opts?: { head?: boolean }) => { head = opts?.head === true; return chain })
  chain.maybeSingle = vi.fn(async () => ({
    data: table === 'clients' ? (clientSource === null ? null : { source: clientSource }) : table === 'meta_ads_ai_sponsored_budgets' ? null : grant,
    error: table === 'clients' && clientSource === null ? { message: 'down' } : null,
  }))
  chain.single = vi.fn(async () => ({ data: table === 'meta_ads_ai_pilot_entitlements'
    ? { sponsored_analysis_enabled: true, sponsored_monthly_cap_usd: 1, sponsored_analysis_reserve_usd: 0.12 }
    : { id: 'job-1', status: 'completed', ad_account_id: grant.ad_account_id, window_since: '2026-09-13', window_until: '2026-09-19',
      report_markdown: '中文报告', error_code: null, created_at: '2026-09-20T00:00:00Z', completed_at: '2026-09-20T00:01:00Z' }, error: null }))
  if (table === 'ads_growth_states') {
    return thenable(chain, () => (head
      ? (patrolRowsEver === null ? { count: null, error: { message: 'down' } } : { count: patrolRowsEver, error: null })
      : { data: patrolRecentRows, error: null }))
  }
  return chain
}

const LIVE: RuleSectionInput = { source: 'live', dataDate: '2026-09-19', adsChecked: 4, findings: [] }

beforeEach(() => {
  vi.clearAllMocks()
  patrolRowsEver = 0
  clientSource = 'self_serve'
  patrolRecentRows = []
  mocks.from.mockImplementation((table: string) => query(table))
  mocks.requirePilot.mockResolvedValue({ revision: grant.entitlement_revision, new_actions_allowed: true })
  mocks.activeConnection.mockResolvedValue({ token: 'tok', version: 'v1', entitlementRevision: grant.entitlement_revision })
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'meta_ads_reserve_sponsored_analysis') return { data: { reserved: true, idempotent: false, job_id: 'job-1', reserve_usd: 0.12 }, error: null }
    if (name === 'meta_ads_authorize_sponsored_analysis') return { data: true, error: null }
    if (name === 'meta_ads_finish_sponsored_analysis') return { data: true, error: null }
    return { data: null, error: { message: 'unexpected rpc' } }
  })
  mocks.metaGraphGet.mockImplementation(async (path: string, _token: string, params: Record<string, string>) => {
    if (path === grant.ad_account_id) return { id: grant.ad_account_id, currency: 'NZD', timezone_name: 'Pacific/Auckland' }
    if (params.level === 'account') return { data: [{ spend: '100', impressions: '1000', clicks: '20' }] }
    return { data: [] }
  })
  mocks.callClaudeChat.mockResolvedValue({ text: '一、总体结果\n花费 100。\n四、版位\n数据不足。', input_tokens: 1, output_tokens: 1, cost_usd: 0.001, stop_reason: 'end_turn' })
  mocks.runLiveRules.mockResolvedValue(LIVE)
})

function finishArgs(): Record<string, unknown> {
  const call = mocks.rpc.mock.calls.find(c => c[0] === 'meta_ads_finish_sponsored_analysis')
  return (call?.[1] ?? {}) as Record<string, unknown>
}
const prompt = () => String(mocks.callClaudeChat.mock.calls[0]?.[0].systemPrompt)

describe('现场算只给不在巡检名单的客户', () => {
  it('自助注册、巡检从没跑过 → 现场算，用客户自己的只读授权和报告窗口的最后一天；提示词换成老板自己能试的口吻', async () => {
    await generateAnalysis(CLIENT, PRINCIPAL, grant.id)
    expect(mocks.runLiveRules).toHaveBeenCalledTimes(1)
    const args = mocks.runLiveRules.mock.calls[0][0] as Record<string, unknown>
    expect(args).toMatchObject({ clientId: CLIENT, adAccountId: grant.ad_account_id, token: 'tok', currency: 'NZD', timezone: 'Pacific/Auckland' })
    expect(args.windowUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const budget = mocks.runLiveRules.mock.calls[0][1] as number
    expect(budget).toBeGreaterThan(0)
    expect(budget).toBeLessThanOrEqual(15_000)
    expect(prompt()).toContain('老板自己可以试的一小步')
    expect(prompt()).not.toContain('和广告团队商量')
    const evidence = finishArgs().evidence_payload as Record<string, unknown>
    expect(evidence.rule_section).toEqual(LIVE)
    expect(evidence.report_voice).toBe('self_serve')
    expect(String(finishArgs().report_body)).toContain('看了 4 条在花钱的广告')
  })

  it('巡检跑过（只是最近 14 天没有这个账户的记录，例如主账户清空、副账户仍在巡检）→ 不现场覆盖，照旧写原因，代管口吻', async () => {
    patrolRowsEver = 12
    await generateAnalysis(CLIENT, PRINCIPAL, grant.id)
    expect(mocks.runLiveRules).not.toHaveBeenCalled()
    expect(prompt()).toContain('和广告团队商量')
    const evidence = finishArgs().evidence_payload as Record<string, unknown>
    expect(evidence.rule_section).toEqual({ source: 'none', reason: 'not_connected' })
    expect(evidence.report_voice).toBe('managed')
  })

  it('巡检有别的结论（例如过期）→ 不现场算，也不去查从没跑过', async () => {
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10)
    patrolRecentRows = [{ client_id: CLIENT, date: old, payload: { dataCompleteness: 'complete',
      adLevelCoverage: [{ adAccountId: grant.ad_account_id, ran: true, reason: 'ok', adsChecked: 2 }], problems: [] } }]
    await generateAnalysis(CLIENT, PRINCIPAL, grant.id)
    expect(mocks.runLiveRules).not.toHaveBeenCalled()
    expect((finishArgs().evidence_payload as Record<string, unknown>).report_voice).toBe('managed')
  })

  it('查巡检记录数失败 → 不现场算，第三部分写「没拿到数据」，自助口吻（不退回「还没接入每日检查 / 和团队商量」）', async () => {
    patrolRowsEver = null
    await generateAnalysis(CLIENT, PRINCIPAL, grant.id)
    expect(mocks.runLiveRules).not.toHaveBeenCalled()
    const evidence = finishArgs().evidence_payload as Record<string, unknown>
    expect(evidence.rule_section).toEqual({ source: 'none', reason: 'live_unavailable' })
    expect(evidence.report_voice).toBe('self_serve')
    expect(prompt()).not.toContain('和广告团队商量')
  })

  it('自助口吻的提示词：不再写「不建议修改广告」，并要求结尾不写邀请语；代管提示词不变', async () => {
    await generateAnalysis(CLIENT, PRINCIPAL, grant.id)
    expect(prompt()).not.toContain('不建议或声称已修改广告')
    expect(prompt()).toContain('不声称已经修改过广告')
    expect(prompt()).toContain('结尾不要写“联系我们”或任何邀请的话')
    patrolRowsEver = 3
    vi.clearAllMocks()
    mocks.from.mockImplementation((table: string) => query(table))
    await generateAnalysis(CLIENT, PRINCIPAL, grant.id)
    expect(prompt()).toContain('不建议或声称已修改广告')
    expect(prompt()).not.toContain('结尾不要写“联系我们”')
  })
  it('代管客户（来源 fde）即使一条巡检记录都没有（例如广告引擎开关关着）→ 不现场算，代管口吻（魏征 B1）', async () => {
    clientSource = 'fde'
    patrolRowsEver = 0
    await generateAnalysis(CLIENT, PRINCIPAL, grant.id)
    expect(mocks.runLiveRules).not.toHaveBeenCalled()
    expect((finishArgs().evidence_payload as Record<string, unknown>).report_voice).toBe('managed')
    expect(prompt()).toContain('和广告团队商量')
  })

  it('连客户来源都读不到 → 不现场算，写「没拿到数据」，按代管口吻（不对可能的付费客户说「我们不会动你的广告」）', async () => {
    clientSource = null
    await generateAnalysis(CLIENT, PRINCIPAL, grant.id)
    expect(mocks.runLiveRules).not.toHaveBeenCalled()
    const evidence = finishArgs().evidence_payload as Record<string, unknown>
    expect(evidence.rule_section).toEqual({ source: 'none', reason: 'live_unavailable' })
    expect(evidence.report_voice).toBe('managed')
  })
})
