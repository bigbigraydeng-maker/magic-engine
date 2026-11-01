/**
 * Walk already-live prescriptions and store due plain-language checks.
 * The caller supplies the database. This file does not talk to Meta.
 */

import type { EffectJudgmentCard } from '@/lib/ads-strategy/effect-judgment/card'
import {
  judgeLaunch, linesForCard, matchLaunch, parseExecutedLaunches, planOutcomeWrites,
  type ActionRow, type InsightRef, type KpiRef, type LaunchAssessment, type PlanRef,
  type PrescriptionRef, type SiblingRef,
} from './prescription-launch-check'

export interface StoredPrescription extends PrescriptionRef {
  clientId: string
  kpis: KpiRef[]
  /** Null when the prescription was saved before the effect-judgment card. */
  effectCard: EffectJudgmentCard | null
}

export interface ExistingOutcomeRow {
  id: string
  kpiMetric: string
  unit: string | null
  dimension: string | null
}

export interface OutcomeInsert {
  prescriptionId: string
  caseId: string
  clientId: string
  kpiMetric: string
  unit: 'met' | 'missed' | 'unknown'
  dimension: string
}

export interface LaunchCheckStore {
  listClientActions(clientId: string): Promise<ActionRow[]>
  listAllActions(): Promise<{ rows: ActionRow[]; partial: boolean }>
  listApprovedPlans(clientId: string): Promise<PlanRef[]>
  listApprovedPrescriptions(clientId: string): Promise<StoredPrescription[]>
  listInsights(clientId: string, campaignId: string): Promise<InsightRef[]>
  /** Timezone the campaign's ad account cuts daily rows in; null when unreadable. */
  readAccountTimezone(clientId: string, campaignId: string): Promise<string | null>
  findCaseId(prescriptionId: string): Promise<string | null>
  listOutcomes(caseId: string): Promise<ExistingOutcomeRow[]>
  insertOutcome(row: OutcomeInsert): Promise<void>
  updateOutcome(id: string, patch: { unit: string; dimension: string }): Promise<void>
}

export interface LaunchCheckReceipt {
  partial: boolean
  launches: number
  prescriptions_checked: number
  outcomes_written: number
  outcomes_skipped: number
  unsaved: number
  failed: number
}

interface Counts {
  prescriptions_checked: number
  outcomes_written: number
  outcomes_skipped: number
  unsaved: number
  failed: number
}

export async function runWithStore(store: LaunchCheckStore, now: Date): Promise<LaunchCheckReceipt> {
  const scanned = await store.listAllActions()
  const receipt = emptyReceipt(scanned.partial, parseExecutedLaunches(scanned.rows).launches.length)
  for (const [clientId, actions] of groupByClient(scanned.rows)) {
    addCounts(receipt, await checkClient(store, clientId, actions, now))
  }
  return receipt
}

export async function readOneLaunch(store: LaunchCheckStore, input: {
  clientId: string
  prescription: PrescriptionRef
  kpis: readonly KpiRef[]
  effectCard?: EffectJudgmentCard | null
  now: Date
}): Promise<{ lines: string[] }> {
  const parsed = parseExecutedLaunches(await store.listClientActions(input.clientId))
  const match = matchLaunch({
    prescription: input.prescription,
    launches: parsed.launches,
    plans: await store.listApprovedPlans(input.clientId),
    siblings: asSiblings(await store.listApprovedPrescriptions(input.clientId)),
    missingCampaign: parsed.missingCampaign > 0,
  })
  if (match.kind !== 'matched') return { lines: match.lines }
  const assessment = judgeLaunch({
    launch: match.launch,
    insights: await store.listInsights(input.clientId, match.launch.campaignId),
    kpis: input.kpis,
    effectCard: input.effectCard ?? null,
    now: input.now,
    accountTimezone: await store.readAccountTimezone(input.clientId, match.launch.campaignId),
  })
  const caseId = await store.findCaseId(input.prescription.id)
  return { lines: linesForCard(assessment, caseId !== null) }
}

