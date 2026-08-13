/**
 * 审批层的 HTTP 边界件 —— 鉴权顺序与错误映射各**只有一份**。
 *
 * 🔴 三个路由各写一遍的话必然分家，而分家的那一处就是被绕过去的那一处。
 *    路由文件里只剩「取参数 → 调这里 → 调 service → 返回」。
 */

import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import type { AccessTier } from '@/lib/auth/access-types'
import { ApprovalError } from './errors'

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
 * self_serve / portal_only → 403。这里补最后一条：
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
    // 🔴 500 = 权限查询本身炸了（数据库故障），不是「查清楚了、你没权限」——
    //    降级成 forbidden_client 会把系统故障说成用户没权限，客户端不会重试
    //    也不会显示系统故障。原样抛出去，交给 approvalErrorResponse 的兜底答 500。
    if (access.status === 500) {
      throw new Error(`[kernel-approval] 客户权限查询失败：${access.error}`)
    }
    throw new ApprovalError('forbidden_client', access.error, { reason: access.reason ?? null })
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
