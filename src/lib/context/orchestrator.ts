/**
 * Phase B — Growth Capability Orchestrator
 *
 * Executes an ordered list of capability keys against a ClientContext.
 * Handles dependency resolution, sequential vs parallel execution,
 * and progressive result accumulation in RuntimeOutputs.
 *
 * Usage:
 *   const ctx = await loadClientContext(supabase, clientId)
 *   const outputs = await runOrchestration(
 *     supabase, ctx,
 *     ['collect', 'diagnose', 'plan'],
 *     { onProgress }
 *   )
 *
 * Reference: ROADMAP.md Phase B
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { GROWTH_CAPABILITY_REGISTRY, type CapabilityRunOptions } from './registry'
import type { ClientContext, RuntimeOutputs, GrowthCapabilityKey } from './types'

// ─── Public API ──────────────────────────────────────────────────────────────

export interface OrchestrationOptions extends CapabilityRunOptions {
  /**
   * Capabilities that may run in parallel (must share no needs_runtime deps).
   * Defaults to sequential execution for all capabilities.
   */
  parallel?: GrowthCapabilityKey[]
}

export interface OrchestrationResult {
  outputs: RuntimeOutputs
  /** Capabilities that completed successfully */
  completed: GrowthCapabilityKey[]
  /** Capabilities that failed with their error messages */
  failed: Array<{ key: GrowthCapabilityKey; error: string }>
}

/**
 * Run a list of growth capabilities in dependency order.
 *
 * Sequential by default. Pass `options.parallel` to allow concurrent
 * execution of specific capability pairs when they share no runtime deps.
 *
 * A failed capability causes all downstream dependents to be skipped.
 */
export async function runOrchestration(
  supabase: SupabaseClient,
  ctx: ClientContext,
  capabilities: GrowthCapabilityKey[],
  options: OrchestrationOptions = {},
): Promise<OrchestrationResult> {
  const runtime: RuntimeOutputs = {}
  const completed: GrowthCapabilityKey[] = []
  const failed: Array<{ key: GrowthCapabilityKey; error: string }> = []
  const skipped = new Set<GrowthCapabilityKey>()

  // Resolve execution order respecting needs_runtime dependencies
  const ordered = resolveDependencyOrder(capabilities)

  // Group into parallel batches where possible
  const batches = groupIntoBatches(ordered, options.parallel ?? [])

  for (const batch of batches) {
    if (batch.length === 1) {
      // Sequential — simple path
      const key = batch[0]
      await runOne(key, supabase, ctx, runtime, completed, failed, skipped, options)
    } else {
      // Parallel batch — run concurrently, collect results
      await Promise.all(
        batch.map(key => runOne(key, supabase, ctx, runtime, completed, failed, skipped, options)),
      )
    }
  }

  return { outputs: runtime, completed, failed }
}

// ─── Private helpers ─────────────────────────────────────────────────────────

async function runOne(
  key: GrowthCapabilityKey,
  supabase: SupabaseClient,
  ctx: ClientContext,
  runtime: RuntimeOutputs,
  completed: GrowthCapabilityKey[],
  failed: Array<{ key: GrowthCapabilityKey; error: string }>,
  skipped: Set<GrowthCapabilityKey>,
  options: OrchestrationOptions,
): Promise<void> {
  if (skipped.has(key)) return

  const def = GROWTH_CAPABILITY_REGISTRY[key]
  if (!def) {
    failed.push({ key, error: `Unknown capability: ${key}` })
    return
  }

  // Check all runtime deps are satisfied
  for (const dep of def.needs_runtime) {
    if (runtime[dep] === undefined) {
      const reason = `Dependency '${dep}' not available (upstream step may have failed)`
      failed.push({ key, error: reason })
      skipped.add(key)
      return
    }
  }

  try {
    await options.onProgress?.(`[${def.label}] 开始…`)
    const output = await def.run(ctx, supabase, runtime, options)
    // Write output to shared runtime store
    ;(runtime as Record<string, unknown>)[def.output_key] = output
    completed.push(key)
    await options.onProgress?.(`[${def.label}] 完成`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    failed.push({ key, error: message })
    // Mark downstream capabilities as skipped
    markDownstreamSkipped(key, completed.concat([key]), skipped)
  }
}

/**
 * Topological sort of capabilities by needs_runtime dependencies.
 * Capabilities with no deps come first.
 */
function resolveDependencyOrder(capabilities: GrowthCapabilityKey[]): GrowthCapabilityKey[] {
  // Simple stable sort: capabilities with fewer runtime deps go first
  return [...capabilities].sort((a, b) => {
    const depsA = GROWTH_CAPABILITY_REGISTRY[a]?.needs_runtime.length ?? 0
    const depsB = GROWTH_CAPABILITY_REGISTRY[b]?.needs_runtime.length ?? 0
    return depsA - depsB
  })
}

/**
 * Group capabilities into parallel batches.
 * Two capabilities can be parallel only if neither depends on the other's output.
 */
function groupIntoBatches(
  ordered: GrowthCapabilityKey[],
  allowParallel: GrowthCapabilityKey[],
): GrowthCapabilityKey[][] {
  if (allowParallel.length === 0) {
    return ordered.map(k => [k])
  }

  const parallelSet = new Set(allowParallel)
  const batches: GrowthCapabilityKey[][] = []
  let currentBatch: GrowthCapabilityKey[] = []

  for (const key of ordered) {
    if (parallelSet.has(key) && currentBatch.every(k => parallelSet.has(k))) {
      currentBatch.push(key)
    } else {
      if (currentBatch.length > 0) batches.push(currentBatch)
      currentBatch = [key]
    }
  }
  if (currentBatch.length > 0) batches.push(currentBatch)

  return batches
}

/**
 * Mark capabilities that depend on a failed step as skipped.
 */
function markDownstreamSkipped(
  failedKey: string,
  _completed: GrowthCapabilityKey[],
  skipped: Set<GrowthCapabilityKey>,
): void {
  // Find all capabilities whose output_key the failed step would produce,
  // then mark anything that needs that output as skipped.
  const failedDef = GROWTH_CAPABILITY_REGISTRY[failedKey]
  if (!failedDef) return

  const failedOutputKey = failedDef.output_key
  for (const [key, def] of Object.entries(GROWTH_CAPABILITY_REGISTRY)) {
    if (def.needs_runtime.includes(failedOutputKey as keyof RuntimeOutputs)) {
      skipped.add(key as GrowthCapabilityKey)
    }
  }
}
