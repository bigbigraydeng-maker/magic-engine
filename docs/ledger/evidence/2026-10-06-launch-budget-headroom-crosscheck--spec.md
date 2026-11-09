Write a new TypeScript file from the interface and rules below. You have NOT seen any existing implementation; do not look for one. Do not ask questions; if something is ambiguous, pick the most conservative reading (fail closed) and add a `// ASSUMPTION:` comment.

FILE YOU MAY EDIT (and nothing else): src/lib/ads-strategy/launch-budget-headroom-ds.ts  (already created empty; write the whole file)

## Purpose
A pure function that computes, from ad-entity snapshot rows, how much daily-budget headroom a client has under a total daily cap, using the SET daily budgets of entities that are currently delivering (not actual spend). It is read-only: no I/O, no network, no Date.now().

## Imports you must use (exactly these)
```ts
import { DELIVERING_STATUSES } from './portfolio/diagnostics/context'
import type { EntitySnapshotRow } from './portfolio/snapshot'
```
`DELIVERING_STATUSES` is a `ReadonlySet<string>` of Meta effective_status values that mean "spending money" (ACTIVE, IN_PROCESS, WITH_ISSUES, PENDING_BILLING_INFO). `EntitySnapshotRow` has (among others) these fields: `ad_account_id: string`, `level: 'account' | 'campaign' | 'adset' | 'ad' | 'audience'`, `entity_id: string`, `campaign_id: string | null`, `budget_level: 'cbo' | 'abo' | null`, `daily_budget_minor: number | null` (minor currency units, e.g. cents), `effective_status: string | null`, `currency: string | null`, `capture_reason: string` (one of 'daily' | 'changed' | 'first_seen' | 'disappeared' | ...), `captured_at: string` (ISO timestamp).

## Exports (exact names and shapes)
```ts
export type HeadroomRow = Pick<EntitySnapshotRow,
  'ad_account_id' | 'level' | 'entity_id' | 'campaign_id' | 'budget_level' |
  'daily_budget_minor' | 'effective_status' | 'currency' | 'capture_reason' | 'captured_at'>

export interface HeadroomUnit {
  adAccountId: string
  level: 'campaign' | 'adset'
  entityId: string
  dailyMinor: number
}

export interface CommittedIncrease { label: string; minor: number }

export type LaunchHeadroom =
  | {
      ok: true
      currency: string
      deliveringTotalMinor: number
      perAccountMinor: Record<string, number>
      latentTotalMinor: number
      latentPerAccountMinor: Record<string, number>
      latentUnits: HeadroomUnit[]
      capMinor: number
      committed: CommittedIncrease[]
      projectedMinor: number
      headroomAfterMinor: number
      fits: boolean
    }
  | { ok: false; reason: string }

export function computeLaunchHeadroom(args: {
  rows: readonly HeadroomRow[]
  capMinor: number | null
  committed: readonly CommittedIncrease[]
}): LaunchHeadroom
```

## Rules (all of them)
1. **Inputs validation → `{ok:false, reason}` (reason is any Chinese sentence):**
   - `capMinor` must be a positive safe integer, else fail.
   - every `committed[i].minor` must be a safe integer >= 0, else fail.
2. **Which rows count:** only rows whose `level` is 'campaign' or 'adset'. If the same entity (same ad_account_id + level + entity_id) appears several times, keep ONLY the one with the newest `captured_at` (compare by `Date.parse`); AFTER choosing the newest, drop entities whose newest row has `capture_reason === 'disappeared'`. If no rows are left, fail.
3. **Currency:** after step 2, all remaining rows must have one single currency (trim + upper-case); a missing/empty currency or more than one distinct currency → fail. The result `currency` is that one value (upper-case).
4. **Budget units (money lives on exactly one layer):**
   - A campaign with `budget_level === 'cbo'` carries its own budget; ad sets whose `campaign_id` equals such a campaign's entity_id are NEVER counted (their money is in the campaign).
   - Every other ad set (ad sets not under a CBO campaign) carries its own budget.
   - A campaign with `budget_level` not 'cbo' is never a unit by itself. But if such a campaign is *delivering* and its `budget_level` is anything other than 'abo' (e.g. null), fail (budget layer unknown).
5. **Delivering vs latent:** for a unit, let `status = effective_status ?? ''`.
   - `DELIVERING_STATUSES.has(status)` → delivering unit; its `daily_budget_minor` must be a positive safe integer, else fail. Collect it as `{adAccountId, level, entityId, dailyMinor}`.
   - else if status is exactly one of 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED' AND `daily_budget_minor` is a positive safe integer → latent unit (same shape). A paused unit with a missing/zero budget is simply ignored (not an error).
   - any other status (ARCHIVED, DELETED, DISAPPROVED, PENDING_REVIEW, ...) → ignored.
6. **Totals:** `deliveringTotalMinor` = sum of delivering units; `perAccountMinor[accountId]` = per-account sum of delivering units (only accounts that have at least one delivering unit appear). `latentTotalMinor`, `latentPerAccountMinor`, `latentUnits` likewise for latent units (latentUnits keeps the order in which units were encountered after the dedupe step).
7. **Projection:** `projectedMinor = deliveringTotalMinor + sum(committed.minor)`; if that is not a safe integer → fail. `headroomAfterMinor = capMinor - projectedMinor` (can be negative). `fits = projectedMinor <= capMinor` (exactly equal fits). `committed` in the result is a shallow copy of the input array, same order.
8. Never mutate the inputs. No `any`, no ts-ignore comments, no double type assertions. TypeScript strict. Style: no semicolons, single quotes, 2-space indent.

## RULES
Only edit the one file listed. Do not run commands. Do not create other files.
