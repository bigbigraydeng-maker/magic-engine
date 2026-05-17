/**
 * Flywheel adapter registry — singleton map from FlywheelName → FlywheelAdapter.
 *
 * P12.A.3: Adapters register themselves at module-init time (or in a bootstrap
 * file) so the rest of the codebase can look them up by flywheel name without
 * importing concrete implementations directly.
 *
 * Usage:
 *   import { registerAdapter, getAdapter } from '@/lib/flywheel/adapters/registry'
 *
 *   // At app init / in the concrete adapter module:
 *   registerAdapter(new GeoComposerAdapter())
 *
 *   // In API routes / FlywheelDrawer:
 *   const adapter = getAdapter('geo')
 *   const action  = await adapter.execute(input)
 */

import type { FlywheelAdapter, FlywheelName } from './types'

const registry = new Map<FlywheelName, FlywheelAdapter>()

/**
 * Register an adapter for its flywheel.
 * Calling this twice for the same flywheel overwrites the previous registration
 * (intentional — allows hot-swapping in tests).
 */
export function registerAdapter(adapter: FlywheelAdapter): void {
  registry.set(adapter.flywheel, adapter)
}

/**
 * Look up the adapter for a flywheel.
 * Throws if no adapter has been registered, so callers get an explicit error
 * rather than a silent no-op.
 */
export function getAdapter(flywheel: FlywheelName): FlywheelAdapter {
  const adapter = registry.get(flywheel)
  if (!adapter) {
    throw new Error(
      `No FlywheelAdapter registered for flywheel: "${flywheel}". ` +
      `Registered: [${listRegisteredFlywheels().join(', ')}]`
    )
  }
  return adapter
}

/** Return true if an adapter is registered for the given flywheel. */
export function hasAdapter(flywheel: FlywheelName): boolean {
  return registry.has(flywheel)
}

/** Return the list of flywheels that currently have a registered adapter. */
export function listRegisteredFlywheels(): FlywheelName[] {
  return Array.from(registry.keys())
}

/**
 * Remove all registered adapters.
 * Intended for use in tests only — clears state between test cases.
 */
export function clearRegistry(): void {
  registry.clear()
}
