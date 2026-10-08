/**
 * GET/PATCH /api/clients/[id]/factory-reel-ad-draft-config
 *
 * 工厂 Reel 自动起草广告 · 每客户开关 + 参数（读写）。
 *
 * 这个路由**只**改开关和参数：真正把广告打开只能走 /api/ad-approval，由 PM 点。
 * 自动起草永远只碰「已暂停」的广告，不可能把广告打开。
 *
 * 存在 `ad_strategy_configs.factory_reel_ad_draft` 这一列里；migration 还没 apply 时
 * 写库会报「列不存在」，这里统一翻成 503 人话，不把原始报错甩给界面。
 *
 * 词表 / 解析 / 读取都在 config.ts 定义一次，这里只做鉴权、拼装、落库。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { requireSession } from '@/lib/auth/require-session'
import {
  FACTORY_REEL_DRAFT_MODES,
  isMissingColumnError,
  loadFactoryReelDraftConfig,
  parseFactoryReelDraftConfig,
} from '@/lib/ads-strategy/factory-reel-draft/config'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  // 只放行 Magic Engine 内部员工（全局 admin）：自动花钱的事，客户成员不能自己开。
  const guard = await guardGlobalAdmin()
  if (guard) return guard

  const { config, effectiveMode, source } = await loadFactoryReelDraftConfig(supabaseAdmin, clientId)

  // migration 还没 apply：读不到列，界面要显示「数据库还没升级」，不能渲染成空配置。
  if (source === 'column_missing') {
    return NextResponse.json({ error: '数据库还没升级，请联系技术' }, { status: 503 })
  }

  // 原始报错（loader 的 error 字段）不下发 —— 只给 source，前端据此显示「读不到」。
  return NextResponse.json({
    success: true,
    config,
    effectiveMode,
    source,
    modes: FACTORY_REEL_DRAFT_MODES,
  })
}

/** 只认这几个键，其余（含客户端自己塞的 updated_by / updated_at）一律忽略。 */
const CANDIDATE_KEYS = [
  'mode',
  'geo_countries',
  'geo_city_keys',
  'age_min',
  'age_max',
  'daily_budget',
  'duration_days',
  'max_age_hours',
] as const

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const guard = await guardGlobalAdmin()
  if (guard) return guard

  const session = await requireSession()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求内容不是合法的 JSON。' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: '请求内容格式不对。' }, { status: 400 })
  }

  const raw = body as Record<string, unknown>

  // 关闭开关只需要 mode，紧急时不该因为缺参数而关不掉；打开仍须完整参数。
  const isOffShortcut =
    raw.mode === 'off' &&
    !CANDIDATE_KEYS.some(key => key !== 'mode' && key in raw)

  if (isOffShortcut) {
    const { data, error: readError } = await supabaseAdmin
      .from('ad_strategy_configs')
      .select('factory_reel_ad_draft')
      .eq('client_id', clientId)
      .maybeSingle()

    if (readError) {
      if (isMissingColumnError(readError)) {
        return NextResponse.json({ error: '数据库还没升级，请联系技术' }, { status: 503 })
      }
      console.error('[factory-reel-ad-draft-config] read failed', { clientId, code: readError.code, message: readError.message })
      return NextResponse.json({ error: '保存失败，请稍后重试。' }, { status: 500 })
    }

    const existing = (data as { factory_reel_ad_draft?: unknown } | null)?.factory_reel_ad_draft
    const stored: Record<string, unknown> =
      typeof existing === 'object' && existing !== null && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {}
    stored.mode = 'off'
    stored.updated_by = session.user.email ?? null
    stored.updated_at = new Date().toISOString()

    const { error: offError } = await supabaseAdmin.from('ad_strategy_configs').upsert(
      { client_id: clientId, factory_reel_ad_draft: stored },
      { onConflict: 'client_id' },
    )

    if (offError) {
      if (isMissingColumnError(offError)) {
        return NextResponse.json({ error: '数据库还没升级，请联系技术' }, { status: 503 })
      }
      console.error('[factory-reel-ad-draft-config] upsert failed', { clientId, code: offError.code, message: offError.message })
      return NextResponse.json({ error: '保存失败，请稍后重试。' }, { status: 500 })
    }

    const { config, effectiveMode, source } = await loadFactoryReelDraftConfig(supabaseAdmin, clientId)
    return NextResponse.json({
      success: true,
      config,
      effectiveMode,
      source,
      modes: FACTORY_REEL_DRAFT_MODES,
    })
  }

  const candidate: Record<string, unknown> = {}
  for (const key of CANDIDATE_KEYS) {
    if (key in raw) candidate[key] = raw[key]
  }
  candidate.updated_by = session.user.email ?? null
  candidate.updated_at = new Date().toISOString()

  const parsed = parseFactoryReelDraftConfig(candidate)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('ad_strategy_configs').upsert(
    { client_id: clientId, factory_reel_ad_draft: candidate },
    { onConflict: 'client_id' },
  )

  if (error) {
    if (isMissingColumnError(error)) {
      return NextResponse.json({ error: '数据库还没升级，请联系技术' }, { status: 503 })
    }
    console.error('[factory-reel-ad-draft-config] upsert failed', { clientId, code: error.code, message: error.message })
    return NextResponse.json({ error: '保存失败，请稍后重试。' }, { status: 500 })
  }

  const { config, effectiveMode, source } = await loadFactoryReelDraftConfig(supabaseAdmin, clientId)
  return NextResponse.json({
    success: true,
    config,
    effectiveMode,
    source,
    modes: FACTORY_REEL_DRAFT_MODES,
  })
}
