/**
 * GET /api/kernel/approvals?clientId=...
 *
 * 某个客户当前**等人点头**的动作清单。
 *
 * 🔴 `clientId` 是一个**客户选择器**，不是权限凭据。
 *    进来第一件事就是拿它去做真实的客户权限校验（`requirePaidClientAccess`），
 *    过了之后这个值再被钉死成数据库侧的过滤条件。
 *    「你说你要看 A 客户」永远不等于「你有权看 A 客户」。
 *
 * 🔴 **`200 []` 只在一种情况下出现：内核已启用、这个客户此刻没有等审批的动作。**
 *    内核的表根本不存在时答 503 `kernel_not_provisioned` —— 因为那时候
 *    「没有待办」是假的：那套东西整个没打开，任何等人点头的动作都永远不会出现在这里。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { ApprovalError } from '@/lib/kernel-approval/errors'
import {
  approvalErrorResponse,
  requireApprovalActor,
  requireUuid,
} from '@/lib/kernel-approval/http'
import { listPendingApprovals } from '@/lib/kernel-approval/service'

/**
 * 查询串里的数字参数。
 *
 * 🔴 读不成数字返回 `undefined`（= 用默认值），**不返回 0**。
 *    把「没给」和「给了 0」当成一回事，`?offset=abc` 就会静静地被当成第一页。
 */
function numericParam(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const rawClientId = (req.nextUrl.searchParams.get('clientId') ?? '').trim()
    if (rawClientId.length === 0) {
      throw new ApprovalError('invalid_request', '要看哪个客户的待审批？请带上 clientId')
    }

    // ① 🔴 先判语法 —— 它最终会打在 `action_runs.client_id` 这个 uuid 列上。
    //    畸形值不判的话，Postgres 抛 22P02，接口答 500，把客户端问题
    //    记成服务端故障。在鉴权和查询之前。
    const clientId = requireUuid(rawClientId, 'clientId')

    // ② 再鉴权 —— 过不了就到此为止，一条数据都不查
    await requireApprovalActor(clientId)

    // ③ 再查，且客户过滤钉死在数据库侧
    const { items, skippedRunIds, hasMore, limit, nextCursor } = await listPendingApprovals(
      supabaseAdmin,
      clientId,
      {
        limit: numericParam(req.nextUrl.searchParams.get('limit')),
        // 🔴 游标是不透明的：原样收、原样回，服务端不解释它的语义给调用方听。
        cursor: req.nextUrl.searchParams.get('cursor') ?? undefined,
      },
    )

    return NextResponse.json({
      clientId,
      items,
      // 🔴 数据不一致的那几条如实报出来，不悄悄少给。
      //    少给一条等审批的动作 = 它永远不会被处理，而界面上看不出少了东西。
      skippedRunIds,
      // 🔴 截断绝不许是静默的。`hasMore` 为真时，把 `nextCursor` 原样回传来翻下一页。
      //    用游标不用 offset：待审批是活队列，翻页期间前面的条目被处理掉之后
      //    offset 会整体左移、跳掉紧接着的那几条（见 queries.ts）。
      hasMore,
      limit,
      nextCursor,
    })
  } catch (err) {
    return approvalErrorResponse(err)
  }
}
