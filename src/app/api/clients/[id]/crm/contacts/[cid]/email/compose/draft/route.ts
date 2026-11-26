/**
 * POST /api/clients/[id]/crm/contacts/[cid]/email/compose/draft
 *
 * 给写邮件框起草主题 + 正文。**只返回文字，不发、不落库、不碰客人。**
 * 只有「这个人现在能在这里写邮件」（previewCompose 通过）才起草 —— 开关没开、没咨询过、别再联系的人不烧 AI。
 *
 * Body（可选）：{ kind?: 'first' | 'follow_up' }。不带 = 'first'（第一封，原来的行为）。
 * 'follow_up' = 跟进信：多返回「我读了什么」(read) 和写完当场跑的检查 (checks)。
 *
 * Responses: 200 { subject, body } | 200 { subject, body, kind: 'follow_up', read, checks }
 *            / 400 / 401 / 403 / 404 / 409 { reason } / 429 冷却 / 502 { reason }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { previewCompose } from '@/lib/microsoft/mail-send-new'
import { createMailNewDeps } from '@/lib/microsoft/mail-send-new-prod'
import { claimDraftSlot, generateFirstEmailDraft } from '@/lib/crm/email-compose/ai-draft'
import { generateFollowUpDraft, type FollowUpFailure } from '@/lib/crm/email-compose/follow-up-draft'

interface RouteParams {
  params: { id: string; cid: string }
}

type DraftKind = 'first' | 'follow_up'

async function readKind(req: NextRequest): Promise<DraftKind | null> {
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return null
  }
  if (raw.trim() === '') return 'first'
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const kind = (parsed as { kind?: unknown }).kind
    if (kind === undefined || kind === 'first') return 'first'
    if (kind === 'follow_up') return 'follow_up'
    return null
  } catch {
    return null
  }
}

const FOLLOW_UP_STATUS: Record<FollowUpFailure, number> = {
  contact_not_found: 404,
  do_not_contact: 409,
  call_dnc: 409,
  not_configured: 409,
  settings_unreadable: 502,
  facts_unreadable: 502,
  no_ai: 502,
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const kind = await readKind(req)
  if (kind === null) {
    return NextResponse.json({ error: '请求格式不对。', reason: 'invalid_input' }, { status: 400 })
  }

  let preview
  try {
    preview = await previewCompose({ clientId: params.id, contactId: params.cid }, createMailNewDeps())
  } catch {
    return NextResponse.json({ error: '系统暂时读不到发信设置。', reason: 'config_unreadable' }, { status: 502 })
  }
  if (!preview.canCompose) {
    return NextResponse.json({ error: preview.message, reason: preview.reason }, { status: 409 })
  }

  if (!claimDraftSlot(`${params.id}:${params.cid}`)) {
    return NextResponse.json({ error: '刚刚起草过，请稍等几秒再试。', reason: 'cooldown' }, { status: 429 })
  }

  if (kind === 'follow_up') {
    const result = await generateFollowUpDraft(params.id, params.cid)
    if (!result.ok) {
      return NextResponse.json({ error: result.message, reason: result.reason }, { status: FOLLOW_UP_STATUS[result.reason] })
    }
    const { subject, body, read, checks } = result.draft
    return NextResponse.json({ subject, body, kind: 'follow_up', read, checks })
  }

  const result = await generateFirstEmailDraft(params.id, params.cid)
  if (!result.ok) {
    const status = result.reason === 'contact_not_found' ? 404 : result.reason === 'call_dnc' ? 409 : 502
    return NextResponse.json({ error: result.message, reason: result.reason }, { status })
  }
  return NextResponse.json({ subject: result.draft.subject, body: result.draft.body })
}
