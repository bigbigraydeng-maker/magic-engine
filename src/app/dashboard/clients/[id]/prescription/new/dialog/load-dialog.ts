import type { PrescriptionContent, PrescriptionIntake } from '@/types/diagnostic'
import type { SelfGrade } from '@/lib/huatuo/types'
import type { GoalChoice } from './decide-turn'

export interface DialogPrescription {
  id: string
  status: string
  content: PrescriptionContent | null
  progressNote: string | null
  errorMessage: string | null
  agentName: string | null
  selfGrade: SelfGrade | null
  intake: PrescriptionIntake | null
  manual: boolean
}

export interface LoadedDialog {
  discoveryId: string | null
  goals: GoalChoice[]
  prescription: DialogPrescription | null
}

export async function loadPrescriptionDialog(input: {
  clientId: string
  prescriptionId: string | null
  goalId: string | null
  skipLatest: boolean
  fetchImpl?: typeof fetch
}): Promise<LoadedDialog> {
  const fetchImpl = input.fetchImpl ?? fetch
  const [discoveryId, goals, prescription] = await Promise.all([
    loadDiscovery(input.clientId, fetchImpl),
    loadGoals(input.clientId, fetchImpl),
    loadPrescription(input, fetchImpl),
  ])
  return { discoveryId, goals, prescription }
}

async function loadDiscovery(clientId: string, fetchImpl: typeof fetch): Promise<string | null> {
  const res = await fetchImpl(`/api/clients/${clientId}/zhangqian/latest`).catch(() => null)
  if (!res?.ok) return null
  const data = await res.json() as { discovery?: { id?: string; confirmed_at?: string | null } }
  if (!data.discovery?.confirmed_at || !data.discovery.id) return null
  return data.discovery.id
}

async function loadGoals(clientId: string, fetchImpl: typeof fetch): Promise<GoalChoice[]> {
  const res = await fetchImpl(`/api/clients/${clientId}/goals/active-list`, { cache: 'no-store' }).catch(() => null)
  if (!res?.ok) return []
  const data = await res.json() as { goals?: Array<{ id?: string; title?: string }> }
  return (data.goals ?? [])
    .filter((goal): goal is { id: string; title: string } => Boolean(goal.id && goal.title))
    .map((goal) => ({ id: goal.id, title: goal.title }))
}

async function loadPrescription(input: {
  clientId: string
  prescriptionId: string | null
  goalId: string | null
  skipLatest: boolean
}, fetchImpl: typeof fetch): Promise<DialogPrescription | null> {
  if (input.skipLatest && !input.prescriptionId) return null
  const url = input.prescriptionId
    ? `/api/clients/${input.clientId}/prescription/${input.prescriptionId}`
    : latestUrl(input.clientId, input.goalId)
  const res = await fetchImpl(url, { cache: 'no-store' }).catch(() => null)
  if (!res?.ok) return null
  const data = await res.json() as { prescription?: Record<string, unknown> }
  return data.prescription ? toDialogPrescription(data.prescription) : null
}

function latestUrl(clientId: string, goalId: string | null): string {
  const base = `/api/clients/${clientId}/prescriptions/latest-draft`
  return goalId ? `${base}?goal_id=${encodeURIComponent(goalId)}` : base
}

export function toDialogPrescription(row: Record<string, unknown>): DialogPrescription | null {
  if (typeof row.id !== 'string' || typeof row.status !== 'string') return null
  return {
    id: row.id,
    status: row.status,
    content: isContent(row.content) ? row.content : null,
    progressNote: typeof row.progress_note === 'string' ? row.progress_note : null,
    errorMessage: typeof row.error_message === 'string' ? row.error_message : null,
    agentName: typeof row.agent_name === 'string' ? row.agent_name : null,
    selfGrade: isRecord(row.self_grade) ? row.self_grade as unknown as SelfGrade : null,
    intake: isRecord(row.intake) ? row.intake as unknown as PrescriptionIntake : null,
    manual: isRecord(row.generation_meta) && row.generation_meta.source === 'manual',
  }
}

function isContent(value: unknown): value is PrescriptionContent {
  return isRecord(value) && typeof value.summary === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
