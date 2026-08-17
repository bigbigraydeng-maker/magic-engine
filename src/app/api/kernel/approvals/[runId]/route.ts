/**
 * GET /api/kernel/approvals/[runId]
 *
 * 一条等人点头的动作的详情 —— 人要看清楚了才点。
 *
 * 🔴 鉴权顺序是死的，不许换：
 *
 *      runId → 服务端读这条 run → run.client_id → requirePaidClientAccess(那个 client_id)
 *
 *    调用方声称的 clientId 一个字都不信（这个路由也压根不收）。
 *    先读后鉴权是安全的：读出来的东西在鉴权通过之前**一个字节都不返回**。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  approvalErrorResponse,
  requireApprovalActor,
  requireUuid,
} from '@/lib/kernel-approval/http'
import {
  approvalPermissionsFor,
  buildApprovalDetail,
  loadRunForApproval,
} from '@/lib/kernel-approval/service'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  try {
    const { runId: rawRunId } = await params

    // ① 🔴 **第一件事**：runId 必须先长得像个 uuid。
    //    放到读库之后的话，畸形路径会让 Postgres 抛 22P02，一路变成 500 ——
    //    「链接被截断了」被记成服务端故障。这一道在**任何**查询和鉴权之前。
    const runId = requireUuid(rawRunId, 'runId')

    // ② 客户归属从这条 run 自己身上读出来
    const run = await loadRunForApproval(supabaseAdmin, runId)

    // ③ 拿它的 client_id 去做真实鉴权
    const actor = await requireApprovalActor(run.client_id)

    // ④ 🔴 **不再因为「批不了」就连详情都不给。**（Codex P2）
    //    早先这里是硬拒的，理由是「免得界面画出一个他其实点不了的按钮」——
    //    但那样一来，契约升版后的旧请求连**看**都看不到，也就没法点「不做」，
    //    永久卡死。正确做法是把「能做什么」如实告诉界面，让它画对按钮。
    const permissions = approvalPermissionsFor(run, actor.tier)

    const detail = await buildApprovalDetail(supabaseAdmin, run)
    return NextResponse.json({
      item: detail,
      actor: { email: actor.email, tier: actor.tier },
      permissions,
    })
  } catch (err) {
    return approvalErrorResponse(err)
  }
}
