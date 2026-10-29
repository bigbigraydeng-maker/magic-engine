/**
 * POST /api/clients/[id]/crm/contacts/[cid]/email/template-preview
 *
 * 通话后选模板：返回渲染好的主题 / 正文、缺什么、文字检查结果、7 天频次（只读）、通话依据、能选的团 / 班期，
 * 以及「能不能发、发给谁、从哪个邮箱」。**不写任何东西、不发信**。
 * 渲染、文字检查、频次、通话依据与真发送用的是同一批函数（见 template-preview.ts）。
 *
 * Body: { key, picks?, inputs?, callBasis?, subject?, body? }  —— subject / body 是销售改过的稿，用来重跑文字检查
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { effectiveFromSettings } from '@/lib/crm/email-templates/effective-config'
import { featureStateOf } from '@/lib/crm/email-templates/feature-state'
import { createPreviewData } from '@/lib/crm/email-templates/preview-prod'
import { parsePreviewRequest } from '@/lib/crm/email-templates/request'
import { loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { previewTemplate } from '@/lib/crm/email-templates/template-preview'
import { previewCompose } from '@/lib/microsoft/mail-send-new'
import { createMailNewDeps } from '@/lib/microsoft/mail-send-new-prod'
import { supabaseAdmin } from '@/lib/supabase'

interface RouteParams {
  params: { id: string; cid: string }
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const sentByEmail = access.user.email?.toLowerCase().trim()
  if (!sentByEmail) return NextResponse.json({ error: '无法确认发送者身份' }, { status: 403 })

  const parsed = parsePreviewRequest(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const settings = await loadEmailSettings(supabaseAdmin, params.id)
    const featureState = featureStateOf(settings)
    if (settings.kind !== 'ok' || featureState !== 'ready') {
      return NextResponse.json({ error: '邮件功能还没开通，或设置无效。', reason: 'feature_off', featureState }, { status: 409 })
    }
    const config = effectiveFromSettings(settings.settings, settings.version)
    const preview = await previewTemplate(
      { clientId: params.id, contactId: params.cid, sentByEmail, config, request: parsed.request, now: new Date() },
      createPreviewData(params.id),
    )
    if (!preview.ok) return NextResponse.json({ error: preview.error, reason: preview.reason }, { status: preview.status })
    const send = await previewCompose({ clientId: params.id, contactId: params.cid }, createMailNewDeps(params.id))
    return NextResponse.json({ ...preview, send })
  } catch (err) {
    console.error('[crm/template-preview] 预览失败:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: '预览暂时生成不了，请稍后再试。' }, { status: 503 })
  }
}
