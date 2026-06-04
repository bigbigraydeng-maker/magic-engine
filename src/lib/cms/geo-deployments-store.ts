/**
 * geo_deployments persistence layer (B2 of GEO-B+ Stage 1).
 *
 * One row per (client_id, directive_id, target_path). Lifecycle:
 *
 *   pending_pr  →  PR opened, awaiting FDE merge
 *   merged      →  PR merged (webhook flips this in B3)
 *   superseded  →  a newer publish replaced this row (we close the stale PR)
 *   closed      →  PR closed without merging (FDE rejected)
 *
 * This module is server-only — RLS allows service_role full access.
 */

import { supabaseAdmin } from '../supabase'

/**
 * Thrown by recordDeployment when MF6's partial unique index trips, meaning
 * another publish has an in-flight pending_pr row for the same (client,
 * directive, target_path). Route turns this into 422 CONCURRENT_PUBLISH_IN_PROGRESS.
 */
export class ConcurrentDeploymentError extends Error {
  constructor() {
    super('Another publish is already in flight for this (client, directive, target_path)')
    this.name = 'ConcurrentDeploymentError'
  }
}

export type GeoDeploymentStatus =
  | 'pending_pr'
  | 'merged'
  | 'superseded'
  | 'closed'

export interface GeoDeploymentRow {
  id:             string
  client_id:      string
  directive_id:   string
  target_path:    string
  branch:         string
  pr_number:      number
  pr_url:         string
  injected_hash:  string
  status:         GeoDeploymentStatus
  created_at:     string
  updated_at:     string
}

export interface CreateDeploymentParams {
  clientId:     string
  directiveId:  string
  targetPath:   string
  branch:       string
  prNumber:     number
  prUrl:        string
  injectedHash: string
}

/**
 * Insert a fresh deployment row in pending_pr state.
 * Called immediately after a new PR is opened.
 */
export async function recordDeployment(
  params: CreateDeploymentParams,
): Promise<GeoDeploymentRow> {
  const { data, error } = await supabaseAdmin
    .from('geo_deployments')
    .insert({
      client_id:     params.clientId,
      directive_id:  params.directiveId,
      target_path:   params.targetPath,
      branch:        params.branch,
      pr_number:     params.prNumber,
      pr_url:        params.prUrl,
      injected_hash: params.injectedHash,
      status:        'pending_pr',
    })
    .select()
    .single()

  if (error) {
    // MF6: Postgres unique_violation on the partial pending_pr index. PostgREST
    // surfaces this as { code: '23505' } in the error payload.
    if ((error as { code?: string }).code === '23505') {
      throw new ConcurrentDeploymentError()
    }
    throw new Error(`geo_deployments insert failed: ${error.message}`)
  }
  return data as GeoDeploymentRow
}

/**
 * Find the most recent still-open (pending_pr) deployment for a given
 * (client, directive, target_path). Used by publish to decide:
 *   - present  →  close the stale PR + supersede this row before opening a new one
 *   - absent   →  fresh first injection, proceed normally
 */
export async function findOpenDeployment(
  clientId:    string,
  directiveId: string,
  targetPath:  string,
): Promise<GeoDeploymentRow | null> {
  const { data, error } = await supabaseAdmin
    .from('geo_deployments')
    .select('*')
    .eq('client_id',    clientId)
    .eq('directive_id', directiveId)
    .eq('target_path',  targetPath)
    .eq('status',       'pending_pr')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`geo_deployments lookup failed: ${error.message}`)
  return (data as GeoDeploymentRow | null) ?? null
}

/**
 * Find the last live (merged or pending_pr) deployment for a (client,
 * directive, target_path). Used by drift detection to know what ME-GEO
 * block content we last wrote — so the next publish can compare against
 * what's currently on disk and flag external edits.
 *
 * Prefers pending_pr (current open PR) over merged (live in production)
 * since the PR's content is what will actually update the file on next merge.
 */
export async function findLatestLiveDeployment(
  clientId:    string,
  directiveId: string,
  targetPath:  string,
): Promise<GeoDeploymentRow | null> {
  const { data, error } = await supabaseAdmin
    .from('geo_deployments')
    .select('*')
    .eq('client_id',   clientId)
    .eq('directive_id', directiveId)
    .eq('target_path', targetPath)
    .in('status', ['pending_pr', 'merged'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`geo_deployments lookup failed: ${error.message}`)
  return (data as GeoDeploymentRow | null) ?? null
}

/**
 * Mark a row as superseded. Called when a newer publish for the same
 * (client, directive, target_path) takes its place.
 */
export async function markSuperseded(rowId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('geo_deployments')
    .update({ status: 'superseded' })
    .eq('id', rowId)

  if (error) throw new Error(`geo_deployments supersede failed: ${error.message}`)
}

/**
 * Mark all pending_pr rows for a given PR as merged.
 *
 * Called by the GitHub webhook (B3) when a GEO PR is merged. A single PR
 * can cover multiple targets (multi-file injection), so we update every
 * row that shares the pr_number + pr_url pair.
 *
 * Returns the number of rows updated. A return value of 0 means the PR
 * was not ME-tracked (e.g. the caller merged a non-GEO PR) — the route
 * silently ignores this.
 */
export async function markMergedByPr(prNumber: number, prUrl: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('geo_deployments')
    .update({ status: 'merged' })
    .eq('pr_number', prNumber)
    .eq('pr_url',    prUrl)
    .eq('status',    'pending_pr')
    .select('id')

  if (error) throw new Error(`geo_deployments merge update failed: ${error.message}`)
  return (data ?? []).length
}
