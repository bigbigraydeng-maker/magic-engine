/**
 * GET/POST /api/clients/[id]/business-calculator/scenarios
 *
 * Named what-if scenarios for the in-app travel business calculator. Inputs
 * only — results are always recomputed from the formula, never stored.
 *
 * Access: plan approvers only (requirePlanApproverAccess), and only for
 * clients that have the `business_calculator` industry feature enabled.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePlanApproverAccess } from '@/lib/auth/client-access'
import { clientHasIndustryFeature } from '@/lib/clients/industry-guard'
import {
  BUSINESS_CALCULATOR_FORMULA_VERSION,
  validateInputs,
} from '@/lib/crm/industry/travel-business-calculator'

export const dynamic = 'force-dynamic'

const SCENARIO_COLUMNS =
  'id, name, inputs, formula_version, created_by, created_at, updated_at'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params

  const access = await requirePlanApproverAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  if (!(await clientHasIndustryFeature(clientId, 'business_calculator'))) {
    return NextResponse.json(
      { error: '这个客户没有开通经营测算', code: 'feature_unavailable' },
      { status: 404 },
    )
  }

  const actor = access.user.email ?? ''
  if (!actor) {
    return NextResponse.json({ error: '需要带邮箱的内部账号' }, { status: 403 })
  }

  const { data, error } = await supabaseAdmin
    .from('me_calculator_scenarios')
    .select(SCENARIO_COLUMNS)
    .eq('client_id', clientId)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: '读取场景失败' }, { status: 500 })
  }

  return NextResponse.json({ success: true, scenarios: data ?? [] })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params

  const access = await requirePlanApproverAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  if (!(await clientHasIndustryFeature(clientId, 'business_calculator'))) {
    return NextResponse.json(
      { error: '这个客户没有开通经营测算', code: 'feature_unavailable' },
      { status: 404 },
    )
  }

  const actor = access.user.email ?? ''
  if (!actor) {
    return NextResponse.json({ error: '需要带邮箱的内部账号' }, { status: 403 })
  }

  let body: { name?: unknown; inputs?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body.name !== 'string') {
    return NextResponse.json(
      { error: '场景名需要 1 到 60 个字', code: 'bad_name' },
      { status: 400 },
    )
  }
  const name = body.name.trim()
  if (name.length < 1 || name.length > 60) {
    return NextResponse.json(
      { error: '场景名需要 1 到 60 个字', code: 'bad_name' },
      { status: 400 },
    )
  }

  const validated = validateInputs(body.inputs)
  if (!validated.ok) {
    return NextResponse.json(
      { error: validated.error, code: 'bad_inputs' },
      { status: 400 },
    )
  }

  const { data, error } = await supabaseAdmin
    .from('me_calculator_scenarios')
    .insert({
      client_id: clientId,
      name,
      inputs: validated.value,
      formula_version: BUSINESS_CALCULATOR_FORMULA_VERSION,
      created_by: actor,
      updated_at: new Date().toISOString(),
    })
    .select(SCENARIO_COLUMNS)
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: '已有同名场景', code: 'duplicate_name' },
        { status: 409 },
      )
    }
    if (error.message.includes('scenario_limit_reached')) {
      return NextResponse.json(
        { error: '每个客户最多 50 个场景', code: 'limit_reached' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: '保存失败' }, { status: 500 })
  }

  return NextResponse.json({ success: true, scenario: data }, { status: 201 })
}
