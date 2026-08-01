/**
 * Watcher subsystem — the "standing hands" of a per-client agent.
 *
 * Distinct from the legacy rule engine in ../rules.ts, which compares metric
 * VALUES inside flywheel_metrics. That design structurally cannot see the
 * failures that actually hurt us, because the real failures show up as the
 * ABSENCE of rows:
 *
 *   CTS "Lead Form — Reborn" stopped on 2026-07-20. It did not write zero-spend
 *   rows afterwards — it simply stopped writing rows. A value-threshold rule has
 *   nothing to compare, so it never fires. Six days of a campaign that had been
 *   producing ~12 leads/day went unnoticed until a human happened to look.
 *
 * Watchers therefore reason about recency and continuity, not just magnitude.
 */

import type { AnomalySeverity, FlywheelName } from '../types'
import type { Disposition, RemedyProfile } from '../disposition'

/**
 * A detected problem. Every signal MUST carry the three facts a human needs to
 * triage without opening a dashboard:
 *   whatChanged  — 什么变了
 *   moneyImpact  — 影响多少钱
 *   daysOngoing  — 已经多久了
 */
export interface WatchSignal {
  clientId: string
  clientName: string
  /** Which hand produced this. */
  watcherId: 'ad-delivery' | 'content-supply' | 'page-handover'
  /** Specific rule within the hand, stored as anomaly_signals.rule_id. */
  ruleId: string
  flywheel: FlywheelName
  severity: AnomalySeverity

  /** Platform object this concerns (campaign id, page id...), when applicable. */
  entityId: string | null
  entityName: string | null

  /** 什么变了 — one sentence, concrete, with the numbers in it. */
  whatChanged: string

  /**
   * 影响多少钱 — AUD. MUST be derived from real recorded spend, never guessed.
   * 0 is a legitimate, honest answer for problems with no direct spend.
   */
  moneyImpactAud: number
  /** Exactly how moneyImpactAud was computed, so the number can be audited. */
  moneyBasis: string

  /** 已经多久了 — whole days the condition has persisted. */
  daysOngoing: number

  disposition: Disposition
  dispositionReason: string
  /** The remedy profile that produced the disposition, kept for auditing. */
  remedy: RemedyProfile

  /**
   * The data date this judgement is based on — NOT the run date. Ad data lags
   * roughly one day, so conflating them silently shifts every "how long" number.
   */
  observedThrough: string

  /** True when the watcher could not verify and is asking a human to look. */
  requiresManualVerification?: boolean
}

/** One day of delivery for one platform object. */
export interface AdDeliveryDay {
  insightDate: string
  spend: number
  results: number
  leads: number
  impressions: number
}

/** Full delivery history for one campaign, oldest first. */
export interface AdEntityHistory {
  entityId: string
  entityName: string
  days: AdDeliveryDay[]
}
