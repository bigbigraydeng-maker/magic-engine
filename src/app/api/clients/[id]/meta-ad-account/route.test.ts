/**
 * PATCH/GET /api/clients/[id]/meta-ad-account — AD-SEC-3 regression suite.
 *
 * The attack (魏征 2026-09-13): client A's staff rebinds A to client B's ad
 * account, then the ownership gate on stop-loss / execute lets A touch B's
 * campaigns through the shared fallback token. What is real vs faked here:
 *   - REAL: requireGlobalAdmin / whitelist env parsing, requireDashboard/
 *     OnboardingClientAccess, token-manager lookup, the binding service, the
 *     duplicate check, audit writes, campaign-ownership.
 *   - FAKED: the session (who is logged in), Supabase (a table-modelled fake that
 *     really filters — see binding-fake-db.ts), and Meta Graph (fetch stub).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { FakeDb, FakeFailures, Row } from '@/lib/meta/__tests__/binding-fake-db'

const h = vi.hoisted(() => ({
  db: {} as FakeDb,
  failures: {} as FakeFailures,
  email: null as string | null,
}))

vi.mock('@/lib/supabase', async () => {
  const { makeBindingFakeDb } = await import('@/lib/meta/__tests__/binding-fake-db')
  return { supabaseAdmin: { from: (t: string) => makeBindingFakeDb(h.db, h.failures).from(t) } }
})
vi.mock('@supabase/supabase-js', async () => {
  const { makeBindingFakeDb } = await import('@/lib/meta/__tests__/binding-fake-db')
  return { createClient: () => ({ from: (t: string) => makeBindingFakeDb(h.db, h.failures).from(t) }) }
})
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: async () =>
    h.email ? { ok: true, user: { id: 'u', email: h.email } } : { ok: false, status: 401, error: 'Unauthorized' },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { GET, PATCH } from './route'
import { assertCampaignOwnedByClient } from '@/lib/meta/campaign-ownership'

const A = 'aaaaaaaa-0000-0000-0000-000000000001'
const B = 'bbbbbbbb-0000-0000-0000-000000000002'
const CTS = 'c0000000-0000-0000-0000-000000000000'
const ACC_A = 'act_1111111111'
const ACC_B = 'act_2222222222'
const ACC_NEW = 'act_3333333333'
const CTS_PERSONAL = 'act_2775766642787274'
const CTS_OFFICIAL = 'act_2202695063810470'

const FDE = 'fde@magiclab.test'
const EMPLOYEE_A = 'staff@client-a.test'
const OWNER_A_SELF_SERVE = 'owner@client-a.test'
const LEGACY_FDE_ROW = 'contractor@client-a.test'
const DB_SCOPED_ADMIN = 'scoped@client-a.test'
const DEMO_ADMIN = 'demo@anywhere.test'
const OUTSIDER = 'random@elsewhere.test'

/** Accounts Graph will say exist → name. Anything else answers HTTP 400. */
let graphAccounts: Record<string, string>
let graphReturnsOtherId = false
const fetchMock = vi.fn(async (input: string | URL) => {
  const url = new URL(String(input))
  const node = url.pathname.split('/').pop() ?? ''
  const fields = url.searchParams.get('fields') ?? ''
  if (node === '120220000000000002') {
    return Response.json({ id: '120220000000000002', name: 'B', status: 'ACTIVE', account_id: ACC_B.slice(4) })
  }
  const digits = node.replace(/^act_/, '')
  if (!(node in graphAccounts)) return new Response('{"error":{"code":100}}', { status: 400 })
  if (fields.startsWith('business')) return new Response('{"error":{"code":200}}', { status: 403 })
  return Response.json({
    id: node, account_id: graphReturnsOtherId ? '9999999999' : digits, name: graphAccounts[node], account_status: 1,
  })
})

const ENV = ['ADMIN_EMAILS', 'ADMIN_EMAIL_DOMAIN', 'DEMO_ADMINS', 'CLIENT_VIEWERS', 'META_SYSTEM_USER_TOKEN'] as const
const savedEnv: Record<string, string | undefined> = {}

