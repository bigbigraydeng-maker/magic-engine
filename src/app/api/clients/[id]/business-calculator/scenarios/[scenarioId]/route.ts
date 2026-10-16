/**
 * PATCH/DELETE /api/clients/[id]/business-calculator/scenarios/[scenarioId]
 *
 * Edit and delete a single named what-if scenario for the in-app travel
 * business calculator. Inputs only — results are always recomputed from the
 * formula, never stored.
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; scenarioId: string } },
): Promise<NextResponse> {
  const { id: clientId, scenarioId } = params

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

  let body: { expected_updated_at?: unknown; name?: unknown; inputs?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body.expected_updated_at !== 'string') {
    return NextResponse.json(
      { error: '缺少版本锁', code: 'missing_lock' },
      { status: 400 },
    )
  }
  const expectedUpdatedAt = body.expected_updated_at
  if (Number.isNaN(Date.parse(expectedUpdatedAt))) {
    return NextResponse.json(
      { error: '版本锁格式不对', code: 'bad_lock' },
      { status: 400 },
    )
  }

  const hasName = body.name !== undefined
  const hasInputs = body.inputs !== undefined
  if (!hasName && !hasInputs) {
    return NextResponse.json(
      { error: '至少需要提供场景名或输入', code: 'nothing_to_update' },
      { status: 400 },
    )
  }

  const update: {
    updated_at: string
    name?: string
    inputs?: unknown
    formula_version?: number
  } = { updated_at: new Date().toISOString() }

  if (hasName) {
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
    update.name = name
  }

  if (hasInputs) {
    const validated = validateInputs(body.inputs)
    if (!validated.ok) {
      return NextResponse.json(
        { error: validated.error, code: 'bad_inputs' },
        { status: 400 },
      )
    }
    update.inputs = validated.value
    update.formula_version = BUSINESS_CALCULATOR_FORMULA_VERSION
  }

  const { data, error } = await supabaseAdmin
    .from('me_calculator_scenarios')
    .update(update)
    .eq('id', scenarioId)
    .eq('client_id', clientId)
    .eq('updated_at', expectedUpdatedAt)
    .select(SCENARIO_COLUMNS)
    .maybeSingle()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: '已有同名场景', code: 'duplicate_name' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: '保存失败' }, { status: 500 })
  }

  if (!data) {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('me_calculator_scenarios')
      .select('id')
      .eq('id', scenarioId)
      .eq('client_id', clientId)
      .maybeSingle()

    if (existingError) {
      return NextResponse.json({ error: '保存失败' }, { status: 500 })
    }

    if (existing) {
      return NextResponse.json(
        { error: '这个场景刚刚在别处被改过，请重新载入', code: 'stale' },
        { status: 409 },
      )
    }

    return NextResponse.json(
      { error: '场景不存在或已被删除', code: 'not_found' },
      { status: 404 },
    )
  }

  return NextResponse.json({ success: true, scenario: data })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; scenarioId: string } },
): Promise<NextResponse> {
  const { id: clientId, scenarioId } = params

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
    .delete()
    .eq('id', scenarioId)
    .eq('client_id', clientId)
    .select('id')

  if (error) {
    return NextResponse.json({ error: '删除失败' }, { status: 500 })
  }

  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: '场景不存在或已被删除', code: 'not_found' },
      { status: 404 },
    )
  }

  return NextResponse.json({ success: true })
}
