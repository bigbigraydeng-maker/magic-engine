/**
 * Was a flywheel action actually carried out, or is it only an AI suggestion?
 *
 * Two writers store SUGGESTIONS in `flywheel_actions` with `executed_at` set to the
 * moment the suggestion was generated:
 *   - Zhuge's weekly plan (`zhuge/action-persister.ts`) — `payload.zhuge_session_key`;
 *   - the daily anomaly detector's proactive advice (`zhuge/proactive.ts`) —
 *     `payload.source = 'proactive_signal'`.
 * Neither ever fills `execution_item_id` or `action_run_id` later: when someone really
 * does the work, it is recorded as a separate action with its own card or run id. So
 * such a row with both link fields empty was never executed, and a before/after
 * difference measured from its `executed_at` says nothing about any real change.
 *
 * Everything else counts as executed: ads stop-loss, the ad execute routes, page
 * upgrades, kernel runs. NOTE for future writers: the D3 auto-pause flow keeps its run
 * id inside `payload` (not in `action_run_id`) and ad drafts / proposals awaiting
 * approval are stored as actions too — today none of them carries a success metric, so
 * counting them as executed is harmless. Before giving any of them an expected metric,
 * distinguish them by `payload.status` here.
 */

/** The fields the rule reads. Loaders select the two payload keys as plain columns. */
export interface ExecutionEvidence {
  /** `payload->>zhuge_session_key` — set only by Zhuge's weekly plan persister. */
  zhuge_session_key: string | null
  /** `payload->>source` — 'proactive_signal' for the anomaly detector's advice. */
  payload_source: string | null
  execution_item_id: string | null
  action_run_id: string | null
}

/** True when the action is an AI suggestion that was never carried out. */
export function isUnexecutedSuggestion(action: ExecutionEvidence): boolean {
  const isSuggestion =
    (action.zhuge_session_key !== null && action.zhuge_session_key !== '') ||
    action.payload_source === 'proactive_signal'
  return isSuggestion && action.execution_item_id === null && action.action_run_id === null
}

/** Fields the attribution job reads to decide whether an action can be scored. */
export interface EvaluabilityEvidence extends ExecutionEvidence {
  /** `payload->>discovery_id` — set when the action came from the discovery step as a recommendation. */
  discovery_id: string | null
  /** `vendor` column — a real provider name (meta, meta_graph, google_ads ...) is execution evidence. */
  vendor: string | null
}

/**
 * True when a before/after measurement of this action says nothing about any real change:
 * an AI suggestion that was never carried out, or a recommendation that came from the discovery
 * step and has no execution link and no provider. Rows with a card id, a run id or a vendor are real work.
 */
export function isNotEvaluable(action: EvaluabilityEvidence): boolean {
  if (isUnexecutedSuggestion(action)) return true
  const fromDiscovery = action.discovery_id !== null && action.discovery_id !== ''
  const hasProvider = action.vendor !== null && action.vendor !== ''
  return fromDiscovery && !hasProvider && action.execution_item_id === null && action.action_run_id === null
}
