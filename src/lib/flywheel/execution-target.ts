/**
 * Derive ExecutionTarget from a華陀 PrescriptionAction.
 *
 * P12.A.11: Every freshly-generated prescription action should natively carry
 * an execution_target so the execution board can route it via the right adapter
 * without falling back to the dimension-only backfill mapping.
 *
 * Mapping rules — keep in sync with the backfill SQL in
 * supabase/migrations/20260517000001_flywheel_data_skeleton.sql §5:
 *
 *   dimension  → flywheel        (reputation→geo, competitor→seo)
 *   fix_type   → mode + vendor   (fde_manual→external_manual + vendor='fde',
 *                                 third_party→third_party,
 *                                 me_auto→in_house)
 *
 * action_type hints are only populated where Phase 12.A vocabulary exists
 * (GEO in_house). Other flywheels stay undefined until Phase 12.B fills the
 * vocabulary stubs.
 */

import type { DiagnosticDimension, FixType } from '@/types/diagnostic'
import type {
  ExecutionTarget,
  FlywheelName,
  ExecutionMode,
} from './adapters/types'
import { GEO_ACTION_TYPE } from './vocabulary'

function dimensionToFlywheel(dim: DiagnosticDimension): FlywheelName {
  if (dim === 'seo')           return 'seo'
  if (dim === 'ai_visibility') return 'geo'
  if (dim === 'ads')           return 'ads'
  if (dim === 'social')        return 'social'
  if (dim === 'reputation')    return 'geo'
  return 'seo' // competitor
}

function fixTypeToMode(fix: FixType): ExecutionMode {
  if (fix === 'me_auto')    return 'in_house'
  if (fix === 'third_party') return 'third_party'
  return 'external_manual' // fde_manual
}

/**
 * Pick a sensible default action_type hint based on flywheel + mode.
 * Phase 12.A only ships GEO vocabulary; other flywheels return undefined.
 */
function defaultActionType(
  flywheel: FlywheelName,
  mode: ExecutionMode,
): string | undefined {
  if (flywheel === 'geo') {
    if (mode === 'in_house')        return GEO_ACTION_TYPE.COMPOSE_DIRECTIVE
    if (mode === 'external_manual') return GEO_ACTION_TYPE.BUILD_CITATIONS
    if (mode === 'third_party')     return GEO_ACTION_TYPE.SUBMIT_ENTITY
  }
  return undefined
}

export function deriveExecutionTarget(
  dimension: DiagnosticDimension,
  fix_type: FixType,
): ExecutionTarget {
  const flywheel = dimensionToFlywheel(dimension)
  const mode = fixTypeToMode(fix_type)

  const target: ExecutionTarget = { flywheel, mode }

  if (mode === 'external_manual') {
    target.vendor = 'fde'
  }

  const action_type = defaultActionType(flywheel, mode)
  if (action_type) target.action_type = action_type

  return target
}
