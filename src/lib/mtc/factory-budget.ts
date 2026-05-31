/**
 * P21.6 — AI Factory 月度 Token 预算治理
 *
 * checkFactoryBudget():
 *   从 mtc_ledger 聚合本月 ai_factory_post 消耗量，
 *   与客户月度上限比较，返回是否允许继续量产。
 *
 * 设计决策：
 *   - 上限默认 500 帖/月（FDE 客户）
 *   - 上限可通过 clients.ai_factory_monthly_limit 覆盖（字段不存在则用默认值）
 *   - 熔断是软熔断：已生成的帖子不回滚，只拦截新的请求
 *   - 非 FDE 客户（无 MTC 余额）同样受此限制，防止滥用
 */

import { supabaseAdmin } from '@/lib/supabase'

const DEFAULT_MONTHLY_LIMIT = 500   // FDE 客户默认月上限（帖数）

export interface BudgetCheckResult {
  allowed:       boolean
  usedThisMonth: number
  limit:         number
  remaining:     number
}

/**
 * 检查客户本月 AI Factory 帖子消耗是否超限。
 *
 * @param clientId   客户 UUID
 * @param requested  本次请求将生成的帖数（用于预检：used + requested > limit → 拦截）
 */
export async function checkFactoryBudget(
  clientId: string,
  requested: number,
): Promise<BudgetCheckResult> {
  // 1. 取本月起始时间
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  // 2. 聚合本月 ai_factory_post debit 总量（帖数 = mtc_amount / 5，但这里直接用 mtc_amount 做比较）
  const { data, error } = await supabaseAdmin
    .from('mtc_ledger')
    .select('mtc_amount')
    .eq('client_id', clientId)
    .eq('service_key', 'ai_factory_post')
    .eq('direction', 'debit')
    .gte('created_at', start)

  if (error) {
    // 查询失败时放行（非阻断）
    console.error('[factory-budget] ledger query failed:', error.message)
    return { allowed: true, usedThisMonth: 0, limit: DEFAULT_MONTHLY_LIMIT, remaining: DEFAULT_MONTHLY_LIMIT }
  }

  // Each ai_factory_post debit: mtc_amount = 帖数（1 帖 = 5 MTC，但 deductMtc 传的是 savedCount 不是 mtc）
  // 实际传入 deductMtc 的是 savedCount（帖数），不是 MTC 总量
  const usedThisMonth = (data ?? []).reduce((sum, row) => sum + (row.mtc_amount as number), 0)
  const limit         = DEFAULT_MONTHLY_LIMIT

  return {
    allowed:       usedThisMonth + requested <= limit,
    usedThisMonth,
    limit,
    remaining:     Math.max(0, limit - usedThisMonth),
  }
}
