import { randomUUID } from 'node:crypto'
import { attemptPlanDraft } from './plan-draft-attempt'
import { productionPlanDraftDeps } from './plan-draft-deps'
import { isUsableDraft } from './plan-draft-types'

/** After a new prescription draft is saved. Errors stay here and never block the save. */
export async function afterPrescriptionDraftSaved(args: {
  clientId: string
  prescriptionId: string
}): Promise<void> {
  try {
    const deps = productionPlanDraftDeps()
    const row = await deps.loadPrescription(args.clientId, args.prescriptionId)
    if (!isUsableDraft(row)) return
    await attemptPlanDraft({
      clientId: args.clientId,
      prescriptionId: args.prescriptionId,
      version: row.version,
      attempt: 1,
      requestId: randomUUID(),
    }, deps, row)
  } catch (err) {
    console.warn('[plan-draft] follow-up failed', err instanceof Error ? err.name : 'error')
  }
}
