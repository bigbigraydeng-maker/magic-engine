/**
 * K-WP01A —— 三个审批接口的 HTTP 边界。
 *
 * 盯的是**顺序和身份来源**这两件事：
 *   · 没登录 → 401；不属于这个客户 → 403；档次不够 → 403
 *   · 详情 / 决定路径：先按 runId 读 run，**再**拿 `run.client_id` 鉴权 ——
 *     调用方声称的 clientId 一个字不信（这两个路由压根不收）
 *   · 操作者邮箱只能来自会话，请求体伪造一律 400
 *   · 内核表不存在 → 503，**不是 200 []**
 *
 * 鉴权用的是真的那一层的 mock（`requirePaidClientAccess`）——
 * 它自己的行为在 `src/lib/auth/__tests__/client-access.test.ts` 里已经有测试。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requirePaidClientAccess: vi.fn(),
  listPendingApprovals: vi.fn(),
  loadRunForApproval: vi.fn(),
  buildApprovalDetail: vi.fn(),
  decideApproval: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: mocks.requirePaidClientAccess,
}))

// 🔴 只 mock 「读」和「写」这两类外部动作；判定（tier 闸、请求体解析、错误码映射）
//    走**真实实现** —— 把判定也 mock 掉的话，这套测试就只在验 mock 自己。
vi.mock('@/lib/kernel-approval/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kernel-approval/service')>()
  return {
    ...actual,
    listPendingApprovals: mocks.listPendingApprovals,
    loadRunForApproval: mocks.loadRunForApproval,
    buildApprovalDetail: mocks.buildApprovalDetail,
    decideApproval: mocks.decideApproval,
    createApprovalKernelDeps: vi.fn(() => ({}) as never),
  }
})

import { GET as listGET } from '../route'
import { GET as detailGET } from '../[runId]/route'
import { POST as decisionPOST } from '../[runId]/decision/route'
import { ApprovalError } from '@/lib/kernel-approval/errors'

// 🔴 全部是**合法 UUID**。路由现在会在读库之前校验它们 ——
//    夹具用 `run-1111` 这种假值的话，测试要么全红，要么（更糟）
//    在校验加上之前一直绿着，而真实调用方从来走不到那条路。
const CLIENT_A = 'c11e0000-0000-4000-8000-00000000000a'
const CLIENT_B = 'c11e0000-0000-4000-8000-00000000000b'
const RUN_ID = '40000000-0000-4000-8000-000000001111'
const DECISION_ID = 'dec00000-0000-4000-8000-000000001111'

function access(tier: 'admin' | 'paid_client' | 'self_serve' | 'portal_only', email = 'ray@magiclab') {
  return { ok: true as const, user: { email }, role: 'admin' as const, tier, allowedClientId: null }
}

function pendingRun(clientId = CLIENT_A, overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    client_id: clientId,
    action_key: 'seo.build_publish_package',
    action_version: 1,
    status: 'pending_approval',
    authorization_decision_id: DECISION_ID,
    ...overrides,
  }
}

const listReq = (qs: string) =>
  new NextRequest(`http://localhost:3001/api/kernel/approvals${qs}`)

const runCtx = () => ({ params: Promise.resolve({ runId: RUN_ID }) })

const detailReq = () =>
  new NextRequest(`http://localhost:3001/api/kernel/approvals/${RUN_ID}`)

const decisionReq = (body: unknown, raw?: string, qs = '') =>
  new NextRequest(`http://localhost:3001/api/kernel/approvals/${RUN_ID}/decision${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePaidClientAccess.mockResolvedValue(access('paid_client'))
  mocks.listPendingApprovals.mockResolvedValue({
    items: [],
    skippedRunIds: [],
    hasMore: false,
    limit: 50,
    nextCursor: null,
  })
  mocks.loadRunForApproval.mockResolvedValue(pendingRun())
  mocks.buildApprovalDetail.mockResolvedValue({ runId: RUN_ID, expectedDecisionId: DECISION_ID })
  mocks.decideApproval.mockResolvedValue({
    runId: RUN_ID,
    finalStatus: 'authorized',
    decisionId: 'decision-new',
    decidedBy: 'ray@magiclab',
    reason: 'ok',
  })
})

// ── UUID 边界（Codex P2：读 uuid 列之前必须先判语法） ────────────────────────

/**
 * 🔴 三个入口的 uuid 都要在**任何数据库查询、任何鉴权、任何写入之前**判掉。
 *
 *    不判的话 `.eq('id', 'not-a-uuid')` 会让 Postgres 抛
 *    `22P02 invalid input syntax for type uuid` —— 一路冒上来变成 `500`。
 *    于是「链接被聊天软件截断了」这种纯客户端问题被记成服务端故障，
 *    5xx 监控被污染，真正的故障淹在噪音里。
 *
 *    每条用例都同时断言「没查库、没鉴权、没落决定」—— 只断言状态码的话，
 *    校验放在鉴权**之后**也照样绿，而那时 DB 已经被打过一次了。
 */
