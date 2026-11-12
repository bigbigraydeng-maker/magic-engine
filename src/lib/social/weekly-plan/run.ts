/**
 * Build this target week and store it. Does not publish and does not schedule itself.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { targetWeek } from '@/lib/social/week-pack/cadence'

import { buildWeeklySocialPlan } from './build'
import { loadPlanInput, saveWeeklyPlan } from './db'

export async function buildAndSaveWeeklyPlan(db: SupabaseClient, clientId: string, now: Date) {
  const week = targetWeek(now)
  const loaded = await loadPlanInput(db, clientId, week, now)
  const plan = buildWeeklySocialPlan(loaded.input)
  return saveWeeklyPlan(db, clientId, { ...plan, gaps: [...loaded.gaps, ...plan.gaps] })
}
