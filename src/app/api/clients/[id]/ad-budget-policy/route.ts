/**
 * GET/PATCH /api/clients/[id]/ad-budget-policy
 *
 * 客户广告预算管控配置（ads IMPACT 阶段 2，设计 §4.1 硬前置第 2 条 / §7 L4 / §14 M4）：
 *   是否锁定 / 每日总花费上限 / 单预算单位当日变动上限。
 *
 * 设置界面（BudgetPolicyPanel）唯一的读写入口 —— FDE 不许进数据库直改（FDE-config 红线）。
 * 存在 `ad_strategy_configs` 的新列里（migration 20260915230000，apply 前 PATCH 返回 503）。
 *
 * 本路由只负责配置的读写；真正消费这份配置去拦截挪预算执行的是后续 PR（PR-C）。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { requireSession } from '@/lib/auth/require-session'
import { loadBudgetPolicy } from '@/lib/ads-strategy/portfolio/budget-policy'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  // 读失败时照样 200，但把 source 标成 read_error —— 前端据此显示「读不到」，
  // 不能把读失败渲染成空输入框（一填一存会盖掉没看见的旧值）。原始报错不下发。
  const { policy, source } = await loadBudgetPolicy(clientId)
  return NextResponse.json({ success: true, policy, source })
}

interface BudgetPolicyPatch {
  budget_locked: boolean
  total_daily_cap_minor: number | null
  per_unit_daily_change_cap_pct: number | null
}

const MAX_TOTAL_DAILY_CAP_MINOR = 100_000_000_00 // 1 亿元（账户币种主单位），拦一个天文数字误填

type ParseResult = { ok: true; value: BudgetPolicyPatch } | { ok: false; error: string }

/** 三个字段必须一起送（设置界面总是整组保存），避免半截写入拼出矛盾配置。
 * 不 export：Next.js 路由文件只允许导出 HTTP 方法与路由配置。 */
function parseBudgetPolicyPatch(body: Record<string, unknown>): ParseResult {
  const { budget_locked: locked, total_daily_cap_minor: totalCap, per_unit_daily_change_cap_pct: pct } = body

  if (typeof locked !== 'boolean') return { ok: false, error: '「是否锁定」必须明确选是或否。' }

  if (totalCap !== null) {
    if (typeof totalCap !== 'number' || !Number.isFinite(totalCap) || !Number.isInteger(totalCap) || totalCap <= 0 || totalCap > MAX_TOTAL_DAILY_CAP_MINOR) {
      return { ok: false, error: '「每日总花费上限」要么留空，要么填一个大于 0 的整数（最小货币单位，如分）。' }
    }
  }
  if (pct !== null) {
    if (typeof pct !== 'number' || !Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return { ok: false, error: '「单预算单位当日变动上限」要么留空，要么填 0 到 100 之间的百分比数字。' }
    }
  }

  return {
    ok: true,
    value: { budget_locked: locked, total_daily_cap_minor: totalCap, per_unit_daily_change_cap_pct: pct },
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

  // 只放行 Magic Engine 内部员工（全局 admin）：预算锁决定挪预算处方会不会被拦下来——
  // 客户成员自己改 = 自己决定自己的钱能不能被动。跟 ad-outcome-config 同一鉴权模式。
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
  const parsed = parseBudgetPolicyPatch(body as Record<string, unknown>)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { error } = await supabaseAdmin.from('ad_strategy_configs').upsert(
    {
      client_id: clientId,
      ...parsed.value,
      budget_policy_updated_by: session.user.email ?? null,
      budget_policy_updated_at: new Date().toISOString(),
    },
    { onConflict: 'client_id' },
  )

  if (error) {
    if (isMissingColumnError(error)) {
      return NextResponse.json({ error: '数据库还没升级，请联系技术' }, { status: 503 })
    }
    console.error('[ad-budget-policy] upsert failed', { clientId, code: error.code, message: error.message })
    return NextResponse.json({ error: '保存失败，请稍后重试。' }, { status: 500 })
  }

  const { policy, source } = await loadBudgetPolicy(clientId)
  return NextResponse.json({ success: true, policy, source })
}
