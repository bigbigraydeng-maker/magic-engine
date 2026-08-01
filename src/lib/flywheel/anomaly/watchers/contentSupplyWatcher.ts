/**
 * Hand 2 — Content supply watcher.
 *
 * Catches a serviced client going quiet: nothing produced for them across
 * flywheel_actions, reels_drafts or content_posts for more than a week.
 *
 * Oztop is the reference case — last activity 2026-07-14, noticed by a human on
 * 2026-07-27, 13 days later.
 *
 * Three deliberate guards against false alarms:
 *   1. A brand-new client cannot be "in drought" — the clock starts at the
 *      later of their creation date and their last activity, so a client
 *      onboarded yesterday is never flagged.
 *   2. Clients we do not run a content line for are never flagged at all —
 *      see `contentExpected` below. This is what keeps Type B (single-property
 *      lead-gen) clients out of it.
 *   3. The remedy (draft some content) is internal and reversible, so this is
 *      the one hand whose fix is genuinely `auto`-eligible.
 */

import type { WatchSignal } from './types'
import { classifyDisposition, type RemedyProfile } from '../disposition'
import { daysBetween } from './adDeliveryWatcher'

/** Days of silence before a serviced client counts as in drought. */
export const CONTENT_DROUGHT_DAYS = 7

/**
 * Drafting content is internal, costs no media spend, and a draft can simply be
 * deleted. This is the only remedy in v1 that classifies as `auto`.
 */
const REMEDY_DRAFT_CONTENT: RemedyProfile = {
  spendsMoney: false,
  customerFacing: false,
  hardToReverse: false,
}

export interface ContentActivityInput {
  clientId: string
  clientName: string
  clientCreatedAt: string
  /** Most recent production date across all content tables, or null if never. */
  lastActivityDate: string | null
  /** Recent daily ad spend, used only to express what the silence is costing. */
  recentDailyAdSpendAud: number
  /**
   * Do we run a content line for this client at all?
   *
   * WHY THIS EXISTS — Type B clients (a single property development, e.g.
   * 30 Kiteroa Rothesay Bay) buy leads, not content. ME is measured on ad
   * spend, cost per lead, lead delivery and outcome feedback for them, and
   * never on SEO/GEO/social. Telling a human "no content produced for
   * 30 Kiteroa in 14 days" is not a finding, it is noise about something
   * nobody agreed to do — and noise is how a watcher gets ignored.
   *
   * v1 derives this from evidence rather than a taxonomy field: a client is
   * content-tracked once anything has ever been produced for them. See
   * `resolveContentExpectation` in ../WatcherJob.ts, and the `clients.client_type`
   * migration proposed alongside this change for the authoritative version.
   */
  contentExpected: boolean
}

/**
 * Detect a content drought.
 *
 * `today` is passed in rather than read from the clock so the rule is
 * deterministic under test.
 */
export function detectContentDrought(
  input: ContentActivityInput,
  today: string
): Omit<WatchSignal, 'clientId' | 'clientName'> | null {
  // Type B / leads-only clients are out of scope entirely — not "quiet", just
  // not a content client. Guard lives in the rule, not the caller, so no future
  // caller can reintroduce the false alarm by forgetting to filter.
  if (!input.contentExpected) return null

  const createdDate = input.clientCreatedAt.slice(0, 10)

  // Clock starts at the later of "we started working with them" and "we last
  // produced something", so onboarding does not read as neglect.
  const effectiveStart =
    input.lastActivityDate && input.lastActivityDate > createdDate
      ? input.lastActivityDate
      : createdDate

  const silentDays = daysBetween(effectiveStart, today)
  if (silentDays <= CONTENT_DROUGHT_DAYS) return null

  const verdict = classifyDisposition(REMEDY_DRAFT_CONTENT)

  const neverProduced = input.lastActivityDate === null
  const whatChanged = neverProduced
    ? `Nothing has ever been produced for "${input.clientName}" — ${silentDays} days ` +
      `since they were added on ${createdDate}.`
    : `No new content, action or reel for "${input.clientName}" since ` +
      `${input.lastActivityDate} (${silentDays} days).`

  // Only claim a money figure when paid delivery is genuinely running.
  const hasLiveSpend = input.recentDailyAdSpendAud > 0
  const moneyImpactAud = hasLiveSpend
    ? Math.round(input.recentDailyAdSpendAud * silentDays * 100) / 100
    : 0
  const moneyBasis = hasLiveSpend
    ? `Ad spend still running behind stale content: ` +
      `$${input.recentDailyAdSpendAud.toFixed(2)}/day x ${silentDays} days.`
    : 'No direct spend implication — this client has no live ad delivery.'

  return {
    watcherId: 'content-supply',
    ruleId: 'content-drought',
    flywheel: 'social',
    severity: silentDays >= CONTENT_DROUGHT_DAYS * 2 ? 'high' : 'medium',
    entityId: null,
    entityName: null,
    whatChanged,
    moneyImpactAud,
    moneyBasis,
    daysOngoing: silentDays,
    disposition: verdict.disposition,
    dispositionReason: verdict.reason,
    remedy: REMEDY_DRAFT_CONTENT,
    observedThrough: today,
  }
}
