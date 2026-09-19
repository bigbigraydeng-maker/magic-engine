/**
 * POST /api/clients/[id]/messenger/conversations/[conversationId]/reply
 *
 * Two request shapes, told apart by whether `draft_id` is present:
 *
 * 1. Free-text send — `{ body: string, usedAiDraft?: boolean }`. Send a
 *    Messenger reply as the client's Page. A human must have pressed send —
 *    nothing here is triggered by the AI. Every attempt is written to
 *    conversation_outbound_log with the signed-in email attached.
 *
 * 2. Draft decision (Issue #1586, F3 `conversation.approval.emit`) —
 *    `{ draft_id: string, action: 'approve' | 'edit_and_approve' | 'reject',
 *    edited_body?: string }`. This is the portal's "批准发送 / 改后发送 /
 *    拒绝并接管" three-button decision on an AI-drafted reply
 *    (`conversation_reply_drafts`, Issue #1574) that already passed the
 *    Verifier (Issue #1579) and is waiting on a human. `approve` /
 *    `edit_and_approve` mark the draft `verifier_status='approved'` and emit
 *    `conversation/reply.approved` so F2's (#1585) `step.waitForEvent` can
 *    proceed to actually send it — this route does NOT send the message
 *    itself. `reject` only flips the draft to `verifier_status='rejected'`;
 *    it does not notify F2, because rejecting means a human takes over and
 *    replies manually outside this automated path (design doc's three-button
 *    UX: "拒绝并接管").
 *
 * Responses (free-text send):
 *   200  { ok: true, window }
 *   400  empty body
 *   401  not authenticated
 *   403  not a member of this client, or the thread belongs to another client
 *   404  conversation not found
 *   409  Meta's reply window has closed
 *   424  Meta auth not configured for this client
 *   502  Meta rejected the message
 *
 * Responses (draft decision):
 *   200  { ok: true, verifier_status: 'approved' | 'rejected' }
 *   400  missing/invalid draft_id, action, or edit_and_approve without a
 *        non-empty edited_body under the 1800-char hard cap
 *   401  not authenticated
 *   403  not a member of this client
 *   404  no such draft for this client + conversation
 *   409  draft is not in 'pending' state — either already decided by someone
 *        else (including a concurrent request that won the race, see below),
 *        or blocked by the Verifier and never eligible for this endpoint
 *   502  DB update succeeded but notifying F2 failed — draft is rolled back to
 *        'pending' so the human sees an explicit error and can retry, rather
 *        than a draft silently stuck "approved" with nobody ever told to send it
 *
 * 🔴 魏征复审（2026-09-15）实测发现的真实并发漏洞，这里记录修法：原实现是
 * "SELECT 读 verifier_status → 应用代码判断是不是 pending → 再单独发一次无条件
 * UPDATE"，SELECT 和 UPDATE 中间没有任何东西挡住第二个并发请求——两个人（或同一人
 * 手抖双击）几乎同时分别点"批准"和"拒绝"，两个请求的 SELECT 都能读到 'pending'、
 * 都通过检查，后写入的那个会无条件覆盖前一个的结果：可能出现"批准的事件已经真的
 * 发给 F2、DB 却显示 rejected"这种数据库记录和真实副作用对不上的状态，正好击穿
 * 方案文档反复强调的"人工审核是唯一把关"这条安全承诺。修法：把"状态必须是
 * pending"这个条件下推进 UPDATE 语句本身（`.eq('verifier_status', 'pending')`），
 * 而不是只在应用代码里判断一次——Postgres 对同一行的并发 UPDATE 会用行锁互相排队，
 * 后到的那个 UPDATE 在拿到锁之后会重新核对 WHERE 条件，此时状态已经不是 'pending'，
 * 于是它天然影响 0 行，用返回的受影响行数（而不是"提前查一次再假设它还没变"）来判断
 * 这次决定有没有真的生效——这才是不可被竞态穿透的原子判断。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { sendReply } from '@/lib/messenger/send'
import { supabaseAdmin } from '@/lib/supabase'
import { emitConversationApprovalEvent } from '@/lib/messenger-agent/conversation-approval-emit'

interface RouteParams {
  params: { id: string; conversationId: string }
}

const DRAFT_ACTIONS = ['approve', 'edit_and_approve', 'reject'] as const
type DraftAction = (typeof DRAFT_ACTIONS)[number]

function isDraftAction(value: unknown): value is DraftAction {
  return typeof value === 'string' && (DRAFT_ACTIONS as readonly string[]).includes(value)
}

/** 跟 `verifier/policies/cts.ts` 的 `MAX_REPLY_LENGTH` 同一个数字——两个渠道里更
 *  严格的那个上限。人工编辑后的文本不会重新走完整套 Verifier 七道闸（人工批准
 *  本身就是这条路径的安全网，见下方"改后发送"分支注释），但这是一条零成本的
 *  机械硬限制，没有理由不在这里也挡一下（魏征复审建议）。 */
