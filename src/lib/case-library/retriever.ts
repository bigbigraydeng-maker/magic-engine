/**
 * Case Library Retriever — P8.12.S2.2
 *
 * 华佗 retrieve_similar_cases skill：
 *   按行业 / 危机类型 / 预算档从 prescription_cases 检索历史处方，
 *   附上 prescription_outcomes 的实测 KPI 摘要，注入华佗生成 prompt。
 *
 * v0 实现：纯结构化查询，不使用 embedding 向量相似度。
 * 查询策略：
 *   1. industry_category 精确匹配（最强信号）
 *   2. crisis_type 精确匹配（可选，匹配到则作为 bonus filter）
 *   3. 预算 ±50% 区间筛选（可选）
 *   4. self_grade_overall DESC 排序（最优质案例优先）
 *   5. LIMIT 3（默认）
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OutcomeKPI {
  kpi_metric: string
  actual_value: number | null
  target_value: number | null
  unit: string | null
  days_since_approval: number | null
}

export interface SimilarCaseResult {
  case_id: string
  industry_category: string | null
  crisis_type: string | null
  monthly_budget_aud: number | null
  market: string | null
  business_size: string | null
  prescription_summary: string | null
  self_grade_overall: number | null
  outcome_kpis: OutcomeKPI[]
  created_at: string
}

export interface RetrieveSimilarCasesParams {
  /** 映射后的行业代码（null 时跳过查询，直接返回 []） */
  industry_category: string | null
  /** 危机类型（维度代码，可选） */
  crisis_type?: string | null
  /** 客户预算（可选，用于 ±50% 区间筛选） */
  monthly_budget_aud?: number | null
  /** 市场（可选，'AU' | 'NZ'） */
  market?: string | null
  /** 最多返回多少条，默认 3 */
  limit?: number
}

// ---------------------------------------------------------------------------
// Main retriever
// ---------------------------------------------------------------------------

export async function retrieveSimilarCases(
  supabase: SupabaseClient,
  params: RetrieveSimilarCasesParams,
): Promise<SimilarCaseResult[]> {
  if (!params.industry_category) return []

  try {
    let query = supabase
      .from('prescription_cases')
      .select('id, industry_category, crisis_type, monthly_budget_aud, market, business_size, prescription_summary, self_grade_overall, created_at')
      .eq('industry_category', params.industry_category)

    if (params.crisis_type) {
      query = query.eq('crisis_type', params.crisis_type)
    }

    if (params.monthly_budget_aud != null) {
      const lo = Math.floor(params.monthly_budget_aud * 0.5)
      const hi = Math.ceil(params.monthly_budget_aud * 1.5)
      query = query.gte('monthly_budget_aud', lo).lte('monthly_budget_aud', hi)
    }

    if (params.market) {
      query = query.eq('market', params.market)
    }

    const { data, error } = await query
      .order('self_grade_overall', { ascending: false })
      .limit(params.limit ?? 3)

    if (error || !data) return []

    const rows = data as Array<{
      id: string
      industry_category: string | null
      crisis_type: string | null
      monthly_budget_aud: number | null
      market: string | null
      business_size: string | null
      prescription_summary: string | null
      self_grade_overall: number | null
      created_at: string
    }>

    // Fetch outcomes for all cases in parallel
    const outcomes = await Promise.all(rows.map(r => fetchOutcomes(supabase, r.id)))

    return rows.map((row, i) => ({
      case_id: row.id,
      industry_category: row.industry_category,
      crisis_type: row.crisis_type,
      monthly_budget_aud: row.monthly_budget_aud,
      market: row.market,
      business_size: row.business_size,
      prescription_summary: row.prescription_summary,
      self_grade_overall: row.self_grade_overall,
      outcome_kpis: outcomes[i],
      created_at: row.created_at,
    }))
  } catch {
    return []
  }
}

async function fetchOutcomes(
  supabase: SupabaseClient,
  caseId: string,
): Promise<OutcomeKPI[]> {
  try {
    const { data, error } = await supabase
      .from('prescription_outcomes')
      .select('kpi_metric, actual_value, target_value, unit, days_since_approval')
      .eq('case_id', caseId)
      .order('days_since_approval', { ascending: false })

    if (error || !data) return []
    return (data as OutcomeKPI[])
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Prompt formatter
// ---------------------------------------------------------------------------

/**
 * 把检索到的相似案例格式化为华佗 prompt 段落。
 * 返回空字符串时调用方负责不注入该段落。
 */
export function formatCasesForPrompt(cases: SimilarCaseResult[]): string {
  if (cases.length === 0) return ''

  const lines: string[] = [
    '## 历史相似案例参考',
    '',
    '以下是 Magic Engine 历史上为相似行业/规模客户开出的处方摘要及实测结果。',
    '**参考用途**：KPI target_value 设定 / 阶段结构 / 预算分配比例。',
    '**不要照抄**：每个客户情况不同，需结合本客户诊断数据做定制化调整。',
    '',
  ]

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]
    lines.push(`### 案例 ${i + 1}`)

    const meta: string[] = []
    if (c.industry_category) meta.push(`行业：${c.industry_category}`)
    if (c.crisis_type) meta.push(`主要问题维度：${c.crisis_type}`)
    if (c.monthly_budget_aud != null) meta.push(`月预算：AUD ${c.monthly_budget_aud.toLocaleString('en-AU')}`)
    if (c.market) meta.push(`市场：${c.market}`)
    if (c.self_grade_overall != null) meta.push(`处方自评分：${c.self_grade_overall}/10`)
    lines.push(meta.join(' · '))
    lines.push('')

    if (c.prescription_summary) {
      lines.push(`**处方摘要**：${c.prescription_summary}`)
      lines.push('')
    }

    if (c.outcome_kpis.length > 0) {
      lines.push('**实测 KPI 结果**：')
      for (const kpi of c.outcome_kpis) {
        const days = kpi.days_since_approval != null ? `（${kpi.days_since_approval} 天后）` : ''
        const actual = kpi.actual_value != null ? String(kpi.actual_value) : '—'
        const target = kpi.target_value != null ? `（目标 ${kpi.target_value}）` : ''
        const unit = kpi.unit ? ` ${kpi.unit}` : ''
        lines.push(`- ${kpi.kpi_metric}${days}：实测 ${actual}${unit}${target}`)
      }
    } else {
      lines.push('**实测 KPI 结果**：暂无实测数据（案例较新或数据尚未回流）')
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}