function seed(): FakeDb {
  return {
    clients: [
      { id: A, name: 'Client A', domain: null, facebook_page_id: null, meta_ad_account_id: ACC_A },
      { id: B, name: 'Client B', domain: null, facebook_page_id: null, meta_ad_account_id: ACC_B },
      { id: CTS, name: 'CTS Tours', domain: null, facebook_page_id: null, meta_ad_account_id: CTS_PERSONAL },
    ],
    client_meta_ad_accounts: [
      { id: 'm1', client_id: A, ad_account_id: ACC_A, is_primary: true, label: '主账户' },
      { id: 'm2', client_id: B, ad_account_id: ACC_B, is_primary: true, label: '主账户' },
      { id: 'm3', client_id: CTS, ad_account_id: CTS_PERSONAL, is_primary: true, label: '主账户' },
      { id: 'm4', client_id: CTS, ad_account_id: CTS_OFFICIAL, is_primary: false, label: 'CTStours 官方账户（ThruPlay）' },
    ],
    client_portal_users: [
      { email: EMPLOYEE_A, client_id: A, access_type: 'client', scoped_admin: false },
      { email: OWNER_A_SELF_SERVE, client_id: A, access_type: 'self_serve', scoped_admin: false },
      { email: LEGACY_FDE_ROW, client_id: A, access_type: 'fde', scoped_admin: false },
      { email: DB_SCOPED_ADMIN, client_id: A, access_type: 'client', scoped_admin: true },
    ],
    client_binding_audit: [],
  }
}

beforeEach(() => {
  h.db = seed()
  h.failures = {}
  h.email = null
  graphAccounts = { [ACC_A]: 'Client A Ads', [ACC_B]: 'Client B Ads', [ACC_NEW]: 'Client A New Ads', [CTS_OFFICIAL]: 'CTStours' }
  graphReturnsOtherId = false
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  for (const k of ENV) { savedEnv[k] = process.env[k]; delete process.env[k] }
  process.env.ADMIN_EMAILS = FDE
  process.env.DEMO_ADMINS = `${DEMO_ADMIN}:${A}`
  process.env.META_SYSTEM_USER_TOKEN = 'SHARED_FALLBACK_TOKEN'
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ENV) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k] }
})

function patchAs(email: string | null, clientId: string, body: unknown) {
  h.email = email
  return PATCH(
    new NextRequest(`http://localhost/api/clients/${clientId}/meta-ad-account`, { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: clientId }) },
  )
}
function getAs(email: string, clientId: string) {
  h.email = email
  return GET(new NextRequest(`http://localhost/api/clients/${clientId}/meta-ad-account`), { params: Promise.resolve({ id: clientId }) })
}

const primaryOf = (clientId: string) => (h.db.clients.find(c => c.id === clientId) as Row).meta_ad_account_id
const accountRowsOf = (clientId: string) =>
  h.db.client_meta_ad_accounts.filter(r => r.client_id === clientId).map(r => `${r.ad_account_id}:${r.is_primary}`).sort()
const audit = () => h.db.client_binding_audit

function expectBindingUntouched() {
  expect(primaryOf(A)).toBe(ACC_A)
  expect(accountRowsOf(A)).toEqual([`${ACC_A}:true`])
}