const MAX_EDITED_BODY_LENGTH = 1800

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface DraftRow {
  id: string
  client_id: string
  conversation_id: string
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const email = access.user.email?.toLowerCase().trim()
  if (!email) {
    // Every outbound message must be attributable to a person; an unattributable
    // send is worse than no send.
    return NextResponse.json({ error: '无法确认发送者身份' }, { status: 403 })
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  if (typeof payload.draft_id === 'string') {
    return handleDraftDecision(params, email, payload.draft_id, payload)
  }

  if (typeof payload.body !== 'string') {
    return NextResponse.json({ error: '回复内容不能为空' }, { status: 400 })
  }

  const result = await sendReply({
    clientId: params.id,
    conversationId: params.conversationId,
    body: payload.body,
    sentByEmail: email,
    usedAiDraft: payload.usedAiDraft === true,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error, reason: result.reason }, { status: result.status })
  }

  return NextResponse.json({ ok: true, window: result.window })
}

async function handleDraftDecision(
  params: RouteParams['params'],
  email: string,
  draftId: string,
  payload: Record<string, unknown>,
): Promise<NextResponse> {
  if (!UUID_RE.test(draftId)) {
    // draft_id 是这张表的 uuid 主键——格式明显不对的输入不该走到数据库层才
    // 报错（Postgres 会把类型转换失败当成一个不透明的查询错误，跟真正的连接/
    // 权限故障混在一起，排障时分不清是客户端传错了还是服务真的挂了）。
    return NextResponse.json({ error: 'draft_id 不是合法的 UUID' }, { status: 400 })
  }
  if (!isDraftAction(payload.action)) {
    return NextResponse.json(
      { error: 'action 必须是 approve / edit_and_approve / reject 之一' },
      { status: 400 },
    )
  }
  const action = payload.action

  const editedBody = action === 'edit_and_approve' ? payload.edited_body : undefined
  if (action === 'edit_and_approve') {
    if (typeof editedBody !== 'string' || editedBody.trim().length === 0) {
      return NextResponse.json({ error: 'edit_and_approve 必须带非空的 edited_body' }, { status: 400 })
    }
    if (editedBody.length > MAX_EDITED_BODY_LENGTH) {
      return NextResponse.json(
        { error: `edited_body 是 ${editedBody.length} 个字符，超过 ${MAX_EDITED_BODY_LENGTH} 字符上限` },
        { status: 400 },
      )
    }
  }

  // 双 key 归属校验（IDOR 闸，跟 query_conversation_history/optout.ts 同一条纪律）：
  // draft_id 本身不足以信任——必须同时确认它属于 URL 里的 client 和 conversation，
  // 不能让一个知道别人 draft_id 的人跨客户批准/拒绝一条不属于自己的草稿。这一次
  // 查询只用来判断"存不存在/是不是这个客户和会话的"（404 用），不再顺带信任它读到
  // 的 verifier_status——那个值到下面真正 UPDATE 的那一刻可能已经被并发请求改掉，
  // 见文件头"魏征复审"那段并发漏洞说明。
  const { data: draft, error: fetchError } = await supabaseAdmin
    .from('conversation_reply_drafts')
    .select('id, client_id, conversation_id')
    .eq('id', draftId)
    .eq('client_id', params.id)
    .eq('conversation_id', params.conversationId)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ error: `查询草稿失败：${fetchError.message}` }, { status: 500 })
  }
  if (!(draft as DraftRow | null)) {
    return NextResponse.json({ error: '草稿不存在，或不属于这个客户/会话' }, { status: 404 })
  }

  if (action === 'reject') {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('conversation_reply_drafts')
      .update({ verifier_status: 'rejected', decided_at: new Date().toISOString(), decided_by_email: email })
      .eq('id', draftId)
      .eq('verifier_status', 'pending') // 原子条件更新——见文件头并发漏洞说明
      .select('id')
    if (updateError) {
      return NextResponse.json({ error: `拒绝失败：${updateError.message}` }, { status: 500 })
    }
    if (!updated || updated.length === 0) {
      return notPendingResponse()
    }
    return NextResponse.json({ ok: true, verifier_status: 'rejected' })
  }

  // approve / edit_and_approve
  const approvePatch: Record<string, unknown> = {
    verifier_status: 'approved',
    decided_at: new Date().toISOString(),
    decided_by_email: email,
  }
  if (action === 'edit_and_approve') {
    approvePatch.draft_body = editedBody
  }

  const { data: approved, error: approveError } = await supabaseAdmin
    .from('conversation_reply_drafts')
    .update(approvePatch)
    .eq('id', draftId)
    .eq('verifier_status', 'pending') // 原子条件更新——同上，不信任早前 SELECT 读到的状态
    .select('id')
  if (approveError) {
    return NextResponse.json({ error: `批准失败：${approveError.message}` }, { status: 500 })
  }
  if (!approved || approved.length === 0) {
    return notPendingResponse()
  }

  try {
    await emitConversationApprovalEvent({
      draftId,
      clientId: params.id,
      conversationId: params.conversationId,
      decidedByEmail: email,
    })
  } catch (err) {
    // Fail-closed 补偿：通知 F2 失败就把状态退回 pending，让人看到明确的错误再重试——
    // 不能留一条 DB 里"已批准"但 F2 永远收不到唤醒事件的草稿，那会静默卡到 4 小时
    // 超时，且没人知道发生了什么（跟 src/lib/knowledge/kill-switch.ts 头注释同一条
    // 纪律：失败方向必须是安全的那一边，不是显得"已经成功"的那一边）。
    //
    // 这一步的原子条件更新用不着再加 `.eq('verifier_status', 'approved')`——我们
    // 刚刚自己那次条件更新已经把这一行从 'pending' 原子地改成了 'approved'，在这
    // 中间不可能有另一个并发请求把它改成别的状态（任何其它决定都会因为
    // WHERE verifier_status='pending' 不成立而影响 0 行）。
    //
    // 🔴 子牙+魏征复审都独立指出：这次回滚 UPDATE 本身也可能失败，之前的实现完全
    // 没检查这个返回值——如果两次失败叠在一起（emit 失败 + 回滚也失败），旧代码
    // 会照样说"已回退为待批准状态，请重试"，但草稿其实卡在 approved，人照着提示
    // 重试时会撞上 409（因为状态不是 pending），跟刚才那句话自相矛盾。现在检查
    // 这次回滚的结果，两种失败分别给出不会说谎的错误信息，并且用 console.error
    // 留一条能被日志检索/未来 F4 心跳捞到的记录——不能让"回滚失败"这个发现本身
    // 又消失在没人看的地方。
    const { error: rollbackError } = await supabaseAdmin
      .from('conversation_reply_drafts')
      .update({ verifier_status: 'pending', decided_at: null, decided_by_email: null })
      .eq('id', draftId)

    const emitErrorMessage = err instanceof Error ? err.message : String(err)

    if (rollbackError) {
      console.error(
        `[messenger/reply] draft ${draftId} 卡在不一致状态：approve 写库成功、emit 失败` +
        `（${emitErrorMessage}）、回滚也失败（${rollbackError.message}）——这条草稿需要` +
        `人工直接去数据库核实，不能指望 FDE 重试按钮能自己修好。`,
      )
      return NextResponse.json(
        {
          error:
            `批准已写入数据库，但通知发送流程失败，且回退为待批准状态的操作也失败了——` +
            `这条草稿处于不一致状态，需要人工核实（draft_id: ${draftId}），不要只是重试`,
        },
        { status: 502 },
      )
    }

    return NextResponse.json(
      { error: `批准已写入数据库，但通知发送流程失败，已回退为待批准状态，请重试：${emitErrorMessage}` },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true, verifier_status: 'approved' })
}

function notPendingResponse(): NextResponse {
  // 原子条件更新影响 0 行，只可能是因为这一刻状态已经不是 'pending' 了——要么是
  // 已经被另一个并发请求决定过，要么是从一开始就被 Verifier 挡在 pending 之外
  // （blocked）。两种情况对调用方来说是同一种处理："这条草稿现在不能再被你决定"，
  // 不需要（也没法在不重新查一次的前提下）区分是哪一种——重新查一次只是把同样的
  // 竞态窗口又打开一次，没有实际意义。
  return NextResponse.json(
    { error: '这条草稿现在不是"待批准"状态（可能刚被别人处理过，或本来就没进入待批准），不能再批准/拒绝', reason: 'not_pending' },
    { status: 409 },
  )
}
