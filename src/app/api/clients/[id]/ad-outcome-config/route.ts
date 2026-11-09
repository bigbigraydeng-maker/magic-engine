/**
 * GET/PATCH /api/clients/[id]/ad-outcome-config
 *
 * 客户结果阶梯配置（ads IMPACT 阶段 1，设计 §3.2 / §7 L4）：
 *   领先结果 / 主结果 / 目标单次主结果成本 / 每个预算单位主结果最低数。
 *
 * 设置界面（AdOutcomePanel）唯一的读写入口 —— FDE 不许进数据库直改（FDE-config 红线）。
 * 存在 `ad_strategy_configs` 的新列里（migration 20260914000002，apply 前 PATCH 返回 503）。
 *
 * 词表只在 outcome-ladder.ts 定义一次；GET 把它连同中文标签一起下发，前端不重复写死。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { requireSession } from '@/lib/auth/require-session'
import { loadOutcomeConfig } from '@/lib/ads-strategy/portfolio/outcome-config'
import {
  OUTCOME_STEPS,
  OUTCOME_STEP_LABEL,
  isOutcomeStep,
  type OutcomeStep,
} from '@/lib/ads-strategy/portfolio/outcome-ladder'

export const dynamic = 'force-dynamic'

const STEP_OPTIONS = OUTCOME_STEPS.map(value => ({ value, label: OUTCOME_STEP_LABEL[value] }))

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  // 读失败时照样 200，但把 source 标成 read_error —— 前端据此显示「读不到」，
  // 不能把读失败渲染成空输入框（一填一存会盖掉没看见的旧值）。原始报错不下发。
  const { config, source } = await loadOutcomeConfig(clientId)
  return NextResponse.json({ success: true, config, source, steps: STEP_OPTIONS })
}

interface OutcomePatch {
  leading_result: OutcomeStep | null
  primary_result: OutcomeStep | null
  target_cost_per_primary: number | null
  min_primary_per_unit: number
}

const MAX_TARGET_COST = 100_000
const MAX_MIN_PRIMARY = 1_000

type ParseResult ={ ok: true; value: OutcomePatch } | { ok: false; error: string }

/** 四个字段必须一起送（设置界面总是整组保存），避免半截写入和旧值拼出矛盾的阶梯。
 * 不 export：Next.js 路由文件只允许导出 HTTP 方法与路由配置。 */
function parseOutcomePatch(body: Record<string, unknown>): ParseResult {
  const { leading_result: leading, primary_result: primary } = body
  const { target_cost_per_primary: target, min_primary_per_unit: min } = body

  if (leading !== null && !isOutcomeStep(leading)) return { ok: false, error: '「领先结果」不是可选的结果级别。' }
  if (primary !== null && !isOutcomeStep(primary)) return { ok: false, error: '「主结果」不是可选的结果级别。' }
  if (leading !== null && primary !== null && OUTCOME_STEPS.indexOf(primary) < OUTCOME_STEPS.indexOf(leading)) {
    return { ok: false, error: '「主结果」不能比「领先结果」更靠前（例如领先结果选了留资，主结果就不能选互动）。' }
  }
  // 上限（魏征复审）：填个天文数字等于悄悄关掉「花钱没结果」「钱和结果错配」两条诊断。
  if (target !== null && (typeof target !== 'number' || !Number.isFinite(target) || target <= 0 || target > MAX_TARGET_COST)) {
    return { ok: false, error: `「目标单次主结果成本」要么留空，要么填 0 到 ${MAX_TARGET_COST} 之间的数字。` }
  }
  if (typeof min !== 'number' || !Number.isInteger(min) || min < 1 || min > MAX_MIN_PRIMARY) {
    return { ok: false, error: `「主结果最低数」要填 1 到 ${MAX_MIN_PRIMARY} 之间的整数。` }
  }
  return {
    ok: true,
    value: { leading_result: leading, primary_result: primary, target_cost_per_primary: target, min_primary_per_unit: min },
  }
}

/** migration 还没 apply：PostgREST 找不到列（PGRST204）或 Postgres 报列不存在（42703）。 */
function isMissingColumnError(err: { code?: string; message?: string }): boolean {
  if (err.code === 'PGRST204' || err.code === '42703') return true
  return /could not find the .* column|column .* does not exist/i.test(err.message ?? '')
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  // 只放行 Magic Engine 内部员工（全局 admin）：主结果与目标成本决定诊断会不会对这个客户
  // 报「花钱没结果」「钱和结果错配」—— 客户成员自己改 = 自己决定自己的广告要不要被预警。
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
  const parsed = parseOutcomePatch(body as Record<string, unknown>)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { error } = await supabaseAdmin.from('ad_strategy_configs').upsert(
    {
      client_id: clientId,
      ...parsed.value,
      outcome_config_updated_by: session.user.email ?? null,
      outcome_config_updated_at: new Date().toISOString(),
    },
    { onConflict: 'client_id' },
  )

  if (error) {
    if (isMissingColumnError(error)) {
      return NextResponse.json({ error: '数据库还没升级，请联系技术' }, { status: 503 })
    }
    console.error('[ad-outcome-config] upsert failed', { clientId, code: error.code, message: error.message })
    return NextResponse.json({ error: '保存失败，请稍后重试。' }, { status: 500 })
  }

  const { config, source } = await loadOutcomeConfig(clientId)
  return NextResponse.json({ success: true, config, source, steps: STEP_OPTIONS })
}
