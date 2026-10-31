/**
 * GET /api/clients/[id]/crm/contacts/[cid]/email/post-call
 *
 * 抽屉上「通话后发邮件」提示条的状态：功能能不能用、有哪些启用中的模板、有没有系统记录的接通电话、
 * 这通电话之后是不是已经发过邮件。只读。功能没开通时只回 featureState（普通员工界面据此什么都不显示）。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { featureStateOf } from '@/lib/crm/email-templates/feature-state'
import { loadPostCallState } from '@/lib/crm/email-templates/post-call-state'
import { createPreviewData } from '@/lib/crm/email-templates/preview-prod'
import { canEditSettings } from '@/lib/crm/email-templates/settings-input'
import { loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { listCurrentTemplates } from '@/lib/crm/email-templates/template-store'
import { supabaseAdmin } from '@/lib/supabase'

interface RouteParams {
  params: { id: string; cid: string }
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const settingsAdmin = canEditSettings(access.user.email, access.allowedClientId)
  try {
    const settings = await loadEmailSettings(supabaseAdmin, params.id).catch(() => null)
    const featureState = featureStateOf(settings)
    const callPromptHours = settings?.kind === 'ok' ? settings.settings.callPromptHours : 24
    const templates = featureState === 'ready' ? await listCurrentTemplates(supabaseAdmin, params.id) : []
    const result = await loadPostCallState(
      { clientId: params.id, contactId: params.cid, featureState, callPromptHours, templates, now: new Date() },
      createPreviewData(params.id),
    )
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ ...result.state, canEditSettings: settingsAdmin })
  } catch (err) {
    console.error('[crm/post-call] 读取失败:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: '通话后邮件的状态暂时读不到。' }, { status: 503 })
  }
}
