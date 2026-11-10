/**
 * Re-read the prescription, its goal, and its plan at confirm time.
 * Goals have no "approved" status; the in-force state is `active`.
 */

export interface SourceRows {
  readonly clientId: string
  readonly prescriptionId: string
  readonly prescriptionStatus: string | null
  readonly version: number | null
  readonly goalId: string | null
  readonly goalStatus: string | null
  readonly goalClientId: string | null
  readonly planId: string | null
  readonly planStatus: string | null
  readonly planClientId: string | null
  readonly planPrescriptionId: string | null
  readonly planVersion: number | null
}

export interface SourceExpect {
  readonly prescriptionId: string
  readonly version: number
  readonly goalId: string
  readonly planId: string
}

export function sourceBlock(rows: SourceRows, expected: SourceExpect): string | null {
  if (rows.prescriptionId !== expected.prescriptionId) return '这份处方已经对不上，没有去暂停。'
  if (rows.prescriptionStatus !== 'approved' || rows.version !== expected.version) {
    return '处方已经不是当时批准的那一版，没有去暂停。'
  }
  if (!sameGoal(rows, expected)) return '目标已经不在执行中，没有去暂停。'
  if (!samePlan(rows, expected)) return '计划已经不是批准状态，没有去暂停。'
  return null
}

export function planIdFromMeta(meta: unknown): string | null {
  const root = record(meta)
  if (!root) return null
  return text(record(root.plan_approval)?.plan_id) ?? text(record(root.plan_draft)?.plan_id)
}

export function planLink(meta: unknown): { prescriptionId: string; version: number } | null {
  const from = record(record(meta)?.from_prescription)
  const prescriptionId = text(from?.prescription_id)
  const version = from?.version
  if (!prescriptionId || typeof version !== 'number' || !Number.isInteger(version)) return null
  return { prescriptionId, version }
}

function sameGoal(rows: SourceRows, expected: SourceExpect): boolean {
  return rows.goalId === expected.goalId
    && rows.goalClientId === rows.clientId
    && rows.goalStatus === 'active'
}

function samePlan(rows: SourceRows, expected: SourceExpect): boolean {
  return rows.planId === expected.planId
    && rows.planClientId === rows.clientId
    && rows.planStatus === 'approved'
    && rows.planPrescriptionId === expected.prescriptionId
    && rows.planVersion === expected.version
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
