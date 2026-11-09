import type { ClientKind, DiagnosticDimension, PrescriptionIntake } from '@/types/diagnostic'
import { prescriptionBudgetFields } from '@/lib/ads/budget-currency'
import { followPrescriptionJob, type FollowHandlers, type FollowResult } from './follow-job'

export async function requestGenerate(input: {
  clientId: string
  currency: string | null
  discoveryId: string | null
  businessGoal: string
  budget: number
  urgency: PrescriptionIntake['timeline_urgency']
  dimensions: DiagnosticDimension[]
  goalId: string | null
  /** 缺省 = 不在请求里写客户类型，服务端按客户资料。 */
  clientKind?: ClientKind
  weeklyShoot?: number | null
  mode: 'new' | 'supplement' | 'revise'
  priorId: string | null
  handlers?: FollowHandlers
  fetchImpl?: typeof fetch
}): Promise<FollowResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  if ((input.mode === 'supplement' || input.mode === 'revise') && !input.priorId) {
    return { ok: false, error: '还不知道要在哪一版上改。' }
  }
  const fields = prescriptionBudgetFields(input.budget, input.currency)
  if (!fields.ok) return { ok: false, error: fields.error }
  const intake: PrescriptionIntake = {
    business_goal: input.businessGoal,
    timeline_urgency: input.urgency,
    monthly_budget_aud: fields.monthly_budget_aud,
    budget_currency: fields.budget_currency,
    priority_dimensions: input.dimensions,
    notes: null,
    ...(input.clientKind ? { client_kind: input.clientKind } : {}),
    ...(input.clientKind === 'personal_ip' ? { weekly_shoot_count: input.weeklyShoot ?? null } : {}),
  }
  const res = await fetchImpl(`/api/clients/${input.clientId}/prescription/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(generateBody(input, intake)),
    cache: 'no-store',
  })
  return followPrescriptionJob(res, input.clientId, input.handlers, fetchImpl)
}

export async function requestRefine(input: {
  clientId: string
  prescriptionId: string
  comments: string
  handlers?: FollowHandlers
  fetchImpl?: typeof fetch
}): Promise<FollowResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const res = await fetchImpl(`/api/clients/${input.clientId}/prescription/${input.prescriptionId}/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ human_comments: input.comments }),
    cache: 'no-store',
  })
  return followPrescriptionJob(res, input.clientId, input.handlers, fetchImpl)
}

function generateBody(input: {
  discoveryId: string | null
  goalId: string | null
  mode: 'new' | 'supplement' | 'revise'
  priorId: string | null
}, intake: PrescriptionIntake): Record<string, unknown> {
  if (input.mode === 'supplement') return { supplement_of: input.priorId, intake }
  if (input.mode === 'revise') return { revise: input.priorId, intake }
  return { discovery_id: input.discoveryId, intake, goal_id: input.goalId }
}
