/**
 * Closed vocabulary for 诸葛亮 recommendations.
 *
 * The conductor used to accept any snake_case slug. Production then stored
 * invented types (`launch_google_search_ads_3pl`, `configure_target_keywords`)
 * as pending execution items that nothing can run. A recommendation is
 * executable only when its action_type is already in the flywheel vocabulary
 * or the kernel registry. Anything else is manual review, not a pending card.
 */

import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import {
  ADS_ACTION_TYPE,
  GEO_ACTION_TYPE,
  SEO_ACTION_TYPE,
  SOCIAL_ACTION_TYPE,
} from '@/lib/flywheel/vocabulary'

export const MANUAL_REVIEW_ACTION_TYPE = 'manual_review'
export const MANUAL_REVIEW_DISPOSITION = 'manual_review'

const FLYWHEEL_ACTION_TYPES = new Set<string>([
  ...Object.values(GEO_ACTION_TYPE),
  ...Object.values(SEO_ACTION_TYPE),
  ...Object.values(ADS_ACTION_TYPE),
  ...Object.values(SOCIAL_ACTION_TYPE),
])

export function isRegisteredRecommendedAction(actionType: string): boolean {
  const trimmed = actionType.trim()
  if (!trimmed || trimmed === MANUAL_REVIEW_ACTION_TYPE) return false
  return FLYWHEEL_ACTION_TYPES.has(trimmed) || ACTION_REGISTRY.has(trimmed)
}

export function registeredRecommendedActionTypes(): readonly string[] {
  const types = new Set<string>(FLYWHEEL_ACTION_TYPES)
  for (const key of ACTION_REGISTRY.keys()) types.add(key)
  return Array.from(types).sort()
}

/** One prompt line. Injected so the model is not invited to invent a slug. */
export function formatRegisteredActionPrompt(): string {
  return (
    'action_type MUST be exactly one of: ' +
    registeredRecommendedActionTypes().join(', ') +
    '. If none fits, set action_type to "manual_review". Never invent a new slug.'
  )
}

export function partitionRecommendedActions<T extends { action_type: string }>(actions: T[]): {
  registered: T[]
  manualReview: T[]
} {
  const registered: T[] = []
  const manualReview: T[] = []
  for (const action of actions) {
    if (isRegisteredRecommendedAction(action.action_type)) registered.push(action)
    else manualReview.push(action)
  }
  return { registered, manualReview }
}
