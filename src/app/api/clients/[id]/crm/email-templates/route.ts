/**
 * GET  /api/clients/[id]/crm/email-templates   模板列表（每个模板的当前版本）+ 近 30 天发出 / 被拦次数 + 功能状态
 * POST /api/clients/[id]/crm/email-templates   新建模板（版本 1，默认停用）——仅内部账号 / 受限管理员
 *
 * 设计稿：docs/specs/2026-10-28-crm-post-call-email-templates-design-v0.md §11
 * 看模板 = 付费客户员工；改模板 = requireOperatorAccess。模板每次保存都是新版本，旧版本不改不删。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireOperatorAccess, requirePaidClientAccess } from '@/lib/auth/client-access'
import { featureStateOf } from '@/lib/crm/email-templates/feature-state'
import { summariseReceiptsSince } from '@/lib/crm/email-templates/receipt-store'
import { canEditSettings } from '@/lib/crm/email-templates/settings-input'
import { loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { checkTemplateForSave, parseTemplateWrite, statusForAppend } from '@/lib/crm/email-templates/template-input'
import { appendTemplateVersion, listCurrentTemplates } from '@/lib/crm/email-templates/template-store'
import { supabaseAdmin } from '@/lib/supabase'

interface RouteParams {
  params: { id: string }
}

const DAY_MS = 86_400_000
const UNAVAILABLE = '邮件模板功能暂时读不到数据，请联系 Magic Lab 团队。'

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const since = new Date(Date.now() - 30 * DAY_MS).toISOString()
    const [settings, templates, stats] = await Promise.all([
      loadEmailSettings(supabaseAdmin, params.id).catch(() => null),
      listCurrentTemplates(supabaseAdmin, params.id),
      summariseReceiptsSince(supabaseAdmin, params.id, since),
    ])
    return NextResponse.json({
      featureState: featureStateOf(settings),
      // 只决定按钮显不显示；真正的权限在 POST / PUT 里由 requireOperatorAccess 把关
      canEditTemplates: access.role === 'admin',
      canEditSettings: canEditSettings(access.user.email, access.allowedClientId),
      templates,
      stats,
    })
  } catch (err) {
    console.error('[crm/email-templates] 读取失败:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: UNAVAILABLE }, { status: 503 })
  }
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requireOperatorAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const email = access.user.email?.toLowerCase().trim()
  if (!email) return NextResponse.json({ error: '无法确认操作人身份' }, { status: 403 })

  const parsed = parseTemplateWrite(await req.json().catch(() => null), 'create')
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (parsed.templateKey === null) return NextResponse.json({ error: '模板标识不能为空。' }, { status: 400 })

  const settings = await loadEmailSettings(supabaseAdmin, params.id).catch(() => null)
  const check = checkTemplateForSave(parsed.fields, settings?.kind === 'ok' ? settings.settings : null)
  if (check.errors.length > 0) return NextResponse.json({ error: check.errors[0], errors: check.errors }, { status: 400 })

  const result = await appendTemplateVersion(supabaseAdmin, {
    clientId: params.id,
    templateKey: parsed.templateKey,
    baseVersion: null,
    ...parsed.fields,
    createdBy: email,
  })
  if (!result.ok) return NextResponse.json({ error: result.message, reason: result.reason }, { status: statusForAppend(result.reason) })
  return NextResponse.json({ template: result.value, notices: check.notices }, { status: 201 })
}