describe('非内部员工改绑 → 一律拒绝，绑定一个字都不动', () => {
  it.each([
    ['客户员工（access_type=client）', EMPLOYEE_A],
    ['自助客户老板（self_serve）', OWNER_A_SELF_SERVE],
    ['历史遗留 access_type=fde 成员行（客户可自己发放）', LEGACY_FDE_ROW],
    ['数据库受限管理员（scoped_admin）', DB_SCOPED_ADMIN],
    ['DEMO_ADMINS 演示管理员', DEMO_ADMIN],
  ])('%s 把 A 改成 B 的账户号 → 403，不调 Meta，登记不变，只记一条待核实', async (_label, email) => {
    const res = await patchAs(email, A, { ad_account_id: ACC_B })
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.reason).toBe('fde_verification_required')
    expect(json.request_recorded).toBe(true)
    expectBindingUntouched()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(audit()).toHaveLength(1)
    expect(audit()[0]).toMatchObject({ client_id: A, actor_email: email, outcome: 'requested_by_client', requested_value: ACC_B })
  })

  it('客户员工清空绑定 → 403，不清', async () => {
    const res = await patchAs(EMPLOYEE_A, A, { ad_account_id: null })
    expect(res.status).toBe(403)
    expectBindingUntouched()
    expect(audit()).toHaveLength(0)
  })

  it('客户员工带着 override / preview 参数也不行', async () => {
    const res = await patchAs(EMPLOYEE_A, A, { ad_account_id: ACC_B, preview: true, allow_shared_account: true, override_reason: '我说共用就共用我说共用就共用' })
    expect(res.status).toBe(403)
    expectBindingUntouched()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('不是这个客户成员的登录用户 → 403，不写审计（外人不能往别家待办里塞号）', async () => {
    const res = await patchAs(OUTSIDER, A, { ad_account_id: ACC_B })
    expect(res.status).toBe(403)
    expectBindingUntouched()
    expect(audit()).toHaveLength(0)
  })

  it('没登录 → 401，不写审计', async () => {
    const res = await patchAs(null, A, { ad_account_id: ACC_B })
    expect(res.status).toBe(401)
    expect(audit()).toHaveLength(0)
  })

  it('同一个号还挂着待处理时重复提交（换人也算）→ 只记一条', async () => {
    await patchAs(EMPLOYEE_A, A, { ad_account_id: ACC_NEW })
    await patchAs(EMPLOYEE_A, A, { ad_account_id: ACC_NEW })
    await patchAs(OWNER_A_SELF_SERVE, A, { ad_account_id: ACC_NEW })
    expect(audit()).toHaveLength(1)
  })

  it('轮换号码刷提交 → 每个客户每天最多记 5 条，第 6 条如实回 request_recorded=false', async () => {
    const results: boolean[] = []
    for (let i = 0; i < 6; i++) {
      const res = await patchAs(EMPLOYEE_A, A, { ad_account_id: `act_${7000000000 + i}` })
      results.push((await res.json()).request_recorded)
    }
    expect(audit()).toHaveLength(5)
    expect(results).toEqual([true, true, true, true, true, false])
  })

  it('FDE 忽略后 24 小时内客户重交同一个号 → 重新记一条，待办里重新出现（不说「已记下」却没有）', async () => {
    await patchAs(EMPLOYEE_A, A, { ad_account_id: ACC_NEW })
    await patchAs(FDE, A, { dismiss_request: true })
    const res = await patchAs(EMPLOYEE_A, A, { ad_account_id: ACC_NEW })
    expect((await res.json()).request_recorded).toBe(true)
    expect((await (await getAs(FDE, A)).json()).pending_request).toMatchObject({ requested_value: ACC_NEW })
  })

  it('读不到最近提交（限流查询失败）→ 不记，request_recorded=false', async () => {
    h.failures = { select: new Set(['client_binding_audit']) }
    const res = await patchAs(EMPLOYEE_A, A, { ad_account_id: ACC_NEW })
    expect((await res.json()).request_recorded).toBe(false)
    expect(audit()).toHaveLength(0)
  })

  it('反向用例：员工改绑被拒后，拿 B 的 campaign 过归属校验 → 仍被拒', async () => {
    await patchAs(EMPLOYEE_A, A, { ad_account_id: ACC_B })
    const r = await assertCampaignOwnedByClient('120220000000000002', A, 'SHARED_FALLBACK_TOKEN')
    expect(r.ok).toBe(false)
  })
})

describe('内部员工（FDE / ADMIN_EMAILS）改绑', () => {
  it('合法新账户 → 200，写入 + 旧主账户默认从这个客户名下移除 + 审计记下谁/改前改后/令牌来源', async () => {
    const res = await patchAs(FDE, A, { ad_account_id: '3333333333' })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ad_account_id).toBe(ACC_NEW)
    expect(json.previous_removed).toBe(true)
    expect(primaryOf(A)).toBe(ACC_NEW)
    expect(accountRowsOf(A)).toEqual([`${ACC_NEW}:true`])
    expect(audit()).toHaveLength(1)
    expect(audit()[0]).toMatchObject({
      client_id: A, actor_email: FDE, action: 'bind', outcome: 'applied',
      previous_value: ACC_A, requested_value: ACC_NEW, token_source: 'shared_fallback',
    })
  })

  it('改绑后旧账户里的 campaign 过归属校验 → 被拒（纠正误绑必须真的收回权限）', async () => {
    await patchAs(FDE, A, { ad_account_id: ACC_NEW })
    fetchMock.mockImplementationOnce(async () =>
      Response.json({ id: '120210000000000009', name: 'x', status: 'ACTIVE', account_id: ACC_A.slice(4) }))
    expect((await assertCampaignOwnedByClient('120210000000000009', A, 'tok')).ok).toBe(false)
  })

  it('勾「保留为第二账户」→ 旧账户降级保留，审计写明 kept', async () => {
    const res = await patchAs(FDE, A, { ad_account_id: ACC_NEW, keep_previous_as_secondary: true })
    expect(res.status).toBe(200)
    expect(accountRowsOf(A)).toEqual([`${ACC_A}:false`, `${ACC_NEW}:true`])
    expect(String(audit()[0].detail)).toContain('kept as secondary')
  })

  it('Graph 核实确实被调用，用的是这个客户解析出来的令牌', async () => {
    await patchAs(FDE, A, { ad_account_id: ACC_NEW })
    const accountCall = fetchMock.mock.calls.map(c => new URL(String(c[0]))).find(u => u.pathname.endsWith(ACC_NEW))
    expect(accountCall?.searchParams.get('access_token')).toBe('SHARED_FALLBACK_TOKEN')
  })

  it('preview → 200 返回 Meta 账户名，不写绑定也不写审计', async () => {
    const res = await patchAs(FDE, A, { ad_account_id: ACC_NEW, preview: true })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.account.name).toBe('Client A New Ads')
    expect(json.account.business_name).toBeNull()
    expectBindingUntouched()
    expect(audit()).toHaveLength(0)
  })

  it('伪造：填 B 已登记的账户号 → 409，不写，审计记 rejected_duplicate + 撞到谁', async () => {
    const res = await patchAs(FDE, A, { ad_account_id: ACC_B })
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.shared_with).toEqual([{ client_id: B, client_name: 'Client B' }])
    expectBindingUntouched()
    expect(audit()[0]).toMatchObject({ outcome: 'rejected_duplicate', shared_with_client_ids: [B] })
  })

  it('B 的登记是异形写法（大写/空格/裸数字）→ 照样认出是重复', async () => {
    h.db.client_meta_ad_accounts.find(r => r.client_id === B)!.ad_account_id = ' ACT_2222222222 '
    ;(h.db.clients.find(c => c.id === B) as Row).meta_ad_account_id = '2222222222'
    const res = await patchAs(FDE, A, { ad_account_id: 'act_2222222222' })
    expect(res.status).toBe(409)
    expectBindingUntouched()
  })

  it('B 只在老列登记（新表没有）→ 也算重复', async () => {
    h.db.client_meta_ad_accounts = h.db.client_meta_ad_accounts.filter(r => r.client_id !== B)
    const res = await patchAs(FDE, A, { ad_account_id: ACC_B })
    expect(res.status).toBe(409)
  })

  it('显式覆盖 + 写原因 → 200，审计记下原因和共用对象', async () => {
    const reason = '两家客户确实共用同一个 BM 广告账户，已和双方确认'
    const res = await patchAs(FDE, A, { ad_account_id: ACC_B, allow_shared_account: true, override_reason: reason })
    expect(res.status).toBe(200)
    expect(primaryOf(A)).toBe(ACC_B)
    expect(audit()[0]).toMatchObject({ outcome: 'applied', override_reason: reason, shared_with_client_ids: [B] })
  })

  it('要覆盖但原因太短 → 400，不写', async () => {
    const res = await patchAs(FDE, A, { ad_account_id: ACC_B, allow_shared_account: true, override_reason: '共用' })
    expect(res.status).toBe(400)
    expectBindingUntouched()
  })

  it('Meta 读不到这个账户 → 422，不写，审计记 rejected_graph', async () => {
    const res = await patchAs(FDE, A, { ad_account_id: 'act_4444444444' })
    expect(res.status).toBe(422)
    expectBindingUntouched()
    expect(audit()[0]).toMatchObject({ outcome: 'rejected_graph' })
  })

  it('Meta 返回的账户号跟请求的不一致 → 422，不写', async () => {
    graphReturnsOtherId = true
    const res = await patchAs(FDE, A, { ad_account_id: ACC_NEW })
    expect(res.status).toBe(422)
    expectBindingUntouched()
  })

  it('没有任何可用令牌 → 424，不写', async () => {
    delete process.env.META_SYSTEM_USER_TOKEN
    const res = await patchAs(FDE, A, { ad_account_id: ACC_NEW })
    expect(res.status).toBe(424)
    expectBindingUntouched()
  })

  it('审计写不进去 → 500，不写（fail closed）', async () => {
    h.failures = { insert: new Set(['client_binding_audit']) }
    const res = await patchAs(FDE, A, { ad_account_id: ACC_NEW })
    expect(res.status).toBe(500)
    expectBindingUntouched()
  })

  it('查其他客户登记出错 → 500，不写（查不出来 ≠ 没有重复）', async () => {
    h.failures = { select: new Set(['client_meta_ad_accounts']) }
    const res = await patchAs(FDE, A, { ad_account_id: ACC_NEW })
    expect(res.status).toBe(500)
    expect(primaryOf(A)).toBe(ACC_A)
    expect(audit()).toHaveLength(0)
  })

  it('登记表插入失败 → 500，两处都恢复原状，审计记 write_failed', async () => {
    h.failures = { insert: new Set(['client_meta_ad_accounts']) }
    const res = await patchAs(FDE, A, { ad_account_id: ACC_NEW })
    const json = await res.json()
    expect(res.status).toBe(500)
    expect(json.reason).toBe('write_failed')
    expectBindingUntouched()
    expect(audit()[0]).toMatchObject({ outcome: 'write_failed' })
  })

  it('移除旧账户那一步失败、恢复时删新行也失败 → 如实报 partial_write，clients 列没被改', async () => {
    h.failures = { delete: new Set(['client_meta_ad_accounts']) }
    const res = await patchAs(FDE, A, { ad_account_id: ACC_NEW })
    expect(res.status).toBe(500)
    expect((await res.json()).reason).toBe('partial_write')
    expect(primaryOf(A)).toBe(ACC_A)
  })

  it('clients 列写失败且恢复也写不进去 → 如实报「只写了一半」，不说成普通失败', async () => {
    h.failures = { update: new Set(['clients']) }
    const res = await patchAs(FDE, A, { ad_account_id: ACC_NEW, keep_previous_as_secondary: true })
    const json = await res.json()
    expect(res.status).toBe(500)
    expect(json.reason).toBe('partial_write')
    expect(json.error).toContain('只写了一半')
  })

  it('clients 列写失败 → 登记表那一半照快照恢复（归属校验不会停在新号上）', async () => {
    h.failures = { update: new Set(['clients']) }
    await patchAs(FDE, A, { ad_account_id: ACC_NEW, keep_previous_as_secondary: true })
    expect(accountRowsOf(A)).toEqual([`${ACC_A}:true`])
  })

  it('改绑成功但审计补记失败 → 200 且带 audit_incomplete，不假装审计完整', async () => {
    h.failures = { update: new Set(['client_binding_audit']) }
    const res = await patchAs(FDE, A, { ad_account_id: ACC_NEW })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.audit_incomplete).toBe(true)
    expect(primaryOf(A)).toBe(ACC_NEW)
  })

  it('别家客户那行是降级行（is_primary=false）→ 也算重复', async () => {
    h.db.client_meta_ad_accounts.push({ id: 'm9', client_id: B, ad_account_id: 'act_5555555555', is_primary: false, label: 'old' })
    graphAccounts['act_5555555555'] = 'B old'
    const res = await patchAs(FDE, A, { ad_account_id: 'act_5555555555' })
    expect(res.status).toBe(409)
  })

  it('前导零 → 400（否则 act_0123… 和 act_123… 会被当成两个账户绕过重复检查）', async () => {
    const res = await patchAs(FDE, A, { ad_account_id: 'act_02222222222' })
    expect(res.status).toBe(400)
  })

  it('内部员工清空 → 200，审计记 clear，旧账户默认移除', async () => {
    const res = await patchAs(FDE, A, { ad_account_id: null })
    expect(res.status).toBe(200)
    expect(primaryOf(A)).toBeNull()
    expect(accountRowsOf(A)).toEqual([])
    expect(audit()[0]).toMatchObject({ action: 'clear', outcome: 'applied', previous_value: ACC_A })
  })

  it('内部员工清空 + 保留为第二账户 → 行留下但不是主账户', async () => {
    await patchAs(FDE, A, { ad_account_id: null, keep_previous_as_secondary: true })
    expect(accountRowsOf(A)).toEqual([`${ACC_A}:false`])
  })
})

