/**
 * Case Library Saver — P8.12.S2.2
 *
 * 在处方成功生成后，把本次「张骞→华佗」服务快照写入 prescription_cases。
 * 错误静默处理（.catch 模式）：写入失败不阻塞主流程，仅 console.warn。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SaveCaseParams {
  clientId: string
  discoveryId: string
  prescriptionId: string
  industryCategory: string | null
  crisisType: string | null
  monthlyBudgetAud: number | null
  market: string | null
  businessSize: string | null
  prescriptionSummary: string | null
  selfGradeOverall: number | null
}

// ---------------------------------------------------------------------------
// Saver — returns case_id or null (never throws)
// ---------------------------------------------------------------------------

export async function savePrescriptionCase(
  supabase: SupabaseClient,
  params: SaveCaseParams,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('prescription_cases')
      .insert({
        client_id:            params.clientId,
        discovery_id:         params.discoveryId,
        prescription_id:      params.prescriptionId,
        industry_category:    params.industryCategory,
        crisis_type:          params.crisisType,
        monthly_budget_aud:   params.monthlyBudgetAud,
        market:               params.market,
        business_size:        params.businessSize,
        prescription_summary: params.prescriptionSummary,
        self_grade_overall:   params.selfGradeOverall,
      })
      .select()
      .single()

    if (error || !data) {
      console.warn('[case-library/saver] insert failed:', error?.message ?? 'no data returned')
      return null
    }

    return (data as { id: string }).id
  } catch (err) {
    console.warn('[case-library/saver] unexpected error:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Helper — derive crisis_type from intake priority_dimensions
// The first priority dimension is the strongest signal for what prompted the prescription.
// ---------------------------------------------------------------------------

export function deriveCrisisType(
  priorityDimensions: string[] | null | undefined,
): string | null {
  if (!priorityDimensions || priorityDimensions.length === 0) return null
  return priorityDimensions[0]
}