const MALFORMED_IDS = [
  'not-a-uuid',
  'run-1111',
  '40000000-0000-4000-8000-00000000111', // 少一位
  '40000000-0000-4000-8000-0000000011111', // 多一位
  '40000000_0000_4000_8000_000000001111', // 分隔符不对
  '40000000-0000-4000-8000-00000000111g', // g 不是十六进制
  "40000000-0000-4000-8000-000000001111' OR 1=1--",
  '../../etc/passwd',
  '',
]

describe('🔴 GET /api/kernel/approvals/[runId] · 非法 runId', () => {
  it.each(MALFORMED_IDS)('「%s」→ 400，且零查询零鉴权', async (bad) => {
    const res = await detailGET(detailReq(), { params: Promise.resolve({ runId: bad }) })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'invalid_request' })
    expect(mocks.loadRunForApproval, '读库必须没发生').not.toHaveBeenCalled()
    expect(mocks.requirePaidClientAccess, '鉴权必须没发生').not.toHaveBeenCalled()
    expect(mocks.buildApprovalDetail).not.toHaveBeenCalled()
  })

  it('✅ 合法 runId 照常往下走（判据不是把所有人都拦掉）', async () => {
    const res = await detailGET(detailReq(), runCtx())
    expect(res.status).toBe(200)
    expect(mocks.loadRunForApproval).toHaveBeenCalledWith(expect.anything(), RUN_ID)
  })
})

