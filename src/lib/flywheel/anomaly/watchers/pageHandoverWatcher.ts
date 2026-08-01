/**
 * Hand 3 — Page automation health check at the moment traffic starts.
 *
 * Reference case: Roman Hu / 30 Kiteroa. Ads went live to English-speaking
 * Auckland buyers while Page 227633594573276's automated reply answered in
 * Chinese. Every click that opened a conversation met the wrong language on day
 * one, and a human found it days later.
 *
 * ── WHY THE TRIGGER IS "TRAFFIC STARTED", NOT "CLIENT IS NEW" ────────────────
 *
 * The first version of this rule fired on client age (adopted within 30 days).
 * Replayed against real data it would have MISSED the very incident it was
 * written for: the Roman HU client record was created 2026-06-18, and the first
 * ad spend against it landed 2026-07-27 — 39 days later, outside the window.
 *
 * The risk does not begin when a row appears in `clients`. It begins the moment
 * ME starts buying traffic into a Page. So the clock starts at first recorded
 * spend, and falls back to client age only when no spend exists yet (a genuine
 * pre-launch check, worth doing before the money starts).
 *
 * ── WHAT THIS WATCHER CANNOT DO (verified 2026-08-02, do not oversell it) ────
 *
 * It does NOT read the Page's automation settings, because ME cannot:
 *
 *   1. The Meta MCP surface wired into ME is entirely `ads_*` tools. There is no
 *      messaging/automation tool among them.
 *   2. Nothing in this repo has ever called `/{page-id}/messenger_profile`.
 *   3. The greeting / instant-reply / "Automations" settings a user edits in
 *      Business Suite are not readable without a `pages_messaging`-scoped token
 *      per client Page, which ME does not hold.
 *
 * So it does the honest thing: it raises a ONE-TIME, explicitly unverified
 * prompt for a human to check the Page by hand, at the moment the risk is
 * highest. It never claims to have found a mismatch, because it never looked.
 * `requiresManualVerification` carries that caveat to anything that renders it.
 *
 * The route to a real check is in the accompanying report: the ad-level
 * `page_welcome_message` field on CtWA/Messenger creatives is reachable through
 * the ads API ME already uses, and would let a later version compare the
 * welcome text's language against the ad's targeting.
 */

import type { WatchSignal } from './types'
import { classifyDisposition, type RemedyProfile } from '../disposition'
import { daysBetween } from './adDeliveryWatcher'

/** How long after traffic starts the handover check stays relevant. */
export const TRAFFIC_START_WINDOW_DAYS = 30

/**
 * Editing a Page's automated replies changes what real customers are shown, so
 * it can never be automatic — regardless of how safe the edit looks.
 */
const REMEDY_EDIT_PAGE_AUTOMATION: RemedyProfile = {
  spendsMoney: false,
  customerFacing: true,
  hardToReverse: false,
}

export interface PageHandoverInput {
  clientId: string
  clientName: string
  clientCreatedAt: string
  facebookPageId: string | null
  metaAdAccountId: string | null
  /**
   * First date we recorded ad spend for this client, or null if they have never
   * spent. This is the real risk clock — see the header.
   */
  firstAdSpendDate: string | null
  /** Recent daily ad spend pointed at this Page, for the money line. */
  recentDailyAdSpendAud: number
  /** True when this rule has already fired for this client at any time. */
  alreadyChecked: boolean
}

/**
 * Raise a one-time manual verification prompt for a Page that is receiving, or
 * is about to receive, bought traffic.
 *
 * Fires only when ALL hold:
 *   - a Page is actually linked (nothing to check otherwise)
 *   - an ad account is linked (the risk only exists if traffic is being bought)
 *   - traffic started recently — or has not started yet and the client is new
 *   - it has not already been raised (one prompt, not a daily nag)
 */
export function detectUncheckedPageHandover(
  input: PageHandoverInput,
  today: string
): Omit<WatchSignal, 'clientId' | 'clientName'> | null {
  if (!input.facebookPageId) return null
  if (!input.metaAdAccountId) return null
  if (input.alreadyChecked) return null

  const trafficStarted = input.firstAdSpendDate !== null
  const anchor = trafficStarted
    ? input.firstAdSpendDate!.slice(0, 10)
    : input.clientCreatedAt.slice(0, 10)

  const daysSinceAnchor = daysBetween(anchor, today)
  // Future-dated anchor means the data is ahead of the run date; not our call.
  if (daysSinceAnchor < 0) return null
  if (daysSinceAnchor > TRAFFIC_START_WINDOW_DAYS) return null

  const verdict = classifyDisposition(REMEDY_EDIT_PAGE_AUTOMATION)

  const daysOngoing = Math.max(daysSinceAnchor, 1)
  const hasLiveSpend = input.recentDailyAdSpendAud > 0
  const moneyImpactAud = hasLiveSpend
    ? Math.round(input.recentDailyAdSpendAud * daysOngoing * 100) / 100
    : 0
  const moneyBasis = hasLiveSpend
    ? `Ad spend already pointed at this Page: ` +
      `$${input.recentDailyAdSpendAud.toFixed(2)}/day x ${daysOngoing} day(s) ` +
      `since traffic started on ${anchor}. Every click that opens a chat meets ` +
      `whatever the Page replies with.`
    : 'No spend recorded against this Page yet — check before traffic starts.'

  const opening = trafficStarted
    ? `Paid traffic to "${input.clientName}" started on ${anchor} ` +
      `(${daysSinceAnchor} day(s) ago) via Page ${input.facebookPageId}.`
    : `"${input.clientName}" has Page ${input.facebookPageId} and a live ad ` +
      `account but no spend recorded yet.`

  return {
    watcherId: 'page-handover',
    ruleId: 'page-automation-unverified',
    flywheel: 'social',
    severity: hasLiveSpend ? 'high' : 'medium',
    entityId: input.facebookPageId,
    entityName: `Page ${input.facebookPageId}`,
    whatChanged:
      `${opening} ME CANNOT READ this Page's automated replies, so nobody has ` +
      `confirmed they answer in the same language the ads target. A human needs ` +
      `to open the Page's Inbox > Automations once and confirm the greeting, ` +
      `instant reply and away message match the ad audience.`,
    moneyImpactAud,
    moneyBasis,
    daysOngoing,
    disposition: verdict.disposition,
    dispositionReason: verdict.reason,
    remedy: REMEDY_EDIT_PAGE_AUTOMATION,
    observedThrough: today,
    requiresManualVerification: true,
  }
}