describe('CTS 多账户不被误拦', () => {
  it('把 CTS 自己已登记的官方账户设为主账户（保留个人号）→ 不算重复，保留原标签，两个账户都在', async () => {
    const res = await patchAs(FDE, CTS, { ad_account_id: CTS_OFFICIAL, keep_previous_as_secondary: true })
    expect(res.status).toBe(200)
    const official = h.db.client_meta_ad_accounts.find(r => r.client_id === CTS && r.ad_account_id === CTS_OFFICIAL)
    expect(official).toMatchObject({ is_primary: true, label: 'CTStours 官方账户（ThruPlay）' })
    expect(accountRowsOf(CTS)).toEqual([`${CTS_OFFICIAL}:true`, `${CTS_PERSONAL}:false`])
  })

  it('CTS 登记表里官方账户存成裸数字 → 提升时原行规范成 act_ 写法，不重复插行', async () => {
    h.db.client_meta_ad_accounts.find(r => r.id === 'm4')!.ad_account_id = CTS_OFFICIAL.slice(4)
    const res = await patchAs(FDE, CTS, { ad_account_id: CTS_OFFICIAL, keep_previous_as_secondary: true })
    expect(res.status).toBe(200)
    expect(accountRowsOf(CTS)).toEqual([`${CTS_OFFICIAL}:true`, `${CTS_PERSONAL}:false`])
  })

  it('官方账户上的 campaign 过归属校验 → 放行', async () => {
    fetchMock.mockImplementationOnce(async () =>
      Response.json({ id: '120230000000000003', name: 'x', status: 'ACTIVE', account_id: CTS_OFFICIAL.slice(4) }))
    const r = await assertCampaignOwnedByClient('120230000000000003', CTS, 'tok')
    expect(r.ok).toBe(true)
  })
})

