/**
 * 账户级日上限清单 —— 只读（v2.1 §3.9 / §11.11）。
 *
 * 这里只负责"把每个账户现在填了多少、客户总闸是多少、要不要出现在广告健康页"
 * 读出来给面板显示。日上限的写入仍然只走 `[accountId]/daily-cap`；
 * 「在广告健康页显示」走 `[accountId]/visibility`。
 *
 * ── 界面不许自己算校验 ────────────────────────────────────────────────
 * 面板只负责把用户填的数字原样交给 PATCH，校验结论一律以 PATCH 的返回为准。
 * 前端自己算一遍"看起来没超"再放行，等于把唯一入口的判据复制了一份，两边
 * 迟早对不上——那时面板说"能存"、PATCH 说"不能存"，用户只会更困惑。
 *
 * ── 为什么只许内部员工看（`requireGlobalAdmin`）──────────────────────
 * 这一列直接决定广告自治能动多少钱，判据同 `facebook-page` PATCH
 * （AD-SEC-4）：客户成员自己看或填，等于"被约束者自报约束"，那就没有约束。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'

interface AccountCapRow {
  ad_account_id: string
  daily_budget_cap_cents: number | null
  hidden_from_ad_health: boolean
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: clientId } = await params

  const admin = await requireGlobalAdmin()
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  const [{ data: accountRows, error: accountErr }, { data: cfg, error: cfgErr }] = await Promise.all([
    supabaseAdmin
      .from('client_meta_ad_accounts')
      .select('ad_account_id, daily_budget_cap_cents, hidden_from_ad_health')
      .eq('client_id', clientId)
      .order('ad_account_id', { ascending: true }),
    supabaseAdmin
      .from('ad_strategy_configs')
      .select('daily_budget_cap_cents')
      .eq('client_id', clientId)
      .maybeSingle<{ daily_budget_cap_cents: number | null }>(),
  ])
  if (accountErr) {
    return NextResponse.json({ error: `查账户上限失败：${accountErr.message}` }, { status: 500 })
  }
  if (cfgErr) {
    return NextResponse.json({ error: `查客户总闸失败：${cfgErr.message}` }, { status: 500 })
  }

  const accounts: AccountCapRow[] = ((accountRows ?? []) as AccountCapRow[]).map((r) => ({
    ad_account_id: r.ad_account_id,
    daily_budget_cap_cents: typeof r.daily_budget_cap_cents === 'number' ? r.daily_budget_cap_cents : null,
    hidden_from_ad_health: r.hidden_from_ad_health === true,
  }))
  const clientTotalCapCents = typeof cfg?.daily_budget_cap_cents === 'number' ? cfg.daily_budget_cap_cents : null

  return NextResponse.json({ accounts, client_total_cap_cents: clientTotalCapCents })
}
