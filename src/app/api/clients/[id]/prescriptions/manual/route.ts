import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireOperatorAccess } from '@/lib/auth/client-access'
import { getGoalById } from '@/lib/strategy/goals'
import {
  MANUAL_PRESCRIPTION_AGENT,
  parseManualPrescriptionBody,
  type ManualParseSuccess,
} from '@/lib/diagnostic/manual-prescription'
import { attachPlanSeed } from '@/lib/ads-strategy/plan-seed/attach'
import { afterPrescriptionDraftSaved } from '@/lib/marketing-plan/promo/plan-draft-hook'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type Fail = { ok: false; status: number; error: string }
type Ready = { ok: true; runId: string | null; version: number }

function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ success: false, error }, { status })
}

/** Latest run id only. Scores and issue lists stay unread. Missing id is stored as null. */
async function latestRunId(clientId: string): Promise<{ runId: string | null } | Fail> {
  const { data, error } = await supabaseAdmin
    .from('diagnostic_runs')
    .select('id')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>()
  if (error) return { ok: false, status: 500, error: '读取体检记录失败' }
  return { runId: data?.id ?? null }
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
  const run = await latestRunId(clientId)
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
    console.error('[prescriptions/manual] insert failed', error)
    return jsonError(500, '保存处方草稿失败')
  }
  await afterPrescriptionDraftSaved({ clientId, prescriptionId: data.id })
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
  // Paste stays open to this client's FDE. The row label "广告 Agent" is not a caller.
  const access = await requireOperatorAccess(clientId)
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
  // 种子构建失败不能挡住保存草稿：attachPlanSeed 自己不抛错，这里再兜一层
  parsed.content = await attachPlanSeed(parsed.content, { clientId, goalId: parsed.goalId }).catch(() => parsed.content)
  return insertDraft(clientId, parsed, ready)
}
