/**
 * GET  /api/clients/[id]/prescription/[pId]/outcomes
 *   → 返回该处方的所有 prescription_outcomes（按 measured_at DESC）
 *
 * POST /api/clients/[id]/prescription/[pId]/outcomes
 *   Body: RecordOutcomeBody — FDE 手工录入单条 KPI 实测值
 *   → 写入 prescription_outcomes（data_source='manual_fde'）
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.12.S2.3
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { recordOutcome } from '@/lib/case-library/outcome-recorder'
import type { PrescriptionOutcome } from '@/lib/case-library/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; pId: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const { pId } = params

    const { data, error } = await supabaseAdmin
      .from('prescription_outcomes')
      .select('*')
      .eq('prescription_id', pId)
      .eq('client_id', clientId)
      .order('measured_at', { ascending: false })

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, outcomes: (data ?? []) as PrescriptionOutcome[] })
  } catch (err: unknown) {
    console.error('[outcomes GET] Error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

interface RecordOutcomeBody {
  case_id: string
  kpi_metric: string
  target_value?: number | null
  actual_value?: number | null
  unit?: string | null
  dimension?: string | null
  measured_at?: string
  days_since_approval?: number | null
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; pId: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const { pId } = params
    const body = (await req.json()) as Partial<RecordOutcomeBody>

    if (!body.case_id || typeof body.case_id !== 'string') {
      return NextResponse.json({ success: false, error: 'case_id is required' }, { status: 400 })
    }
    if (!body.kpi_metric || typeof body.kpi_metric !== 'string') {
      return NextResponse.json({ success: false, error: 'kpi_metric is required' }, { status: 400 })
    }

    const outcomeId = await recordOutcome(supabaseAdmin, {
      prescriptionId:      pId,
      caseId:              body.case_id,
      clientId,
      kpiMetric:           body.kpi_metric,
      targetValue:         body.target_value ?? null,
      actualValue:         body.actual_value ?? null,
      unit:                body.unit ?? null,
      dimension:           body.dimension ?? null,
      measuredAt:          body.measured_at,
      daysSinceApproval:   body.days_since_approval ?? null,
      dataSource:          'manual_fde',
    })

    if (!outcomeId) {
      return NextResponse.json({ success: false, error: 'Failed to record outcome' }, { status: 500 })
    }

    return NextResponse.json({ success: true, outcome_id: outcomeId }, { status: 201 })
  } catch (err: unknown) {
    console.error('[outcomes POST] Error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}