describe('客户提交 → FDE 看到 → 处理', () => {
  it('内部员工 GET 能看到待核实的号；客户员工 GET 看不到且 can_edit=false', async () => {
    await patchAs(EMPLOYEE_A, A, { ad_account_id: ACC_NEW })

    const staff = await (await getAs(FDE, A)).json()
    expect(staff.can_edit).toBe(true)
    expect(staff.pending_request).toMatchObject({ requested_value: ACC_NEW, actor_email: EMPLOYEE_A })

    const employee = await (await getAs(EMPLOYEE_A, A)).json()
    expect(employee.can_edit).toBe(false)
    expect(employee.pending_request).toBeNull()
  })

  it('演示管理员 GET → can_edit=false', async () => {
    const json = await (await getAs(DEMO_ADMIN, A)).json()
    expect(json.can_edit).toBe(false)
  })

  it('FDE 忽略请求 → 待核实消失', async () => {
    await patchAs(EMPLOYEE_A, A, { ad_account_id: ACC_NEW })
    const res = await patchAs(FDE, A, { dismiss_request: true })
    expect(res.status).toBe(200)
    expect((await (await getAs(FDE, A)).json()).pending_request).toBeNull()
  })

  it('客户员工不能替 FDE 忽略请求', async () => {
    await patchAs(EMPLOYEE_A, A, { ad_account_id: ACC_NEW })
    const res = await patchAs(EMPLOYEE_A, A, { dismiss_request: true })
    expect(res.status).toBe(403) // non-staff never reach the dismiss branch
    expect((await (await getAs(FDE, A)).json()).pending_request).not.toBeNull()
  })

  it('FDE 清空绑定 ≠ 处理了客户交的号 → 待核实还在', async () => {
    await patchAs(EMPLOYEE_A, A, { ad_account_id: ACC_NEW })
    await patchAs(FDE, A, { ad_account_id: null })
    expect((await (await getAs(FDE, A)).json()).pending_request).toMatchObject({ requested_value: ACC_NEW })
  })

  it('GET 读待核实请求失败 → 如实返回 error，不当成「没有请求」', async () => {
    h.failures = { select: new Set(['client_binding_audit']) }
    const json = await (await getAs(FDE, A)).json()
    expect(json.pending_request).toHaveProperty('error')
  })

  it('FDE 采用这个号保存 → 待核实消失', async () => {
    await patchAs(EMPLOYEE_A, A, { ad_account_id: ACC_NEW })
    await patchAs(FDE, A, { ad_account_id: ACC_NEW })
    expect((await (await getAs(FDE, A)).json()).pending_request).toBeNull()
  })
})
