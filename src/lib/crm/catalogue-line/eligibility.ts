/**
 * Who may be sent the catalogue (the catalogue line's own rules; the send gates still run on top of these).
 * Design: docs/specs/2026-11-09-crm-catalogue-send-b0-b3-design-v0.md §3.4.
 *
 * Stages are judged only by their marketing_action / is_terminal, never by a client's stage names.
 * Unlike the "who to call today" list (loadSuppressedStages treats an unreadable config as "nothing suppressed"), here
 * anything that cannot be read is a refusal: a catalogue sent to a guest who had already paid is the failure to avoid.
 */

import { isMarketingAction, stageSuppressesWorklist } from '@/lib/crm/pipeline'

export interface EligibilityContact {
  doNotContact: boolean
  stage: string | null
  snoozeUntil: string | null
}

export interface EligibilityStage {
  stageKey: string
  marketingAction: string | null
  isTerminal: boolean | null
}

export interface EligibilityData {
  /** null = no such guest for this client. Throws when it cannot be read. */
  loadContact(clientId: string, contactId: string): Promise<EligibilityContact | null>
  /** The client's whole stage config. Throws when it cannot be read. */
  loadStages(clientId: string): Promise<EligibilityStage[]>
}

export type EligibilityRefusal =
  | 'not_found'
  | 'do_not_contact'
  | 'stage_suppressed'
  | 'stage_deferred'
  | 'stage_unknown'
  | 'snoozed'
  | 'eligibility_unreadable'

export type EligibilityResult = { ok: true } | { ok: false; reason: EligibilityRefusal; message: string }

export const ELIGIBILITY_MESSAGES: Record<EligibilityRefusal, string> = {
  not_found: '找不到这个客人。',
  do_not_contact: '这位客人被标了「别再联系」，目录没有发出。',
  stage_suppressed: '这位客人的阶段已经有结论（例如已付定金、已成交或不再营销），不发目录。',
  stage_deferred: '这位客人在「先放一放」的阶段，现在不发目录。',
  stage_unknown: '这位客人的阶段在阶段设置里找不到，先别发，请检查阶段设置。',
  snoozed: '这位客人被设了「过阵子再提醒」，还没到时间，现在不发目录。',
  eligibility_unreadable: '暂时读不到这位客人的资料或阶段设置，目录没有发出，请稍后再试。',
}

const refuse = (reason: EligibilityRefusal): EligibilityResult => ({ ok: false, reason, message: ELIGIBILITY_MESSAGES[reason] })

/** The rules themselves, on data already read. */
export function judgeEligibility(contact: EligibilityContact, stages: readonly EligibilityStage[], now: Date): EligibilityResult {
  if (contact.doNotContact) return refuse('do_not_contact')
  if (contact.stage !== null) {
    const stage = stages.find((s) => s.stageKey === contact.stage)
    // A stage the config does not know, or an action this code does not know, is never read as "fine to send".
    if (stage === undefined || !isMarketingAction(stage.marketingAction)) return refuse('stage_unknown')
    if (stageSuppressesWorklist(stage.marketingAction, stage.isTerminal)) return refuse('stage_suppressed')
    if (stage.marketingAction === 'defer') return refuse('stage_deferred')
  }
  if (contact.snoozeUntil !== null) {
    const until = Date.parse(contact.snoozeUntil)
    if (Number.isNaN(until) || until > now.getTime()) return refuse('snoozed')
  }
  return { ok: true }
}

export async function checkCatalogueEligibility(
  args: { clientId: string; contactId: string; now: Date },
  data: EligibilityData,
): Promise<EligibilityResult> {
  let contact: EligibilityContact | null
  let stages: EligibilityStage[]
  try {
    contact = await data.loadContact(args.clientId, args.contactId)
    if (contact === null) return refuse('not_found')
    stages = contact.stage === null ? [] : await data.loadStages(args.clientId)
  } catch (err) {
    console.error('[catalogue-line] 进线检查读数据失败:', err instanceof Error ? err.message : err)
    return refuse('eligibility_unreadable')
  }
  return judgeEligibility(contact, stages, args.now)
}
