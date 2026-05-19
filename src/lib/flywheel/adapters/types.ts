/**
 * FlywheelAdapter — core interface contract for all flywheel adapters.
 *
 * P12.A.3: types.ts defines the shared DTOs and the FlywheelAdapter interface
 * that every concrete adapter (GeoComposerAdapter, MetaAdsAdapter, …) must implement.
 *
 * Flywheel names, execution modes, and verdict values mirror the PostgreSQL enums
 * declared in migration 20260517000001_flywheel_data_skeleton.sql.
 */

// ── Enum mirrors (kept in sync with DB enums) ────────────────────────────────

export type FlywheelName = 'seo' | 'geo' | 'ads' | 'social'

export type ExecutionMode = 'in_house' | 'third_party' | 'external_manual'

export type OutcomeVerdict = 'confirmed' | 'inconclusive' | 'reversed'

// ── ExecutionTarget ───────────────────────────────────────────────────────────

/**
 * The execution_target JSONB shape stored on execution_items.
 * Drives how the UI routes a card and which adapter handles it.
 */
export interface ExecutionTarget {
  flywheel: FlywheelName
  mode: ExecutionMode
  /** Populated for third_party / external_manual rows (e.g. 'markisfact', 'fde') */
  vendor?: string
  /** Preferred action_type hint; adapter may override based on context */
  action_type?: string
}

// ── Input / output DTOs ───────────────────────────────────────────────────────

/**
 * Input to FlywheelAdapter.execute().
 * The caller (FlywheelDrawer / API route) builds this from the execution_item row.
 */
export interface ExecuteActionInput {
  clientId: string
  executionItemId?: string
  actionType: string          // from vocabulary, e.g. GEO_ACTION_TYPE.DEPLOY_DIRECTIVE
  executionMode: ExecutionMode
  vendor?: string
  /** Action-specific data (directive id, keyword list, campaign id, …) */
  payload?: Record<string, unknown>
  /** metric_key expected to improve after this action */
  expectedMetric?: string
  /** Positive = improvement expected (e.g. +0.1 mention_rate) */
  expectedDelta?: number
  /** P13.E: link this action back to the production package that triggered it */
  productionPackageId?: string
}

/**
 * Row shape returned by execute() — mirrors flywheel_actions columns.
 * Uses camelCase; DB writes use snake_case via the Supabase client.
 */
export interface FlywheelActionRow {
  id: string
  clientId: string
  executionItemId?: string
  flywheel: FlywheelName
  actionType: string
  executionMode: ExecutionMode
  vendor?: string
  payload?: Record<string, unknown>
  expectedMetric?: string
  expectedDelta?: number
  executedAt: string  // ISO 8601
  /** P13.E: traceability back to the production package that triggered this action */
  productionPackageId?: string
}

/**
 * Row shape returned by pullMetrics() — mirrors flywheel_metrics columns.
 */
export interface FlywheelMetricRow {
  id: string
  clientId: string
  flywheel: FlywheelName
  metricKey: string
  metricValue: number
  source: string
  sourceRef?: Record<string, unknown>
  measuredAt: string  // ISO 8601
}

// ── FlywheelAdapter interface ─────────────────────────────────────────────────

/**
 * Core contract every flywheel adapter must implement.
 *
 * Lifecycle:
 *   1. execute()     — called when the user confirms an action in FlywheelDrawer
 *                      or when an automated trigger fires.
 *   2. pullMetrics() — called by the metrics-cron job to ingest fresh signals.
 *
 * Adapters are registered in registry.ts and looked up by flywheel name.
 */
export interface FlywheelAdapter {
  /** Which flywheel this adapter handles. Must be unique in the registry. */
  readonly flywheel: FlywheelName

  /**
   * Record and execute a flywheel action.
   * Implementations must write a row to flywheel_actions and return it.
   */
  execute(input: ExecuteActionInput): Promise<FlywheelActionRow>

  /**
   * Pull measurable signals for a client and write them to flywheel_metrics.
   * Returns the rows written.
   * Stub implementations (Phase 12.B adapters not yet built) may return [].
   *
   * @param clientId  The client whose metrics to pull.
   * @param since     If provided, only pull metrics after this date.
   */
  pullMetrics(clientId: string, since?: Date): Promise<FlywheelMetricRow[]>
}
