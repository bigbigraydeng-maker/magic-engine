/**
 * 审批层的 HTTP 边界件 —— 鉴权顺序与错误映射各**只有一份**。
 *
 * 🔴 三个路由各写一遍的话必然分家，而分家的那一处就是被绕过去的那一处。
 *    路由文件里只剩「取参数 → 调这里 → 调 service → 返回」。
 */

import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import type { AccessTier } from '@/lib/auth/access-types'
import { isUuid } from '@/lib/validation-utils'
import { ApprovalError, isKernelNotProvisioned } from './errors'

/**
 * 来自 HTTP 的 uuid：**读库之前**就得判。
 *
 * 🔴 不判的话，`.eq('id', 'not-a-uuid')` 会让 Postgres 抛
 *    `22P02 invalid input syntax for type uuid` —— 一路冒上来变成 `500 internal_error`。
 *    于是「链接被聊天软件截断了」「有人手打错了一位」这种纯客户端问题
 *    会被记成服务端故障：调用方看到的是「系统坏了」而不是「你这个链接不对」，
 *    而 5xx 监控被这类噪音污染之后，真正的故障就淹在里面了。
 *
 * 🔴 这道闸只管**语法**。过了照样要走客户归属和档次校验 ——
 *    它不是权限闸，一个字都没放宽后面的东西。
 *
 * @param label 出错时告诉调用方是**哪个**字段不对（三处入口共用一份文案模板）
 */
export function requireUuid(value: unknown, label: string): string {
  // 🔴 归一成小写 —— 库里存的是小写，任何跟它做字符串比较的地方都得是同一口径。
  //    （`.eq()` 打在 uuid 列上时 Postgres 自己会归一，但拿来跟读出来的值比字符串时不会。）
  if (isUuid(value)) return value.toLowerCase()
  throw new ApprovalError(
    'invalid_request',
    `${label} 不是一个合法的 id（应该长成 8-4-4-4-12 的那种）—— 多半是链接被截断了，或者哪里手打错了一位`,
    { field: label },
  )
}

export interface ApprovalActor {
  readonly email: string
  readonly tier: AccessTier
}

/** 统一的失败返回体。`code` 给界面分派用，`error` 给人看。 */
export function approvalErrorResponse(err: unknown): NextResponse {
  if (err instanceof ApprovalError) {
    return NextResponse.json(
      { error: err.humanReason, code: err.code, detail: err.detail },
      { status: err.status },
    )
  }
  // 🔴 **版本化 RPC 还没 apply ⇒ 503，不是 500。**（Build Control Room blocker ③）
  //
  //    内核层 fail closed 时抛的是带码的 `KernelRpcMissingError`（`42883` /
  //    `PGRST202`）。上一版抛的是普通 Error，码在抛出那一刻就丢了 —— 于是这条
  //    **已经声明过** `503 kernel_not_provisioned` 的路，实际答的是
  //    `500 internal_error`。两者对运维是完全不同的指令：
  //    500 =「有 bug，去查日志」，503 =「这套东西还没打开，去 apply migration」。
  //
  //    `isKernelNotProvisioned` 只认那几个码和「找不到函数/表」的明确文案 ——
  //    网络故障、超时、权限不足（`42501`）一律落到下面的 500，**不许**被
  //    描述成「没 apply」：那会让运维照着去 apply 也修不好，而监控上只看到一条无害的 503。
  if (isKernelNotProvisioned(err)) {
    return NextResponse.json(
      {
        error:
          '执行内核在这个环境里还没启用（数据库那几张表 / 那几个函数还没建）——' +
          '所以现在没法处理审批。这不是「出错了」，是这套东西还没打开',
        code: 'kernel_not_provisioned',
        detail: { rpc: (err as { rpc?: unknown }).rpc ?? null },
      },
      { status: 503 },
    )
  }

  // 🔴 认不出来的一律 500 并原样记日志。**绝不降级成 200 或空结果** ——
  //    「查炸了」被答成「没有待办」是这条路上最危险的一种谎。
  console.error('[kernel-approval] 未预期的失败：', err)
  return NextResponse.json(
    { error: '审批接口出错了，这次操作没有生效', code: 'internal_error' },
    { status: 500 },
  )
}

/**
 * 对某个客户做**真实**的付费客户权限校验，并把**会话里的**操作者身份取出来。
 *
 * `requirePaidClientAccess` 负责：没登录 → 401；不属于这个客户 → 403；
 * self_serve / portal_only → 403。这里补两条：
 *
 * 🔴 **「没权限」和「查不了权限」必须分开。**（Codex P2）
 *    `requirePaidClientAccess` 在 `client_portal_users` 查询失败时返回
 *    `500 / lookup_failed` —— 那是**系统故障**，不是「这个人没权限」。
 *    早先这里把所有非 401 都压成 403，于是一次数据库抖动会被答成
 *    「你无权访问」：界面会当成永久的权限问题引导人去找管理员，
 *    而服务端监控收不到任何 5xx，故障就此隐形。
 *    认不出的状态一律按内部故障抛（→ 500），**不许猜成某个权限结论**。
 *
 * 🔴 **会话里没有邮箱的一律不许操作。** 人签的决策必须记得下是谁签的，
 *    记不下就不该发生 —— 一条 `decided_by_user` 为空的人工授权，
 *    等于审计表里写着「有人批了」但说不出是谁。
 */
export async function requireApprovalActor(clientId: string): Promise<ApprovalActor> {
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    if (access.status === 401) {
      throw new ApprovalError('unauthorized', access.error, { reason: access.reason ?? null })
    }
    if (access.status === 403 || access.status === 402) {
      throw new ApprovalError('forbidden_client', access.error, { reason: access.reason ?? null })
    }
    // 500 lookup_failed 以及将来任何新增的状态：**查不了 ≠ 没权限**。
    // 原样抛成内部故障，由 approvalErrorResponse 答 500 并记日志。
    throw new Error(
      `[kernel-approval] 权限校验没能完成（status=${access.status}, reason=${access.reason ?? '未说明'}）：${access.error}`,
    )
  }

  const email = (access.user.email ?? '').trim().toLowerCase()
  if (email.length === 0) {
    throw new ApprovalError(
      'forbidden_client',
      '这个登录会话没有邮箱 —— 人工审批必须记下是谁批的，记不下就不能批',
      { clientId },
    )
  }

  return { email, tier: access.tier }
}
