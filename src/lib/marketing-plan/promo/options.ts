/**
 * 推广计划表单的下拉选项：这个客户名下可选的目标和广告账户（只读）。
 * 保存时服务端仍会重新核对归属，这里只是让 FDE / PM 不用手抄编号。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { listActiveGoals } from '@/lib/strategy/goals'
import { loadOwnedAccounts } from './facts'

export interface PromoGoalOption {
  id: string
  title: string
  period_start: string
  period_end: string
}

export interface PromoAccountOption {
  id: string
  /** 账户级日预算上限（分）；没设置为 null */
  cap_cents: number | null
  /** 给人看的名称；没有就不要把 act_ 编号显示出来 */
  label?: string | null
}

export interface PromoOptions {
  goals: PromoGoalOption[]
  /** 读取失败为 null（页面要写"读取失败"，不能当成"没有账户"） */
  accounts: PromoAccountOption[] | null
}

export async function loadPromoOptions(clientId: string): Promise<PromoOptions> {
  const [goals, owned] = await Promise.all([listActiveGoals(supabaseAdmin, clientId), loadOwnedAccounts(clientId)])
  return {
    goals: goals.map(g => ({ id: g.id, title: g.title, period_start: g.period_start, period_end: g.period_end })),
    accounts: owned === null ? null : owned.map(a => ({ id: a.id, cap_cents: a.cap, label: a.label })),
  }
}