async function checkClient(
  store: LaunchCheckStore,
  clientId: string,
  actions: readonly ActionRow[],
  now: Date,
): Promise<Counts> {
  const counts = emptyCounts()
  try {
    const plans = await store.listApprovedPlans(clientId)
    const prescriptions = await store.listApprovedPrescriptions(clientId)
    const parsed = parseExecutedLaunches(actions)
    for (const prescription of prescriptions) {
      counts.prescriptions_checked += 1
      addCounts(counts, await checkOne(store, prescription, parsed, plans, prescriptions, now))
    }
  } catch {
    counts.failed += 1
  }
  return counts
}

async function checkOne(
  store: LaunchCheckStore,
  prescription: StoredPrescription,
  parsed: ReturnType<typeof parseExecutedLaunches>,
  plans: readonly PlanRef[],
  siblings: readonly StoredPrescription[],
  now: Date,
): Promise<Counts> {
  const counts = emptyCounts()
  try {
    const match = matchLaunch({
      prescription,
      launches: parsed.launches,
      plans,
      siblings: asSiblings(siblings),
      missingCampaign: parsed.missingCampaign > 0,
    })
    if (match.kind !== 'matched') return counts
    const assessment = judgeLaunch({
      launch: match.launch,
      insights: await store.listInsights(prescription.clientId, match.launch.campaignId),
      kpis: prescription.kpis,
      effectCard: prescription.effectCard,
      now,
      accountTimezone: await store.readAccountTimezone(prescription.clientId, match.launch.campaignId),
    })
    addCounts(counts, await persist(store, prescription, assessment))
  } catch {
    counts.failed += 1
  }
  return counts
}

async function persist(
  store: LaunchCheckStore,
  prescription: StoredPrescription,
  assessment: LaunchAssessment,
): Promise<Counts> {
  const counts = emptyCounts()
  const due = assessment.checkpoints.filter(point => point.due && point.verdict !== 'pending')
  const caseId = await store.findCaseId(prescription.id)
  if (!caseId) {
    if (due.length > 0) counts.unsaved += 1
    return counts
  }
  const writes = planOutcomeWrites(assessment.checkpoints, await store.listOutcomes(caseId))
  counts.outcomes_skipped += due.length - writes.length
  for (const write of writes) {
    const saved = await applyWrite(store, prescription, caseId, write)
    if (saved) counts.outcomes_written += 1
    else counts.failed += 1
  }
  return counts
}

async function applyWrite(
  store: LaunchCheckStore,
  prescription: StoredPrescription,
  caseId: string,
  write: ReturnType<typeof planOutcomeWrites>[number],
): Promise<boolean> {
  try {
    if (write.op === 'insert') {
      await store.insertOutcome({
        prescriptionId: prescription.id,
        caseId,
        clientId: prescription.clientId,
        kpiMetric: write.kpiMetric,
        unit: write.unit,
        dimension: write.dimension,
      })
    } else {
      await store.updateOutcome(write.id, { unit: write.unit, dimension: write.dimension })
    }
    return true
  } catch {
    return false
  }
}

function asSiblings(rows: readonly { id: string; approvedAt: string | null }[]): SiblingRef[] {
  return rows.flatMap(row => (row.approvedAt ? [{ id: row.id, approvedAt: row.approvedAt }] : []))
}

function groupByClient(rows: readonly ActionRow[]): Map<string, ActionRow[]> {
  const grouped = new Map<string, ActionRow[]>()
  for (const row of rows) {
    if (row.clientId.trim() === '') continue
    const list = grouped.get(row.clientId) ?? []
    list.push(row)
    grouped.set(row.clientId, list)
  }
  return grouped
}

function emptyReceipt(partial: boolean, launches: number): LaunchCheckReceipt {
  return { partial, launches, ...emptyCounts() }
}

function emptyCounts(): Counts {
  return { prescriptions_checked: 0, outcomes_written: 0, outcomes_skipped: 0, unsaved: 0, failed: 0 }
}

function addCounts(target: Counts, extra: Counts): void {
  target.prescriptions_checked += extra.prescriptions_checked
  target.outcomes_written += extra.outcomes_written
  target.outcomes_skipped += extra.outcomes_skipped
  target.unsaved += extra.unsaved
  target.failed += extra.failed
}
