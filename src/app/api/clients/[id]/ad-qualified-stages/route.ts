/**
 * GET/PATCH /api/clients/[id]/ad-qualified-stages
 *
 * 客户「合格客户」阶段配置（ads 记分卡合格列，设计 §4）：
 *   哪些 CRM 阶段算作一个「合格客户」，供广告记分卡的合格列统计。
 *
 * 设置界面唯一的读写入口 —— FDE 不许进数据库直改（FDE-config 红线）。
 * 存在 `ad_strategy_configs.qualified_stage_keys text[]` 里，配独立的审计列
 * `qualified_stages_updated_by` / `qualified_stages_updated_at`（不碰 outcome_config_*）。
 * migration 未 apply 前 PATCH 返回 503、GET 标 source='not_migrated'。
 *
 * 阶段词表来自 `client_pipeline_stages`（每个客户自己的 CRM 阶段），GET 一并下发，
 * 前端不重复写死。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { requireSession } from '@/lib/auth/require-session'

export const dynamic = 'force-dynamic'

const MAX_STAGE_KEYS = 50

interface StageOption {
  key: string
  label: string
}

type ConfigSource = 'row' | 'no_row' | 'read_error' | 'not_migrated'

interface QualifiedStagesPayload {
  success: true
  source: ConfigSource
  stages: StageOption[]
  selected: string[]
  updatedBy: string | null
  updatedAt: string | null
}

interface StageRow {
  stage_key: string
  label: string | null
  sort_order: number | null
}

interface ConfigRow {
  qualified_stage_keys: string[] | null
  qualified_stages_updated_by: string | null
  qualified_stages_updated_at: string | null
}

/** migration 还没 apply：PostgREST 找不到列（PGRST204）或 Postgres 报列不存在（42703）。 */
function isMissingColumnError(err: { code?: string; message?: string }): boolean {
  if (err.code === 'PGRST204' || err.code === '42703') return true
  return /could not find the .* column|column .* does not exist/i.test(err.message ?? '')
}

/** 读这个客户的 CRM 阶段；失败返回 null（调用方决定怎么报错）。 */
async function loadStages(clientId: string): Promise<StageOption[] | null> {
  const { data, error } = await supabaseAdmin
    .from('client_pipeline_stages')
    .select('stage_key, label, sort_order')
    .eq('client_id', clientId)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[ad-qualified-stages] stages read failed', {
      clientId,
      code: error.code,
      message: error.message,
    })
    return null
  }

  const rows = (data ?? []) as StageRow[]
  return rows.map(row => ({ key: row.stage_key, label: row.label ?? row.stage_key }))
}

/** 读配置行 + 阶段，组装 GET/PATCH 共用的响应体。阶段读失败返回 null。 */
async function readQualifiedStages(clientId: string): Promise<QualifiedStagesPayload | null> {
  const stages = await loadStages(clientId)
  if (stages === null) return null

  const { data, error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .select('qualified_stage_keys, qualified_stages_updated_by, qualified_stages_updated_at')
    .eq('client_id', clientId)
    .maybeSingle()

  if (error) {
    // 读失败不能渲染成空选择（一存会盖掉没看见的旧值），用 source 区分。
    const source: ConfigSource = isMissingColumnError(error) ? 'not_migrated' : 'read_error'
    if (source === 'read_error') {
      console.error('[ad-qualified-stages] config read failed', {
        clientId,
        code: error.code,
        message: error.message,
      })
    }
    return { success: true, source, stages, selected: [], updatedBy: null, updatedAt: null }
  }

  if (!data) {
    return { success: true, source: 'no_row', stages, selected: [], updatedBy: null, updatedAt: null }
  }

  const row = data as ConfigRow
  return {
    success: true,
    source: 'row',
    stages,
    selected: row.qualified_stage_keys ?? [],
    updatedBy: row.qualified_stages_updated_by ?? null,
    updatedAt: row.qualified_stages_updated_at ?? null,
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  // 只放行 Magic Engine 内部员工（全局 admin）：合格阶段决定记分卡怎么算合格客户。
  const guard = await guardGlobalAdmin()
  if (guard) return guard

  const payload = await readQualifiedStages(clientId)
  if (payload === null) {
    return NextResponse.json({ error: '读不到这个客户的 CRM 阶段。' }, { status: 500 })
  }
  return NextResponse.json(payload)
}

type ParseResult = { ok: true; value: string[] } | { ok: false; error: string }

/** 校验并去重 `qualified_stage_keys`。空数组合法（= 清空）。 */
function parseQualifiedStagesPatch(body: Record<string, unknown>): ParseResult {
  const raw = body.qualified_stage_keys
  if (!Array.isArray(raw)) {
    return { ok: false, error: '「合格阶段」要传一个阶段列表。' }
  }
  if (raw.length > MAX_STAGE_KEYS) {
    return { ok: false, error: `「合格阶段」最多选 ${MAX_STAGE_KEYS} 个。` }
  }
  const seen = new Set<string>()
  const keys: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string' || item.length === 0) {
      return { ok: false, error: '「合格阶段」里每一项都要是非空的阶段标识。' }
    }
    if (!seen.has(item)) {
      seen.add(item)
      keys.push(item)
    }
  }
  return { ok: true, value: keys }
}

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
  const parsed = parseQualifiedStagesPatch(body as Record<string, unknown>)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const stages = await loadStages(clientId)
  if (stages === null) {
    return NextResponse.json({ error: '读不到这个客户的 CRM 阶段。' }, { status: 500 })
  }

  const known = new Set(stages.map(stage => stage.key))
  const unknown = parsed.value.filter(key => !known.has(key))
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: '有的阶段不在这个客户的 CRM 阶段里：' + unknown.join('、') },
      { status: 400 },
    )
  }

  // 🔴 只改已有的那一行，不新建：新建行的 enabled 默认是 true，会顺手给这个客户打开广告健康监测。
  const keys = parsed.value
  const { data: updated, error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .update({
      qualified_stage_keys: keys.length > 0 ? keys : null,
      qualified_stages_updated_by: session.user.email ?? null,
      qualified_stages_updated_at: new Date().toISOString(),
    })
    .eq('client_id', clientId)
    .select('client_id')

  if (error) {
    if (isMissingColumnError(error)) {
      return NextResponse.json({ error: '数据库还没升级，请联系技术' }, { status: 503 })
    }
    console.error('[ad-qualified-stages] upsert failed', {
      clientId,
      code: error.code,
      message: error.message,
    })
    return NextResponse.json({ error: '保存失败，请稍后重试。' }, { status: 500 })
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: '这个客户还没开「广告健康监测」，先开了再设置合格阶段。' }, { status: 409 })
  }

  const payload = await readQualifiedStages(clientId)
  if (payload === null) {
    return NextResponse.json({ error: '读不到这个客户的 CRM 阶段。' }, { status: 500 })
  }
  return NextResponse.json(payload)
}