describe('🔴 POST …/[runId]/decision · 非法 runId', () => {
  const APPROVE_BODY = { resolution: 'approve', expectedDecisionId: DECISION_ID }

  it.each(MALFORMED_IDS)('「%s」→ 400，且零查询零鉴权零写入', async (bad) => {
    const res = await decisionPOST(decisionReq(APPROVE_BODY), {
      params: Promise.resolve({ runId: bad }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'invalid_request' })
    expect(mocks.loadRunForApproval, '读库必须没发生').not.toHaveBeenCalled()
    expect(mocks.requirePaidClientAccess, '鉴权必须没发生').not.toHaveBeenCalled()
    expect(mocks.decideApproval, '一条决定都不许落').not.toHaveBeenCalled()
  })

  it('🔴 runId 的校验排在请求体解析**之后**、读库之前 —— 两种错都各自报各自的', async () => {
    // 请求体也不合法时，先报请求体的问题（两条都是 400，但 detail 要说清是哪个字段）
    const res = await decisionPOST(decisionReq({ resolution: 'nope' }), {
      params: Promise.resolve({ runId: 'not-a-uuid' }),
    })
    expect(res.status).toBe(400)
    expect(mocks.loadRunForApproval).not.toHaveBeenCalled()
    expect(mocks.decideApproval).not.toHaveBeenCalled()
  })

  it('🔴 大写形式的 expectedDecisionId 必须真能批得动（不是被判成 stale）', async () => {
    // 🔴 校验层刻意接受大写（UUID 大小写不影响它是哪个值），但下游要拿它跟
    //    库里读出来的小写值做**字符串**比较。不归一的话，一个合法的批准
    //    会被判成 STALE_DECISION —— 永远提交不上去，报的还是完全指错方向的话。
    const res = await decisionPOST(
      decisionReq({ resolution: 'approve', expectedDecisionId: DECISION_ID.toUpperCase() }),
      runCtx(),
    )
    expect(res.status, '大写形式必须走得通').toBe(200)
    const [, args] = mocks.decideApproval.mock.calls[0]
    expect(
      args.input.expectedDecisionId,
      '往下传的必须是小写 —— 库里存的就是小写',
    ).toBe(DECISION_ID)
  })

  it('🔴 请求体里的 expectedDecisionId 非法 → 400，且零查询零鉴权零写入', async () => {
    const res = await decisionPOST(
      decisionReq({ resolution: 'approve', expectedDecisionId: 'decision-1111' }),
      runCtx(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'invalid_request' })
    expect(mocks.loadRunForApproval).not.toHaveBeenCalled()
    expect(mocks.requirePaidClientAccess).not.toHaveBeenCalled()
    expect(mocks.decideApproval).not.toHaveBeenCalled()
  })
})

describe('🔴 GET /api/kernel/approvals · 非法 clientId', () => {
  it.each(MALFORMED_IDS.filter((v) => v !== ''))('「%s」→ 400，且零查询零鉴权', async (bad) => {
    const res = await listGET(listReq(`?clientId=${encodeURIComponent(bad)}`))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'invalid_request' })
    expect(mocks.requirePaidClientAccess, '鉴权必须没发生').not.toHaveBeenCalled()
    expect(mocks.listPendingApprovals, '读库必须没发生').not.toHaveBeenCalled()
  })

  it('空 clientId 仍然是「请带上 clientId」那条，不是 uuid 报错', async () => {
    const res = await listGET(listReq('?clientId='))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('请带上 clientId')
    expect(mocks.requirePaidClientAccess).not.toHaveBeenCalled()
  })
})

// ── 列表 ──────────────────────────────────────────────────────────────────────

