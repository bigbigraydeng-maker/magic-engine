/**
 * GET /api/clients/[id]/crm/email-templates/[key]   一个模板的当前版本 + 全部历史版本
 * PUT /api/clients/[id]/crm/email-templates/[key]   保存 = 追加新版本（停用 / 启用也是新版本）——仅内部账号 / 受限管理员
 *
 * PUT 必须写明改的是哪一版（baseVersion）；别人在这期间改过就 409，不会悄悄盖掉。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireOperatorAccess, requirePaidClientAccess } from '@/lib/auth/client-access'
import { loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { checkTemplateForSave, parseTemplateWrite, statusForAppend } from '@/lib/crm/email-templates/template-input'
import {
  TEMPLATE_KEY_RE,
  appendTemplateVersion,
  getCurrentTemplate,
  listTemplateHistory,
} from '@/lib/crm/email-templates/template-store'
import { supabaseAdmin } from '@/lib/supabase'

interface RouteParams {
  params: { id: string; key: string }
}

const UNAVAILABLE = '邮件模板功能暂时读不到数据，请联系 Magic Lab 团队。'
const BAD_KEY = { error: '模板标识不对。' }

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!TEMPLATE_KEY_RE.test(params.key)) return NextResponse.json(BAD_KEY, { status: 404 })
  try {
    const current = await getCurrentTemplate(supabaseAdmin, params.id, params.key)
    if (current === null) return NextResponse.json({ error: '找不到这个模板。' }, { status: 404 })
    const history = await listTemplateHistory(supabaseAdmin, params.id, params.key)
    return NextResponse.json({ template: current, history })
  } catch (err) {
    console.error('[crm/email-templates/key] 读取失败:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: UNAVAILABLE }, { status: 503 })
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requireOperatorAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const email = access.user.email?.toLowerCase().trim()
  if (!email) return NextResponse.json({ error: '无法确认操作人身份' }, { status: 403 })
  if (!TEMPLATE_KEY_RE.test(params.key)) return NextResponse.json(BAD_KEY, { status: 404 })

  const parsed = parseTemplateWrite(await req.json().catch(() => null), 'update')
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const settings = await loadEmailSettings(supabaseAdmin, params.id).catch(() => null)
  const check = checkTemplateForSave(parsed.fields, settings?.kind === 'ok' ? settings.settings : null)
  if (check.errors.length > 0) return NextResponse.json({ error: check.errors[0], errors: check.errors }, { status: 400 })

  const result = await appendTemplateVersion(supabaseAdmin, {
    clientId: params.id,
    templateKey: params.key,
    baseVersion: parsed.baseVersion,
    ...parsed.fields,
    createdBy: email,
  })
  if (!result.ok) return NextResponse.json({ error: result.message, reason: result.reason }, { status: statusForAppend(result.reason) })
  return NextResponse.json({ template: result.value, notices: check.notices })
}
