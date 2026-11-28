/**
 * POST /api/clients/[id]/crm/contacts/[cid]/email/compose/draft
 *
 * 给写邮件框起草主题 + 正文。**只返回文字，不发、不落库、不碰客人。**
 * 只有「这个人现在能在这里写邮件」（previewCompose 通过）才起草 —— 开关没开、没咨询过、别再联系的人不烧 AI。
 *
 * Body（可选）：{ kind?: 'first' | 'follow_up', surface?: 'drawer' | 'letters_page' | 'day7_page' }。
 * 不带 kind = 'first'（第一封，原来的行为）；不带 surface = 'drawer'（客人抽屉）。
 * 'follow_up' = 跟进信：多返回「我读了什么」(read) 和写完当场跑的检查 (checks)。
 *
 * 每份 AI 稿子都记一行 crm_ai_letters（ai-letter-record.ts），返回它的 aiLetterId；发送时带上它，发信前补上终稿。
 * 记不上就不给稿子（503）：AI 写的信不许不带标记发到客人手里（PM 2026-11-28）。
 *
 * Responses: 200 { subject, body, aiLetterId } | 200 { subject, body, kind: 'follow_up', read, checks, aiLetterId }
 *            / 400 / 401 / 403 / 404 / 409 { reason } / 429 冷却 / 502 { reason }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { previewCompose } from '@/lib/microsoft/mail-send-new'
import { createMailNewDeps } from '@/lib/microsoft/mail-send-new-prod'
import { claimDraftSlot, generateFirstEmailDraft } from '@/lib/crm/email-compose/ai-draft'
import { generateFollowUpDraft, type FollowUpFailure } from '@/lib/crm/email-compose/follow-up-draft'
import { parseSurface, recordAiDraft, type AiDraftKind, type AiDraftRecord, type AiLetterSurface } from '@/lib/crm/email-compose/ai-letter-record'
import { supabaseAdmin } from '@/lib/supabase'

interface RouteParams {
  params: { id: string; cid: string }
}

type DraftKind = AiDraftKind

async function readRequest(req: NextRequest): Promise<{ kind: DraftKind; surface: AiLetterSurface } | null> {
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return null
  }
  if (raw.trim() === '') return { kind: 'first', surface: 'drawer' }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const { kind, surface } = parsed as { kind?: unknown; surface?: unknown }
    const where = parseSurface(surface)
    if (where === null) return null
    if (kind === undefined || kind === 'first') return { kind: 'first', surface: where }
    if (kind === 'follow_up') return { kind: 'follow_up', surface: where }
    return null
  } catch {
    return null
  }
}

const NOT_RECORDED = { error: 'AI 写好了，但「AI 起草」的标记没记上，这份稿子先不给你。稍后再试。', reason: 'not_recorded' }

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

  const actorEmail = access.user.email?.toLowerCase().trim()
  if (!actorEmail) return NextResponse.json({ error: '无法确认是谁在起草', reason: 'no_actor' }, { status: 403 })
  const asked = await readRequest(req)
  if (asked === null) {
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

  const record = async (kind: DraftKind, subject: string, body: string, checks: AiDraftRecord['checks']): Promise<string | null> => {
    try {
      return await recordAiDraft(supabaseAdmin, { clientId: params.id, contactId: params.cid, surface: asked.surface, kind, subject, body, checks, actorEmail })
    } catch (err) {
      console.error('[crm/compose/draft] AI 稿子记不上:', err instanceof Error ? err.message : err)
      return null
    }
  }

  if (asked.kind === 'follow_up') {
    const result = await generateFollowUpDraft(params.id, params.cid)
    if (!result.ok) {
      return NextResponse.json({ error: result.message, reason: result.reason }, { status: FOLLOW_UP_STATUS[result.reason] })
    }
    const { subject, body, read, checks } = result.draft
    const aiLetterId = await record('follow_up', subject, body, checks)
    if (aiLetterId === null) return NextResponse.json(NOT_RECORDED, { status: 503 })
    return NextResponse.json({ subject, body, kind: 'follow_up', read, checks, aiLetterId })
  }

  const result = await generateFirstEmailDraft(params.id, params.cid)
  if (!result.ok) {
    const status = result.reason === 'contact_not_found' ? 404 : result.reason === 'call_dnc' ? 409 : 502
    return NextResponse.json({ error: result.message, reason: result.reason }, { status })
  }
  const aiLetterId = await record('first', result.draft.subject, result.draft.body, [])
  if (aiLetterId === null) return NextResponse.json(NOT_RECORDED, { status: 503 })
  return NextResponse.json({ subject: result.draft.subject, body: result.draft.body, aiLetterId })
}
