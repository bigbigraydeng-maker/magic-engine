/**
 * 推广计划接口：保存（服务端校验）/ 人工核实 / 每周确认 / 批准前检查清单。
 * 数据读取层（facts）用假实现，这里只验证路由的决策。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { baseSpec, goodFacts, goodReconFacts } from '@/lib/marketing-plan/promo/__tests__/fixtures'
import { promoContentHash } from '@/lib/marketing-plan/promo/content-hash'

const m = vi.hoisted(() => ({
  access: vi.fn(),
  loadGoal: vi.fn(),
  loadPromoFacts: vi.fn(),
  loadOptions: vi.fn(),
  liveAds: vi.fn(),
  dispatch: vi.fn(),
  plan: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
  updateFilters: [] as [string, unknown][],
  casMiss: false,
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: m.access, requirePlanApproverAccess: m.access }))
vi.mock('@/lib/marketing-plan/task-dispatcher', () => ({ dispatchPlanTasks: m.dispatch, revokePlanTasks: vi.fn() }))
vi.mock('@/lib/marketing-plan/promo/facts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/marketing-plan/promo/facts')>('@/lib/marketing-plan/promo/facts')
  return { ...actual, loadGoal: m.loadGoal, loadPromoFacts: m.loadPromoFacts }
})
vi.mock('@/lib/marketing-plan/promo/options', () => ({ loadPromoOptions: m.loadOptions }))
vi.mock('@/lib/marketing-plan/promo/live-ads', () => ({ loadLiveAds: m.liveAds }))
vi.mock('@/lib/supabase', () => {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.eq = (col: string, val: unknown) => { m.updateFilters.push([col, val]); return c }
    c.single = async () => ({ data: m.plan, error: null })
    c.maybeSingle = async () => {
      // 模拟落库时被别处抢先改过：update 之后返回空
      if (m.casMiss && c.updated) return { data: null, error: null }
      return { data: m.plan, error: null }
    }
    c.update = (u: Record<string, unknown>) => { c.updated = true; m.updates.push(u); m.plan = { ...(m.plan ?? {}), ...u }; return c }
    return c
  }
  return { supabaseAdmin: { from: () => chain() } }
})

import { GET, PUT } from '../route'
import { POST as VERIFY } from '../verify/route'
import { POST as ACK } from '../acknowledge/route'
import { POST as APPROVE } from '../../approve/route'

const P = { id: 'client-1', planId: 'plan-1' }
const req = (body: unknown, method = 'POST') =>
  new NextRequest('http://localhost/x', method === 'GET' ? { method } : { method, body: JSON.stringify(body) })
const planWith = (promo: unknown, extra: Record<string, unknown> = {}) => ({
  id: 'plan-1', client_id: 'client-1', status: 'draft', generation_meta: null,
  plan_data: { social: {}, blog: { monthly_count: 0, topics: [] }, kpis: {}, tasks: [], ...(promo === undefined ? {} : { promo }) },
  ...extra,
})
const verifiedChecks = (spec = baseSpec()) => ['landing.item_live', 'content.wording_permission'].map(k => ({
  phase_id: 'p1', check_key: k, verified_by: 'fde@example.com', verified_at: '2026-10-28T00:00:00Z', note: '', content_hash: promoContentHash(spec) }))
const loadedFacts = (gate = goodFacts(), recon = goodReconFacts()) => ({
  playbook: gate.playbook, today: '2026-11-12', timezone_known: true, gate, recon,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.updates = []; m.updateFilters = []; m.casMiss = false
  m.access.mockResolvedValue({ ok: true, user: { email: 'fde@example.com' } })
  m.loadGoal.mockResolvedValue({ status: 'active' })
  m.loadPromoFacts.mockResolvedValue(loadedFacts())
  m.loadOptions.mockResolvedValue({ goals: [{ id: 'g1', title: '目标一', period_start: '2026-11-01', period_end: '2026-12-31' }], accounts: [{ id: 'act_1', cap_cents: null }] })
  m.dispatch.mockResolvedValue({ marketing_plan_id: 'plan-1', tasks_created: 0, tasks_skipped: 0, task_ids: [], packages_created: 0, package_ids: [] })
  m.plan = planWith(undefined)
})

describe('PUT promo — 保存时服务端校验', () => {
  it('合法结构：写进 plan_data.promo，且只在草稿时写（带 status=draft 条件）', async () => {
    const res = await PUT(req({ promo: baseSpec() }, 'PUT'), { params: P })
    expect(res.status).toBe(200)
    expect((m.updates[0].plan_data as { promo: unknown }).promo).toBeTruthy()
    expect(m.updateFilters).toContainEqual(['status', 'draft'])
    expect(m.updateFilters).toContainEqual(['client_id', 'client-1'])
  })
  it('结构不合法 → 400，带问题清单，不写库', async () => {
    const res = await PUT(req({ promo: { schema: 'promo_v1' } }, 'PUT'), { params: P })
    expect(res.status).toBe(400)
    expect((await res.json()).issues.length).toBeGreaterThan(0)
    expect(m.updates).toHaveLength(0)
  })
  it('目标不属于这个客户 → 400', async () => {
    m.loadGoal.mockResolvedValue(null)
    const res = await PUT(req({ promo: baseSpec() }, 'PUT'), { params: P })
    expect(res.status).toBe(400)
    expect(m.loadGoal).toHaveBeenCalledWith('client-1', 'goal-1')
    expect(m.updates).toHaveLength(0)
  })
  it('广告账户不属于这个客户 → 400', async () => {
    const gate = goodFacts({ accounts: [{ ad_account_id: 'act_1', currency: 'AUD', daily_cap_cents: 10000, owned_by_client: false }] })
    m.loadPromoFacts.mockResolvedValue(loadedFacts(gate))
    const res = await PUT(req({ promo: baseSpec() }, 'PUT'), { params: P })
    expect(res.status).toBe(400)
    expect(m.updates).toHaveLength(0)
  })
  it('预算超账户上限 → 400', async () => {
    const gate = goodFacts({ accounts: [{ ad_account_id: 'act_1', currency: 'AUD', daily_cap_cents: 100, owned_by_client: true }] })
    m.loadPromoFacts.mockResolvedValue(loadedFacts(gate))
    expect((await PUT(req({ promo: baseSpec() }, 'PUT'), { params: P })).status).toBe(400)
  })
  it('上限读不到只是未核实：允许保存（批准时由检查清单挡）', async () => {
    const gate = goodFacts({ config: null })
    m.loadPromoFacts.mockResolvedValue(loadedFacts(gate))
    expect((await PUT(req({ promo: baseSpec() }, 'PUT'), { params: P })).status).toBe(200)
  })
  it.each(['approved', 'completed'])('计划是 %s → 409（内容被锁）', async (status) => {
    m.plan = planWith(undefined, { status })
    expect((await PUT(req({ promo: baseSpec() }, 'PUT'), { params: P })).status).toBe(409)
    expect(m.updates).toHaveLength(0)
  })
  it('归档计划 → 409', async () => {
    m.plan = planWith(undefined, { status: 'archived' })
    expect((await PUT(req({ promo: baseSpec() }, 'PUT'), { params: P })).status).toBe(409)
  })
  it('没权限 → 原样返回', async () => {
    m.access.mockResolvedValue({ ok: false, status: 403, error: 'no' })
    expect((await PUT(req({ promo: baseSpec() }, 'PUT'), { params: P })).status).toBe(403)
  })
  it('expected_updated_at 与库里不一致 → 409，不写库', async () => {
    m.plan = planWith(undefined, { updated_at: '2026-11-01T00:00:00Z' })
    const res = await PUT(req({ promo: baseSpec(), expected_updated_at: '2026-10-01T00:00:00Z' }, 'PUT'), { params: P })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('别处被改过')
    expect(m.updates).toHaveLength(0)
  })
  it('落库时 update 返回空（别处抢先改了）→ 409 而不是 500', async () => {
    m.plan = planWith(undefined, { updated_at: '2026-11-01T00:00:00Z' })
    m.casMiss = true
    const res = await PUT(req({ promo: baseSpec(), expected_updated_at: '2026-11-01T00:00:00Z' }, 'PUT'), { params: P })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('别处被改过')
  })
})

describe('GET promo — 在跑广告提示只给内部账号', () => {
  beforeEach(() => { m.liveAds.mockResolvedValue({ ok: true, live_adsets: 1, spending_adsets: 1, by_account: [], currency: 'NZD', as_of: null, snapshot_age_hours: 0 }) })
  it('内部账号（admin）：草稿计划返回 live_ads', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', user: { email: 'fde@example.com' } })
    const json = await (await GET(req(null, 'GET'), { params: P })).json()
    expect(json.live_ads_visible).toBe(true)
    expect(json.live_ads.ok).toBe(true)
    expect(m.liveAds).toHaveBeenCalledWith('client-1')
  })
  it('付费客户账号：不读也不返回 live_ads', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'paid_client', user: { email: 'boss@client.example' } })
    const json = await (await GET(req(null, 'GET'), { params: P })).json()
    expect(json.live_ads_visible).toBe(false)
    expect(json.live_ads).toBeNull()
    expect(m.liveAds).not.toHaveBeenCalled()
  })
  it('已批准的计划：内部账号也不读', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', user: { email: 'fde@example.com' } })
    m.plan = planWith(undefined, { status: 'approved' })
    const json = await (await GET(req(null, 'GET'), { params: P })).json()
    expect(json.live_ads).toBeNull()
    expect(m.liveAds).not.toHaveBeenCalled()
  })
})

describe('GET promo — 一页纸', () => {
  it('旧计划：has_promo=false，不读任何事实', async () => {
    const json = await (await GET(req(null, 'GET'), { params: P })).json()
    expect(json.board.has_promo).toBe(false)
    expect(m.loadPromoFacts).not.toHaveBeenCalled()
  })
  it('同时返回填表用的选项，并且只按路径里的客户去读', async () => {
    const json = await (await GET(req(null, 'GET'), { params: P })).json()
    expect(json.options.goals[0].id).toBe('g1')
    expect(m.loadOptions).toHaveBeenCalledWith('client-1')
  })
  it('已批准的计划不读填表选项；选项读取失败也不拖垮整页', async () => {
    m.plan = planWith(undefined, { status: 'approved' })
    const approved = await (await GET(req(null, 'GET'), { params: P })).json()
    expect(approved.options).toBeNull()
    expect(m.loadOptions).not.toHaveBeenCalled()
    m.plan = planWith(undefined)
    m.loadOptions.mockRejectedValue(new Error('db down'))
    const res = await GET(req(null, 'GET'), { params: P })
    expect(res.status).toBe(200)
    expect((await res.json()).options).toBeNull()
  })
  it('畸形 promo：spec_valid=false 且带问题，不放行', async () => {
    m.plan = planWith({ schema: 'promo_v1' })
    const json = await (await GET(req(null, 'GET'), { params: P })).json()
    expect(json.board).toMatchObject({ has_promo: true, spec_valid: false })
    expect(json.board.issues.length).toBeGreaterThan(0)
    expect(json.board.approval).toBeNull()
  })
  it('合法 promo：给出批准检查、下一阶段灯和对账头条', async () => {
    m.plan = planWith(baseSpec())
    const json = await (await GET(req(null, 'GET'), { params: P })).json()
    expect(json.board.spec_valid).toBe(true)
    expect(json.board.approval.can_approve).toBe(false) // 落地页还没人核实 → 灰 → 阻止
    expect(json.board.next_phase.phase.id).toBe('p1')
    expect(typeof json.board.reconcile.headline).toBe('string')
  })
  it('计划不存在 → 404', async () => {
    m.plan = null
    expect((await GET(req(null, 'GET'), { params: P })).status).toBe(404)
  })
})

describe('POST verify — 人工核实', () => {
  beforeEach(() => { m.plan = planWith(baseSpec()) })
  it('记到 generation_meta.promo_checks，带核实人与时间', async () => {
    const res = await VERIFY(req({ phase_id: 'p1', check_key: 'landing.item_live', note: '已逐项对过官网' }), { params: P })
    expect(res.status).toBe(200)
    const meta = m.updates[0].generation_meta as { promo_checks: Record<string, string>[] }
    expect(meta.promo_checks[0]).toMatchObject({ phase_id: 'p1', check_key: 'landing.item_live', verified_by: 'fde@example.com' })
  })
  it('只有人工项可以核实；读得到的项（如账户可用）不行', async () => {
    expect((await VERIFY(req({ phase_id: 'p1', check_key: 'ads.account_usable' }), { params: P })).status).toBe(400)
    expect(m.updates).toHaveLength(0)
  })
  it('阶段不存在 / 计划没有推广结构 → 400', async () => {
    expect((await VERIFY(req({ phase_id: 'nope', check_key: 'landing.item_live' }), { params: P })).status).toBe(400)
    m.plan = planWith(undefined)
    expect((await VERIFY(req({ phase_id: 'p1', check_key: 'landing.item_live' }), { params: P })).status).toBe(400)
  })
  it('计划已批准后仍可补核实（后面阶段要用）', async () => {
    m.plan = planWith(baseSpec(), { status: 'approved' })
    expect((await VERIFY(req({ phase_id: 'p1', check_key: 'landing.item_live' }), { params: P })).status).toBe(200)
  })
  it('没有广告步骤的阶段不能点核实 → 400，不写库', async () => {
    // baseSpec 的 p2 没有任何步骤
    expect((await VERIFY(req({ phase_id: 'p2', check_key: 'landing.item_live' }), { params: P })).status).toBe(400)
    expect(m.updates).toHaveLength(0)
  })
  it('核实记录带上当时的内容指纹', async () => {
    await VERIFY(req({ phase_id: 'p1', check_key: 'landing.item_live' }), { params: P })
    const meta = m.updates[0].generation_meta as { promo_checks: { content_hash?: string }[] }
    expect(meta.promo_checks[0].content_hash).toBe(promoContentHash(baseSpec()))
  })
  it('落库时被别处抢先改过 → 409，不当成功', async () => {
    m.casMiss = true
    const res = await VERIFY(req({ phase_id: 'p1', check_key: 'landing.item_live' }), { params: P })
    expect(res.status).toBe(409)
  })
  it('归档 → 409', async () => {
    m.plan = planWith(baseSpec(), { status: 'archived' })
    expect((await VERIFY(req({ phase_id: 'p1', check_key: 'landing.item_live' }), { params: P })).status).toBe(409)
  })
})

const approvedWithFingerprint = () => planWith(baseSpec(), {
  status: 'approved',
  generation_meta: { approval_receipt: { content_hash: promoContentHash(baseSpec()) } },
})

describe('POST acknowledge — 按计划继续', () => {
  const onTrackSpend = () => {
    const days: Record<string, number> = {}
    for (let d = 4; d <= 10; d++) days[`2026-11-${String(d).padStart(2, '0')}`] = 5000
    return { act_1: days }
  }
  beforeEach(() => { m.loadPromoFacts.mockResolvedValue(loadedFacts(goodFacts({ manual_checks: verifiedChecks() }), goodReconFacts({ spend_cents_by_account_day: onTrackSpend() }))) })
  it('对账落后 / 看不清时 → 409，不留"没意见"记录', async () => {
    m.loadPromoFacts.mockResolvedValue(loadedFacts(goodFacts(), goodReconFacts({ spend_cents_by_account_day: { act_1: {} } })))
    m.plan = approvedWithFingerprint()
    expect((await ACK(req({}), { params: P })).status).toBe(409)
    expect(m.updates).toHaveLength(0)
  })
  it('批准记录里没有内容版本（没法确认批的是哪一版）→ 409，不留"没意见"记录', async () => {
    m.plan = planWith(baseSpec(), { status: 'approved' })
    const res = await ACK(req({}), { params: P })
    expect(res.status).toBe(409)
    expect(m.updates).toHaveLength(0)
  })
  it('到期阶段的检查清单没过关（人工核实还是灰）→ 409，不留"没意见"记录', async () => {
    m.loadPromoFacts.mockResolvedValue(loadedFacts(goodFacts(), goodReconFacts({ spend_cents_by_account_day: onTrackSpend() })))
    m.plan = approvedWithFingerprint()
    const res = await ACK(req({}), { params: P })
    expect(res.status).toBe(409)
    expect(m.updates).toHaveLength(0)
  })
  it('只在已批准时可点；记一条，按窗口起始日幂等', async () => {
    m.plan = planWith(baseSpec(), { status: 'draft' })
    expect((await ACK(req({}), { params: P })).status).toBe(409)

    m.plan = approvedWithFingerprint()
    const first = await (await ACK(req({}), { params: P })).json()
    expect(first.success).toBe(true)
    expect(first.record.week_start).toBe('2026-11-04')
    expect(m.updates).toHaveLength(1)

    const second = await (await ACK(req({}), { params: P })).json()
    expect(second.already_recorded).toBe(true)
    expect(m.updates).toHaveLength(1) // 没有再写
  })
  it('不改计划内容：写的只有 generation_meta', async () => {
    m.plan = approvedWithFingerprint()
    await ACK(req({}), { params: P })
    expect(Object.keys(m.updates[0])).toEqual(['generation_meta'])
  })
  it('没有推广结构 → 400', async () => {
    m.plan = planWith(undefined, { status: 'approved' })
    expect((await ACK(req({}), { params: P })).status).toBe(400)
  })
})

describe('POST approve — 推广计划批准前检查', () => {
  it('第一阶段硬门没过 → 409 并说清哪一项、怎么办；不派发、不改状态', async () => {
    m.plan = planWith(baseSpec())
    const res = await APPROVE(req({}), { params: P })
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.blockers.map((b: { key: string }) => b.key)).toContain('landing.item_live')
    expect(json.blockers[0].how.length).toBeGreaterThan(0)
    expect(m.dispatch).not.toHaveBeenCalled()
    expect(m.updates).toHaveLength(0)
  })
  it('全部过关 → 批准，并把批准当时的灯快照写进回执', async () => {
    const spec = baseSpec()
    m.loadPromoFacts.mockResolvedValue(loadedFacts(goodFacts({ manual_checks: verifiedChecks() })))
    m.plan = planWith(spec)
    const res = await APPROVE(req({}), { params: P })
    expect(res.status).toBe(200)
    const meta = m.updates[0].generation_meta as { approval_receipt: { gate_snapshot: { results: { key: string; light: string }[] } } }
    expect(m.updates[0].status).toBe('approved')
    expect(meta.approval_receipt.gate_snapshot.results.map(r => r.key)).toContain('ads.budget_within_caps')
    // 通过项也要留在快照里，否则全部通过的批准会留下空快照
    expect(meta.approval_receipt.gate_snapshot.results.some(r => r.light === 'green')).toBe(true)
  })
  it('带推广结构的计划：批准时不派老任务，旧任务里没有推广步骤编号也不挡批准', async () => {
    m.loadPromoFacts.mockResolvedValue(loadedFacts(goodFacts({ manual_checks: verifiedChecks() })))
    m.plan = planWith(baseSpec())
    ;(m.plan as { plan_data: { tasks: unknown[] } }).plan_data.tasks = [{ kind: 'blog_article', title: '老任务', description: 'd', due_date: '2026-11-01' }]
    const res = await APPROVE(req({}), { params: P })
    expect(res.status).toBe(200)
    expect(m.dispatch).not.toHaveBeenCalled()
  })
  it('畸形 promo → 400，不批准（fail closed）', async () => {
    m.plan = planWith({ schema: 'promo_v1' })
    expect((await APPROVE(req({}), { params: P })).status).toBe(400)
    expect(m.dispatch).not.toHaveBeenCalled()
  })
  it('后面阶段的红灯不阻止批准', async () => {
    const spec = baseSpec()
    spec.phases[1].steps = [{ id: 'later', kind: 'ads_campaign', settings: {
      ad_account_id: 'act_none', daily_budget_cents: 100, audience_ref: 'a', creative_refs: [], placements: [], paused_ranges: [] } }]
    m.loadPromoFacts.mockResolvedValue(loadedFacts(goodFacts({ manual_checks: verifiedChecks(spec) })))
    m.plan = planWith(spec)
    expect((await APPROVE(req({}), { params: P })).status).toBe(200)
  })
  it('旧版计划（没有 promo）：完全不读事实', async () => {
    m.plan = planWith(undefined)
    expect((await APPROVE(req({}), { params: P })).status).toBe(200)
    expect(m.loadPromoFacts).not.toHaveBeenCalled()
  })
})
