/**
 * Client Knowledge Base — shared types for step 2/6 (Issue #1644).
 *
 * See `sensitivity.ts` (Issue #1643) for the `Sensitivity` classification
 * this module builds on.
 */

import type { Sensitivity } from './sensitivity'

export type FactStatus = 'candidate' | 'approved' | 'rejected' | 'retired' | 'superseded'

export const FACT_STATUSES: readonly FactStatus[] = [
  'candidate',
  'approved',
  'rejected',
  'retired',
  'superseded',
]

export type Visibility = 'customer_ok' | 'internal_only' | 'forbidden'

export const VISIBILITIES: readonly Visibility[] = ['customer_ok', 'internal_only', 'forbidden']

/**
 * Why the caller wants knowledge. Determines both the visibility filter and
 * whether the dual-sign (customer confirmation) gate applies — see
 * `read.ts` header for the full decision table.
 */
export type KnowledgePurpose = 'customer_reply' | 'internal_brief' | 'lead_classification'

/**
 * One approved (or being-considered) knowledge fact, as read from
 * `client_knowledge_facts`. Field names are camelCase — the DB row shape
 * (`FactRow`) stays snake_case and internal to `read.ts` / `fingerprint.ts`.
 */
export interface KnowledgeEntry {
  id: string
  clientId: string
  factKey: string
  scope: Record<string, unknown>
  statement: string
  structuredValue: unknown
  /** 萃取工作流（issue #1645）用它跨行/跨轮次把互相矛盾的候选串成同一个冲突组；已批准事实也可能带一个非空值（表示曾经跟某个候选冲突过）。 */
  conflictGroupId: string | null
  status: FactStatus
  visibility: Visibility
  sensitivity: Sensitivity
  validFrom: string
  validUntil: string | null
  lastVerifiedAt: string | null
  approvedByEmail: string | null
  approvedAt: string | null
  clientConfirmedByEmail: string | null
  clientConfirmedAt: string | null
}

/**
 * `getClientKnowledge()`'s real return shape.
 *
 * 🔴 Deviates on purpose from the issue's illustrative
 * `Promise<KnowledgeEntry[]>` signature: the issue's own prose requires a
 * "never mention these fact_keys" list to come back alongside the usable
 * entries ("给校验闸用，不是完全拿掉这个信息") — a bare array has nowhere to
 * carry that. Issue #1644 explicitly allows field/shape naming to be decided
 * by the implementer ("字段名最终由实施者/子牙定，不必逐字照抄").
 */
export interface KnowledgeReadResult {
  entries: KnowledgeEntry[]
  /** fact_key values whose visibility is 'forbidden' for this client — never say these. */
  forbiddenFactKeys: string[]
}

export interface GetClientKnowledgeOptions {
  purpose: KnowledgePurpose
  scope?: Record<string, unknown>
}

export type EntitlementBasis = 'fde_managed' | 'tier_499' | 'enterprise'

export interface KnowledgeEntitlement {
  entitled: boolean
  basis?: EntitlementBasis
  grantedBy?: string
  grantedAt?: string
}
