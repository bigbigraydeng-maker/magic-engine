/**
 * Build this target week and store it. Does not publish and does not schedule itself.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { targetWeek } from '@/lib/social/week-pack/cadence'

import { buildWeeklySocialPlan } from './build'
import { loadPlanInput, saveWeeklyPlan } from './db'
import { applyProducedDrafts, type ProducedDrafts } from './produced'

export async function buildAndSaveWeeklyPlan(
  db: SupabaseClient,
  clientId: string,
  now: Date,
  produced: ProducedDrafts | null = null,
) {
  const week = targetWeek(now)
  const loaded = await loadPlanInput(db, clientId, week, now)
  const built = buildWeeklySocialPlan(loaded.input)
  const plan = produced ? applyProducedDrafts(built, produced) : built
  return saveWeeklyPlan(db, clientId, { ...plan, gaps: [...loaded.gaps, ...plan.gaps] })
}