describe('GET /api/kernel/approvals', () => {
  it('缺 clientId → 400', async () => {
    const res = await listGET(listReq(''))
    expect(res.status).toBe(400)
    expect(mocks.listPendingApprovals).not.toHaveBeenCalled()
  })

  it('🔴 没登录 → 401，且一条数据都没查', async () => {
    mocks.requirePaidClientAccess.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Unauthorized',
      reason: 'unauthorized',
    })
    const res = await listGET(listReq(`?clientId=${CLIENT_A}`))
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ code: 'unauthorized' })
    expect(mocks.listPendingApprovals).not.toHaveBeenCalled()
  })

  it('🔴 clientId 只是选择器 —— 不属于这个客户 → 403，且不查数据', async () => {
    mocks.requirePaidClientAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Forbidden',
      reason: 'forbidden',
    })
    const res = await listGET(listReq(`?clientId=${CLIENT_B}`))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'forbidden_client' })
    // 🔴 鉴权是拿**调用方给的那个** clientId 做的，不是拿别的
    expect(mocks.requirePaidClientAccess).toHaveBeenCalledWith(CLIENT_B)
    expect(mocks.listPendingApprovals).not.toHaveBeenCalled()
  })

  it('🔴 self_serve 被 requirePaidClientAccess 挡掉 → 403 paid_only', async () => {
    mocks.requirePaidClientAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'This feature requires a paid plan.',
      reason: 'paid_only',
    })
    const res = await listGET(listReq(`?clientId=${CLIENT_A}`))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'forbidden_client', detail: { reason: 'paid_only' } })
  })

  it('🔴 Codex P2-1 · 权限**查不了**（500 lookup_failed）不许被伪装成 403', async () => {
    // client_portal_users 查询超时 / 库不可用 → requirePaidClientAccess 给 500。
    // 压成 403 的话：界面把系统故障当成永久权限问题引导人去找管理员，
    // 而服务端监控一条 5xx 都收不到 —— 故障就此隐形。
    mocks.requirePaidClientAccess.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Authorization check failed',
      reason: 'lookup_failed',
    })
    const res = await listGET(listReq(`?clientId=${CLIENT_A}`))
    expect(res.status, '「查不了权限」必须是 500，不是 403').toBe(500)
    expect(await res.json()).toMatchObject({ code: 'internal_error' })
    expect(mocks.listPendingApprovals).not.toHaveBeenCalled()
  })

  it('🔴 决定路由同样：500 lookup_failed → 500，且不落任何决定', async () => {
    mocks.requirePaidClientAccess.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Authorization check failed',
      reason: 'lookup_failed',
    })
    const res = await decisionPOST(
      decisionReq({ resolution: 'approve', expectedDecisionId: DECISION_ID }),
      runCtx(),
    )
    expect(res.status).toBe(500)
    expect(mocks.decideApproval).not.toHaveBeenCalled()
  })

  it('🔴 查询过滤钉死在鉴权过的那个 clientId 上', async () => {
    await listGET(listReq(`?clientId=${CLIENT_A}`))
    expect(mocks.listPendingApprovals).toHaveBeenCalledWith(
      expect.anything(),
      CLIENT_A,
      expect.anything(),
    )
  })

  it('limit / cursor 原样透给审批层；limit 读不成数字就当没给（不是当成 0）', async () => {
    const CURSOR = '2026-08-05T00:00:00.000Z|40000000-0000-4000-8000-000000000009'
    await listGET(listReq(`?clientId=${CLIENT_A}&limit=25&cursor=${encodeURIComponent(CURSOR)}`))
    expect(mocks.listPendingApprovals).toHaveBeenCalledWith(expect.anything(), CLIENT_A, {
      limit: 25,
      cursor: CURSOR,
    })

    vi.clearAllMocks()
    mocks.requirePaidClientAccess.mockResolvedValue(access('paid_client'))
    mocks.listPendingApprovals.mockResolvedValue({
      items: [],
      skippedRunIds: [],
      hasMore: false,
      limit: 50,
      nextCursor: null,
    })
    await listGET(listReq(`?clientId=${CLIENT_A}&limit=abc`))
    expect(mocks.listPendingApprovals).toHaveBeenCalledWith(expect.anything(), CLIENT_A, {
      limit: undefined,
      cursor: undefined,
    })
  })

  it('🔴 hasMore 为真时把 nextCursor 一路透到返回体', async () => {
    const CURSOR = '2026-08-05T00:00:00.000Z|40000000-0000-4000-8000-000000000009'
    mocks.listPendingApprovals.mockResolvedValue({
      items: [],
      skippedRunIds: [],
      hasMore: true,
      limit: 50,
      nextCursor: CURSOR,
    })
    const body = await (await listGET(listReq(`?clientId=${CLIENT_A}`))).json()
    expect(body.hasMore).toBe(true)
    expect(body.nextCursor, '说了后面还有却不给游标 = 调用方翻不过去').toBe(CURSOR)
  })

  it('🔴 hasMore 一路透到返回体 —— 截断不许静默', async () => {
    mocks.listPendingApprovals.mockResolvedValue({
      items: [],
      skippedRunIds: [],
      hasMore: true,
      limit: 50,
      nextCursor: null,
    })
    const body = await (await listGET(listReq(`?clientId=${CLIENT_A}`))).json()
    expect(body.hasMore, '后面还有却不说，界面会当成「就这么多」').toBe(true)
  })

  it('🔴 内核表不存在 → 503 kernel_not_provisioned，不是 200 []', async () => {
    mocks.listPendingApprovals.mockRejectedValue(
      new ApprovalError('kernel_not_provisioned', '还没启用'),
    )
    const res = await listGET(listReq(`?clientId=${CLIENT_A}`))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.code).toBe('kernel_not_provisioned')
    expect(body.items, '不许在报错的同时还给一个空列表 —— 界面会当成「没有待办」').toBeUndefined()
  })

  it('内核已启用、这个客户没有等审批的 → 200 []', async () => {
    const res = await listGET(listReq(`?clientId=${CLIENT_A}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      clientId: CLIENT_A,
      items: [],
      skippedRunIds: [],
      hasMore: false,
      limit: 50,
      nextCursor: null,
    })
  })

  it('🔴 认不出来的失败 → 500，绝不降级成 503 或空列表', async () => {
    mocks.listPendingApprovals.mockRejectedValue(new Error('statement timeout'))
    const res = await listGET(listReq(`?clientId=${CLIENT_A}`))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ code: 'internal_error' })
  })
})

// ── 详情 ──────────────────────────────────────────────────────────────────────

describe('GET /api/kernel/approvals/[runId]', () => {
  it('🔴 客户归属从 run 自己身上读出来，再拿它去鉴权', async () => {
    mocks.loadRunForApproval.mockResolvedValue(pendingRun(CLIENT_B))
    await detailGET(detailReq(), runCtx())
    expect(mocks.requirePaidClientAccess).toHaveBeenCalledWith(CLIENT_B)
  })

  it('🔴 不属于这条 run 的客户 → 403，且详情一个字节都不返回', async () => {
    mocks.requirePaidClientAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Forbidden',
      reason: 'forbidden',
    })
    const res = await detailGET(detailReq(), runCtx())
    expect(res.status).toBe(403)
    expect((await res.json()).item).toBeUndefined()
    expect(mocks.buildApprovalDetail).not.toHaveBeenCalled()
  })

  it('🔴 批不了也照样给详情，并如实告诉界面「能做什么」（不许卡死）', async () => {
    // 🔴 早先这里是 403 —— 于是契约升版后的旧请求连看都看不到，
    //    也就没法点「不做」，永久卡在待审批里。铁律「管道不许断头」。
    mocks.loadRunForApproval.mockResolvedValue(pendingRun(CLIENT_A, { action_version: 99 }))
    const res = await detailGET(detailReq(), runCtx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.item).toBeDefined()
    expect(body.permissions).toEqual({
      canApprove: false,
      canReject: true,
      approveBlockedReason: 'unknown_action_version',
    })
  })

  it('能批的时候 permissions 如实是可批', async () => {
    const body = await (await detailGET(detailReq(), runCtx())).json()
    expect(body.permissions).toEqual({
      canApprove: true,
      canReject: true,
      approveBlockedReason: null,
    })
  })

  it('run 不存在 → 404', async () => {
    mocks.loadRunForApproval.mockRejectedValue(new ApprovalError('not_found', '找不到'))
    const res = await detailGET(detailReq(), runCtx())
    expect(res.status).toBe(404)
    expect(mocks.requirePaidClientAccess).not.toHaveBeenCalled()
  })

  it('内核表不存在 → 503', async () => {
    mocks.loadRunForApproval.mockRejectedValue(
      new ApprovalError('kernel_not_provisioned', '还没启用'),
    )
    expect((await detailGET(detailReq(), runCtx())).status).toBe(503)
  })

  it('一切正常 → 200 + 详情 + 会话身份', async () => {
    const res = await detailGET(detailReq(), runCtx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.item.runId).toBe(RUN_ID)
    expect(body.actor).toEqual({ email: 'ray@magiclab', tier: 'paid_client' })
  })
})

// ── 决定 ──────────────────────────────────────────────────────────────────────

describe('POST /api/kernel/approvals/[runId]/decision', () => {
  const APPROVE = { resolution: 'approve', expectedDecisionId: DECISION_ID }

  it('🔴 操作者邮箱来自会话，不是请求体', async () => {
    mocks.requirePaidClientAccess.mockResolvedValue(access('paid_client', 'Jayden@MagicLab.com'))
    await decisionPOST(decisionReq(APPROVE), runCtx())
    expect(mocks.decideApproval).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorEmail: 'jayden@magiclab.com' }),
    )
  })

  it('🔴 请求体里塞 actor / clientId / tier → 400，一次都不落库', async () => {
    for (const extra of [
      { actorEmail: 'attacker@evil.test' },
      { clientId: CLIENT_B },
      { tier: 'admin' },
      { approvedByUser: 'attacker@evil.test' },
    ]) {
      const res = await decisionPOST(decisionReq({ ...APPROVE, ...extra }), runCtx())
      expect(res.status, JSON.stringify(extra)).toBe(400)
      expect(await res.json()).toMatchObject({ code: 'invalid_request' })
    }
    expect(mocks.decideApproval).not.toHaveBeenCalled()
  })

  it('🔴 缺 expectedDecisionId → 400', async () => {
    const res = await decisionPOST(decisionReq({ resolution: 'approve' }), runCtx())
    expect(res.status).toBe(400)
    expect(mocks.decideApproval).not.toHaveBeenCalled()
  })

  it('🔴 reject 不写原因 → 400', async () => {
    const res = await decisionPOST(
      decisionReq({ resolution: 'reject', expectedDecisionId: DECISION_ID, reason: '   ' }),
      runCtx(),
    )
    expect(res.status).toBe(400)
    expect(mocks.decideApproval).not.toHaveBeenCalled()
  })

  it('body 不是 JSON → 400', async () => {
    const res = await decisionPOST(decisionReq(null, '{not json'), runCtx())
    expect(res.status).toBe(400)
  })

  it('🔴 没登录 → 401，且不落任何决定', async () => {
    mocks.requirePaidClientAccess.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Unauthorized',
      reason: 'unauthorized',
    })
    const res = await decisionPOST(decisionReq(APPROVE), runCtx())
    expect(res.status).toBe(401)
    expect(mocks.decideApproval).not.toHaveBeenCalled()
  })

  it('🔴 调用方从**查询串**塞 clientId 也不作数 —— 归属只认 run 自己写的那个', async () => {
    // 请求体那条路已经被严格解析挡死了（多一个字段就 400），所以伪造只会从
    // 别的通道来：查询串、header、路径。这条盯的是「这个路由压根不看调用方给的
    // clientId」—— 无论它从哪个通道来。
    mocks.loadRunForApproval.mockResolvedValue(pendingRun(CLIENT_B))
    await decisionPOST(decisionReq(APPROVE, undefined, `?clientId=${CLIENT_A}`), runCtx())
    expect(mocks.requirePaidClientAccess).toHaveBeenCalledTimes(1)
    expect(
      mocks.requirePaidClientAccess,
      '鉴权必须按 run.client_id 做，不是按调用方说的那个',
    ).toHaveBeenCalledWith(CLIENT_B)
  })

  it('🔴 详情路由同样不看查询串里的 clientId', async () => {
    mocks.loadRunForApproval.mockResolvedValue(pendingRun(CLIENT_B))
    await detailGET(
      new NextRequest(`http://localhost:3001/api/kernel/approvals/${RUN_ID}?clientId=${CLIENT_A}`),
      runCtx(),
    )
    expect(mocks.requirePaidClientAccess).toHaveBeenCalledWith(CLIENT_B)
  })

  it('🔴 跨客户 → 403，且不落任何决定', async () => {
    mocks.loadRunForApproval.mockResolvedValue(pendingRun(CLIENT_B))
    mocks.requirePaidClientAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Forbidden',
      reason: 'forbidden',
    })
    const res = await decisionPOST(decisionReq(APPROVE), runCtx())
    expect(res.status).toBe(403)
    expect(mocks.requirePaidClientAccess).toHaveBeenCalledWith(CLIENT_B)
    expect(mocks.decideApproval).not.toHaveBeenCalled()
  })

  it.each(['self_serve', 'portal_only'] as const)(
    '🔴 %s 档次**批准** → 403 forbidden_tier，且不落任何决定',
    async (tier) => {
      mocks.requirePaidClientAccess.mockResolvedValue(access(tier))
      const res = await decisionPOST(decisionReq(APPROVE), runCtx())
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ code: 'forbidden_tier' })
      expect(mocks.decideApproval).not.toHaveBeenCalled()
    },
  )

  it('🔴 契约升版后的旧请求：批准被拒，但**拒绝走得通**（不许卡死）', async () => {
    mocks.loadRunForApproval.mockResolvedValue(pendingRun(CLIENT_A, { action_version: 99 }))

    // 批准 → 403，且一条决定都不落
    const denied = await decisionPOST(decisionReq(APPROVE), runCtx())
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ code: 'forbidden_tier' })
    expect(mocks.decideApproval).not.toHaveBeenCalled()

    // 拒绝 → 走得通。门槛只管「让这件事发生」，不管「说不做」。
    mocks.decideApproval.mockResolvedValue({
      runId: RUN_ID,
      finalStatus: 'denied',
      decisionId: 'dec00000-0000-4000-8000-000000002222',
      decidedBy: 'ray@magiclab',
      reason: '契约变过了，这条清掉',
    })
    const rejected = await decisionPOST(
      decisionReq({
        resolution: 'reject',
        expectedDecisionId: DECISION_ID,
        reason: '契约变过了，这条清掉',
      }),
      runCtx(),
    )
    expect(rejected.status, '拒绝必须走得通 —— 否则这条 run 永久卡在待审批里').toBe(200)
    expect(await rejected.json()).toMatchObject({ finalStatus: 'denied' })
    expect(mocks.decideApproval).toHaveBeenCalledTimes(1)
  })

  it('🔴 动作已从注册表下架：同样批不了、但拒得掉', async () => {
    mocks.loadRunForApproval.mockResolvedValue(
      pendingRun(CLIENT_A, { action_key: 'geo.rewrite_the_whole_site' }),
    )
    expect((await decisionPOST(decisionReq(APPROVE), runCtx())).status).toBe(403)
    expect(mocks.decideApproval).not.toHaveBeenCalled()

    mocks.decideApproval.mockResolvedValue({
      runId: RUN_ID,
      finalStatus: 'denied',
      decisionId: 'dec00000-0000-4000-8000-000000003333',
      decidedBy: 'ray@magiclab',
      reason: '这个动作已经没有了',
    })
    const rejected = await decisionPOST(
      decisionReq({
        resolution: 'reject',
        expectedDecisionId: DECISION_ID,
        reason: '这个动作已经没有了',
      }),
      runCtx(),
    )
    expect(rejected.status).toBe(200)
  })

  it('🔴 会话没有邮箱 → 403（人签的决策必须记得下是谁批的）', async () => {
    mocks.requirePaidClientAccess.mockResolvedValue(access('paid_client', ''))
    const res = await decisionPOST(decisionReq(APPROVE), runCtx())
    expect(res.status).toBe(403)
    expect(mocks.decideApproval).not.toHaveBeenCalled()
  })

  it('🔴 expectedDecisionId 过期 → 409 stale_decision', async () => {
    mocks.decideApproval.mockRejectedValue(new ApprovalError('stale_decision', '刷新一下'))
    const res = await decisionPOST(decisionReq(APPROVE), runCtx())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'stale_decision' })
  })

  it('🔴 已经有结论 → 409 not_pending', async () => {
    mocks.decideApproval.mockRejectedValue(new ApprovalError('not_pending', '已经有结论了'))
    expect((await decisionPOST(decisionReq(APPROVE), runCtx())).status).toBe(409)
  })

  it('🔴 同意成功 → 200，终态是 authorized（不是 running / succeeded）', async () => {
    const res = await decisionPOST(decisionReq(APPROVE), runCtx())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, finalStatus: 'authorized' })
  })

  it('🔴 不做成功 → 200，终态是 denied', async () => {
    mocks.decideApproval.mockResolvedValue({
      runId: RUN_ID,
      finalStatus: 'denied',
      decisionId: 'decision-new',
      decidedBy: 'ray@magiclab',
      reason: '这周不发',
    })
    const res = await decisionPOST(
      decisionReq({ resolution: 'reject', expectedDecisionId: DECISION_ID, reason: '这周不发' }),
      runCtx(),
    )
    expect(await res.json()).toMatchObject({ ok: true, finalStatus: 'denied' })
  })

  it('🔴 只把三个允许的字段交给审批层', async () => {
    await decisionPOST(
      decisionReq({ resolution: 'reject', expectedDecisionId: DECISION_ID, reason: '不做' }),
      runCtx(),
    )
    const [, args] = mocks.decideApproval.mock.calls[0]
    expect(args.input).toEqual({
      resolution: 'reject',
      expectedDecisionId: DECISION_ID,
      reason: '不做',
    })
  })
})
