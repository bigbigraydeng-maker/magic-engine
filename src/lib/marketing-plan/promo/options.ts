/**
 * 推广计划表单的下拉选项：这个客户名下可选的目标和广告账户（只读）。
 * 保存时服务端仍会重新核对归属，这里只是让 FDE / PM 不用手抄编号。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { listGoalsForClient } from '@/lib/strategy/goals'
import { loadOwnedAccounts } from './facts'

export interface PromoGoalOption {
  id: string
  title: string
  /** 草稿和进行中都可以选；过期、归档不进这个列表。 */
  status: 'draft' | 'active'
  period_start: string
  period_end: string
}

export interface PromoAccountOption {
  id: string
  /** 账户级日预算上限（分）；没设置为 null */
  cap_cents: number | null
}

export interface PromoOptions {
  goals: PromoGoalOption[]
  /** 读取失败为 null（页面要写"读取失败"，不能当成"没有账户"） */
  accounts: PromoAccountOption[] | null
}

export async function loadPromoOptions(clientId: string): Promise<PromoOptions> {
  const [goals, owned] = await Promise.all([
    listGoalsForClient(supabaseAdmin, clientId, { statuses: ['draft', 'active'] }),
    loadOwnedAccounts(clientId),
  ])
  return {
    goals: goals.flatMap(g => (
      g.status === 'draft' || g.status === 'active'
        ? [{ id: g.id, title: g.title, status: g.status, period_start: g.period_start, period_end: g.period_end }]
        : []
    )),
    accounts: owned === null ? null : owned.map(a => ({ id: a.id, cap_cents: a.cap })),
  }
}
