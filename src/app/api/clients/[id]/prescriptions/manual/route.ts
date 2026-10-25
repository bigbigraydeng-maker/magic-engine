import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { getGoalById } from '@/lib/strategy/goals'
import {
  MANUAL_PRESCRIPTION_AGENT,
  NO_COMPLETED_RUN_MESSAGE,
  parseManualPrescriptionBody,
  type ManualParseSuccess,
} from '@/lib/diagnostic/manual-prescription'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type Fail = { ok: false; status: number; error: string }
type Ready = { ok: true; runId: string; version: number }

function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ success: false, error }, { status })
}

async function latestCompletedRunId(clientId: string): Promise<{ runId: string } | Fail> {
  const { data, error } = await supabaseAdmin
    .from('diagnostic_runs')
    .select('id')
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>()
  if (error) return { ok: false, status: 500, error: '读取体检记录失败' }
  if (!data?.id) return { ok: false, status: 422, error: NO_COMPLETED_RUN_MESSAGE }
  return { runId: data.id }
}

async function nextVersionForGoal(goalId: string): Promise<number | Fail> {
  const { data, error } = await supabaseAdmin
    .from('prescriptions')
    .select('version')
    .eq('goal_id', goalId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle<{ version: number }>()
  if (error) return { ok: false, status: 500, error: '读取处方版本失败' }
  return (data?.version ?? 0) + 1
}

async function loadInsertContext(clientId: string, goalId: string): Promise<Ready | Fail> {
  const goal = await getGoalById(supabaseAdmin, goalId)
  if (!goal || goal.client_id !== clientId) {
    return { ok: false, status: 422, error: '目标不存在，或不属于这个客户' }
  }
  const run = await latestCompletedRunId(clientId)
  if (!('runId' in run)) return run
  const version = await nextVersionForGoal(goalId)
  if (typeof version !== 'number') return version
  return { ok: true, runId: run.runId, version }
}

async function insertDraft(
  clientId: string,
  parsed: ManualParseSuccess,
  ready: Ready,
): Promise<NextResponse> {
  const row = {
    client_id: clientId,
    goal_id: parsed.goalId,
    run_id: ready.runId,
    discovery_id: null,
    status: 'draft' as const,
    version: ready.version,
    agent_name: MANUAL_PRESCRIPTION_AGENT,
    content: parsed.content,
    intake: null,
    generation_meta: parsed.generationMeta,
    supersedes_id: null,
    supplements_id: null,
  }
  const { data, error } = await supabaseAdmin
    .from('prescriptions')
    .insert(row)
    .select('id')
    .single<{ id: string }>()
  if (error || !data) {
    const message = error?.message ?? ''
    if (message.includes('run_id') || message.includes('discovery_id')) {
      return jsonError(422, NO_COMPLETED_RUN_MESSAGE)
    }
    console.error('[prescriptions/manual] insert failed', error)
    return jsonError(500, '保存处方草稿失败')
  }
  return NextResponse.json({
    success: true,
    prescription_id: data.id,
    status: 'draft',
    version: ready.version,
    agent_name: MANUAL_PRESCRIPTION_AGENT,
    goal_id: parsed.goalId,
    run_id: ready.runId,
    view_path: `/dashboard/clients/${clientId}/prescription/new?goal_id=${parsed.goalId}`,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'invalid JSON body')
  }

  const parsed = parseManualPrescriptionBody(body, clientId)
  if (!parsed.ok) return jsonError(parsed.status, parsed.error)
  const ready = await loadInsertContext(clientId, parsed.goalId)
  if (!ready.ok) return jsonError(ready.status, ready.error)
  return insertDraft(clientId, parsed, ready)
}
