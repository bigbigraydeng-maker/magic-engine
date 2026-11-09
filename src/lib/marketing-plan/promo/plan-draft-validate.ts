/**
 * One draft check for manual save, key save, and auto-draft.
 * The rule set is the union of those three. A rejection that any of them
 * already made is still a rejection.
 *
 * Shape: parse, drop approval receipts, parse again.
 * Caps: a definite over-budget, or an account that is not this client's, is rejected.
 * An unknown cap is not a rejection; the approval checklist still blocks spend.
 * Seed: when the caller passes `seed` (including null), the draft may not exceed
 * that suggestion. Manual save has no suggestion, so it omits the field.
 */

import { seedBudgetProblems } from '@/lib/ads-strategy/plan-seed/budget-ceiling'
import type { PlanSeed } from '@/lib/ads-strategy/plan-seed/types'
import { collectPhaseBudgetProblems, type AccountCapFacts } from './budget-caps'
import { parsePromoSpec, type PromoSpec, type PromoValidationIssue } from './spec'

export interface PlanDraftFacts {
  accounts: readonly AccountCapFacts[]
  clientCapCents: number | null
  seed?: PlanSeed | null
}

export type PlanDraftValidation =
  | { ok: true; spec: PromoSpec }
  | { ok: false; code: 'invalid_spec'; issues: PromoValidationIssue[] }
  | { ok: false; code: 'budget_over'; spec: PromoSpec; problems: string[] }

export function validatePlanDraft(raw: unknown, facts: PlanDraftFacts): PlanDraftValidation {
  const spec = canonicalPlanSpec(raw)
  if (!spec.ok) return { ok: false, code: 'invalid_spec', issues: spec.issues }
  const problems = draftBudgetProblems(spec.spec, facts)
  if (problems.length > 0) return { ok: false, code: 'budget_over', spec: spec.spec, problems }
  return { ok: true, spec: spec.spec }
}

function canonicalPlanSpec(raw: unknown): { ok: true; spec: PromoSpec } | { ok: false; issues: PromoValidationIssue[] } {
  const first = parsePromoSpec(raw)
  if (!first.ok) return first
  const stripped: PromoSpec = { ...first.spec, checks: [] }
  delete stripped.gate_snapshot
  return parsePromoSpec(stripped)
}

function draftBudgetProblems(spec: PromoSpec, facts: PlanDraftFacts): string[] {
  if (facts.seed !== undefined) {
    const seedProblems = seedBudgetProblems(spec, facts.seed)
    if (seedProblems.length > 0) return seedProblems
  }
  return collectPhaseBudgetProblems(spec, facts.accounts, facts.clientCapCents)
}
