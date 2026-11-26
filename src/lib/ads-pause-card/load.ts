/**
 * Load one prescription and the goal and plan it must still match.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { planIdFromMeta, planLink, type SourceRows } from './source'

export interface PrescriptionBundle extends SourceRows {
  readonly content: unknown
}

export async function loadPrescriptionBundle(
  sb: SupabaseClient,
  clientId: string,
  prescriptionId: string,
): Promise<PrescriptionBundle | null | 'unreadable'> {
  const prescription = await one(sb, 'prescriptions', 'id, status, version, goal_id, content, generation_meta', clientId, prescriptionId)
  if (prescription === 'unreadable') return 'unreadable'
  if (!prescription) return null
  const goalId = text(prescription.goal_id)
  const planId = planIdFromMeta(prescription.generation_meta)
  const goal = goalId ? await one(sb, 'goals', 'id, client_id, status', clientId, goalId) : null
  const plan = planId ? await one(sb, 'marketing_plans', 'id, client_id, status, generation_meta', clientId, planId) : null
  if (goal === 'unreadable' || plan === 'unreadable') return 'unreadable'
  const link = plan ? planLink(plan.generation_meta) : null
  return {
    clientId,
    prescriptionId,
    prescriptionStatus: text(prescription.status),
    version: typeof prescription.version === 'number' ? prescription.version : null,
    content: prescription.content,
    goalId,
    goalStatus: text(goal?.status),
    goalClientId: text(goal?.client_id),
    planId,
    planStatus: text(plan?.status),
    planClientId: text(plan?.client_id),
    planPrescriptionId: link?.prescriptionId ?? null,
    planVersion: link?.version ?? null,
  }
}

export async function listApprovedIds(sb: SupabaseClient, clientId: string): Promise<string[] | 'unreadable'> {
  const { data, error } = await sb.from('prescriptions').select('id').eq('client_id', clientId).eq('status', 'approved')
  if (error) return 'unreadable'
  return ((data ?? []) as Array<{ id?: unknown }>).flatMap((row) => typeof row.id === 'string' ? [row.id] : [])
}

async function one(
  sb: SupabaseClient,
  table: string,
  columns: string,
  clientId: string,
  id: string,
): Promise<Record<string, unknown> | null | 'unreadable'> {
  const { data, error } = await sb.from(table).select(columns).eq('id', id).eq('client_id', clientId).maybeSingle()
  if (error) return 'unreadable'
  return (data as Record<string, unknown> | null) ?? null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
