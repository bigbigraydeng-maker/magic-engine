/**
 * GET /api/clients/[id]/messenger/conversations/[conversationId]/drafts
 *
 * The AI-drafted replies still waiting on a human decision for this thread
 * (Issue #1588, `conversation_reply_drafts` from #1574). Only `verifier_status
 * = 'pending'` rows come back — a draft only reaches this table's `pending`
 * state after clearing every Verifier gate (#1579), so "在待批准列表里" already
 * means "过关了"; blocked/sent/rejected/etc. drafts belong to history, not the
 * approval queue, and are not this endpoint's job.
 *
 * Same ownership rule as the sibling `messages` route: the conversation id
 * comes from the URL, so it is re-proven against this client and channel
 * rather than trusted from the access guard alone. Channels: messenger + whatsapp.
 *
 * Responses:
 *   200  { drafts: [...] }
 *   401  not authenticated
 *   403  not a member of this client
 *   404  no such thread for this client
 *   500  query failed
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { CTS_CLIENT_ID, ctsVerifierGates } from '@/lib/messenger-agent/verifier/policies/cts'

interface RouteParams {
  params: { id: string; conversationId: string }
}

interface DraftVerifierOutputJson {
  ok?: boolean
  blocked_reasons?: string[]
  /** Per-draft record of which gate ids actually ran — see `CtsVerifierResult` in cts.ts. */
  checked_gate_ids?: string[]
  /**
   * Jev semantic-layer advisory findings — never affects `ok`/`blocked_reasons`
   * (see `CtsVerifierResult` in cts.ts). A `pending` draft can carry these; the
   * portal must surface them so a human reviewing it actually sees the concern
   * (Codex review 2026-09-20 on PR #1838: this is the payload that makes the
   * semantic layer's "flag for human attention" intent real instead of silent).
   */
  semantic_flags?: string[]
}

/**
 * A row only reaches `verifier_status='pending'` after clearing every gate
 * in its client's Verifier policy (#1579) — so "过关记录" for the portal is
 * this policy's own per-draft record, not a list re-declared here. The
 * Verifier is currently CTS-only (`cts.ts`'s own header: "L4 客户专属"), so
 * this only attaches a real list for CTS; another client's drafts (none
 * exist yet — F2/#1585 hasn't shipped for any client) get an empty list
 * rather than this route silently presenting CTS's gates as platform truth.
 *
 * 2026-09-20 起优先读 `verifier_output_json.checked_gate_ids`（`cts.ts` 的
 * `verifyCtsReplyWithSemanticChecks` 写入的真实记录：七道正则闸 + Jev 语义闸
 * 里"这一次真的跑成功了"的那几道，不是一份跟 clientId 绑死的静态清单——Jev
 * 超时/kill switch 关闭/无数据可核时，对应的语义闸 id 不会出现在这里，人审
 * 因此能分清"AI 真的判过、分数不高"和"这次这层压根没跑"，不会被静态清单
 * 误导（子牙+魏征复审 2026-09-20 同时指出）。这次改动上线前写入的历史行没有
 * 这个字段，回退到只声称七道确定性闸过了——不假装那次也跑过语义闸。
 */
function passedGateIdsFor(clientId: string, verifierOutputJson: DraftVerifierOutputJson | null): string[] {
  if (verifierOutputJson?.checked_gate_ids) return verifierOutputJson.checked_gate_ids
  return clientId === CTS_CLIENT_ID ? ctsVerifierGates.map((g) => g.id) : []
}

interface DraftRow {
  id: string
  draft_body: string
  agent_confidence: number | null
  quoted_offering_names: string[] | null
  verifier_output_json: DraftVerifierOutputJson | null
  created_at: string
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data: convo } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('id', params.conversationId)
    .eq('client_id', params.id)
    // WhatsApp 的草稿也走同一套批准流程（2026-10-21：原来写死 messenger，WhatsApp 通过安全检查的草稿
    // 没有任何地方能批准）。批准动作的 reply 路由本身不限渠道，这里放开到 whatsapp。
    .in('channel', ['messenger', 'whatsapp'])
    .maybeSingle()

  if (!convo) {
    return NextResponse.json({ error: '对话不存在' }, { status: 404 })
  }

  const { data, error } = await supabaseAdmin
    .from('conversation_reply_drafts')
    .select('id, draft_body, agent_confidence, quoted_offering_names, verifier_output_json, created_at')
    .eq('client_id', params.id)
    .eq('conversation_id', params.conversationId)
    .eq('verifier_status', 'pending')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as DraftRow[]

  return NextResponse.json({
    drafts: rows.map((d) => ({
      id: d.id,
      draftBody: d.draft_body,
      agentConfidence: d.agent_confidence,
      quotedOfferingNames: d.quoted_offering_names ?? [],
      verifierOutputJson: d.verifier_output_json,
      passedGateIds: passedGateIdsFor(params.id, d.verifier_output_json),
      semanticFlags: d.verifier_output_json?.semantic_flags ?? [],
      createdAt: d.created_at,
    })),
  })
}
