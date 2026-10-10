/**
 * FDE 审核队列 API（issue #1646，design doc §3.3）。
 *
 * GET  —— 这个客户所有待审候选，按「先冲突组、再新增、再佐证」排好序。
 * POST —— 对一条候选下一个决定（批准 / 改后批准 / 驳回 / 禁止对客说 / 设有效期）。
 *
 * 🔴 只给 ME 内部人员（`tier === 'admin'`，即 FDE / PM / 受限管理员）。设计稿
 * §3.3 明确 v1 的审核页是 ME 内部后台，不是客户自助页：批准是 ME 这一签，
 * 客户那一签走确认链接。如果客户账号也能在这里点批准，双签就退化成同一个
 * 人点两下——这正是这道闸存在的理由。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { knowledgeWriteClient } from '@/lib/knowledge/admin-client'
import {
  applyCandidateDecision,
  listKnowledgeCandidates,
  KnowledgeReviewError,
  type CandidateDecision,
} from '@/lib/knowledge/review'
import { KnowledgeReadError } from '@/lib/knowledge/errors'

type Params = { params: { id: string } }

async function requireFde(clientId: string) {
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: access.error, reason: access.reason },
        { status: access.status },
      ),
    }
  }
  if (access.tier !== 'admin') {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: '知识库审核页只对 Magic Engine 内部人员开放' },
        { status: 403 },
      ),
    }
  }
  return { ok: true as const, actorEmail: (access.user.email ?? '').trim() }
}

export async function GET(_req: NextRequest, { params }: Params) {
  const gate = await requireFde(params.id)
  if (!gate.ok) return gate.response

  try {
    const groups = await listKnowledgeCandidates(params.id, knowledgeWriteClient())
    return NextResponse.json({ success: true, groups })
  } catch (err) {
    // 读失败抛错、绝不返回空列表——空列表在审核页上长得跟「没东西要审」
    // 一模一样，FDE 会直接合上页面走人。
    const message = err instanceof KnowledgeReadError ? err.message : err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/** 把请求体翻译成一个 CandidateDecision，形状不对就明确拒绝，不猜。 */
function parseDecision(body: unknown): { factId: string; decision: CandidateDecision } | { error: string } {
  const raw = body as Record<string, unknown> | null
  const factId = typeof raw?.fact_id === 'string' ? raw.fact_id.trim() : ''
  if (!factId) return { error: '缺少 fact_id' }

  const action = typeof raw?.action === 'string' ? raw.action : ''
  switch (action) {
    case 'approve':
      return { factId, decision: { action: 'approve' } }
    case 'forbid':
      return { factId, decision: { action: 'forbid' } }
    case 'reject':
      return {
        factId,
        decision: { action: 'reject', note: typeof raw?.note === 'string' ? raw.note : undefined },
      }
    case 'set_valid_until': {
      const validUntil = raw?.valid_until
      if (validUntil !== null && typeof validUntil !== 'string') return { error: 'valid_until 必须是日期字符串或 null' }
      return { factId, decision: { action: 'set_valid_until', validUntil: validUntil ?? null } }
    }
    case 'approve_with_edits': {
      const decision: CandidateDecision = { action: 'approve_with_edits' }
      if (typeof raw?.statement === 'string') decision.statement = raw.statement
      if ('structured_value' in (raw ?? {})) decision.structuredValue = raw?.structured_value
      if (raw?.scope && typeof raw.scope === 'object' && !Array.isArray(raw.scope)) {
        decision.scope = raw.scope as Record<string, unknown>
      }
      if ('valid_until' in (raw ?? {})) {
        const validUntil = raw?.valid_until
        if (validUntil !== null && typeof validUntil !== 'string') {
          return { error: 'valid_until 必须是日期字符串或 null' }
        }
        decision.validUntil = validUntil ?? null
      }
      return { factId, decision }
    }
    default:
      return { error: `不认识的操作：${action || '(空)'}` }
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const gate = await requireFde(params.id)
  if (!gate.ok) return gate.response
  if (!gate.actorEmail) {
    return NextResponse.json({ success: false, error: '拿不到登录邮箱，无法记录是谁批的' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: '请求体不是合法 JSON' }, { status: 400 })
  }

  const parsed = parseDecision(body)
  if ('error' in parsed) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 })

  try {
    await applyCandidateDecision(knowledgeWriteClient(), {
      clientId: params.id,
      factId: parsed.factId,
      actorEmail: gate.actorEmail,
      decision: parsed.decision,
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof KnowledgeReviewError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 409 })
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
