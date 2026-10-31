/**
 * GET /api/clients/[id]/crm/email-settings   读发信设置（总开关、发信邮箱、频次上限、灰度名单、链接白名单、禁用词…）
 * PUT /api/clients/[id]/crm/email-settings   保存 = 追加新版本
 *
 * 🔴 只有全局管理员（exact ADMIN_EMAILS，且不是受限管理员）能读写——这些设置决定「对客外发的刹车」放不放宽。
 * 开着功能又清空灰度名单（= 对所有客人放开）必须带 confirmUnrestricted:true，不能是顺手保存。
 * 设置严格解析：任何坏值 / 缺项 / 多余键 = 400，绝不套默认值。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { canEditSettings, parseSettingsWrite, unrestrictedNeedsConfirmation } from '@/lib/crm/email-templates/settings-input'
import { serialiseEmailSettings } from '@/lib/crm/email-templates/settings'
import { appendEmailSettings, listSettingsHistory, loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { statusForAppend } from '@/lib/crm/email-templates/template-input'
import { supabaseAdmin } from '@/lib/supabase'

interface RouteParams {
  params: { id: string }
}

const ADMIN_ONLY = { error: '发信设置只有 Magic Lab 的全局管理员能看和改。', reason: 'GLOBAL_ADMIN_REQUIRED' }

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!canEditSettings(access.user.email, access.allowedClientId)) return NextResponse.json(ADMIN_ONLY, { status: 403 })
  try {
    const loaded = await loadEmailSettings(supabaseAdmin, params.id)
    const history = await listSettingsHistory(supabaseAdmin, params.id, 10)
    if (loaded.kind === 'none') return NextResponse.json({ state: 'none', version: null, settings: null, errors: [], history })
    if (loaded.kind === 'invalid') {
      return NextResponse.json({ state: 'invalid', version: loaded.version, settings: null, errors: loaded.errors, history })
    }
    return NextResponse.json({ state: 'ok', version: loaded.version, settings: serialiseEmailSettings(loaded.settings), errors: [], history })
  } catch (err) {
    console.error('[crm/email-settings] 读取失败:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: '发信设置暂时读不到，请联系 Magic Lab 团队。' }, { status: 503 })
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const email = access.user.email?.toLowerCase().trim()
  if (!email || !canEditSettings(email, access.allowedClientId)) return NextResponse.json(ADMIN_ONLY, { status: 403 })

  const parsed = parseSettingsWrite(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, errors: parsed.errors }, { status: 400 })
  if (unrestrictedNeedsConfirmation(parsed.settings, parsed.confirmUnrestricted)) {
    return NextResponse.json(
      { error: '功能开着、灰度名单是空的，等于对所有客人放开。如果确实要放开，请明确确认。', reason: 'unrestricted_needs_confirmation' },
      { status: 400 },
    )
  }

  const result = await appendEmailSettings(supabaseAdmin, {
    clientId: params.id,
    baseVersion: parsed.baseVersion,
    settings: parsed.settings,
    changeNote: parsed.changeNote,
    createdBy: email,
  })
  if (!result.ok) return NextResponse.json({ error: result.message, reason: result.reason }, { status: statusForAppend(result.reason) })
  return NextResponse.json({ ok: true, version: result.value.version })
}
