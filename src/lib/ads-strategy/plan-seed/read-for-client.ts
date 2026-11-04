/**
 * Shared plan-seed read. The session route and the ads-agent route both call
 * this so the suggestion cannot drift between the two doors.
 * Read-only: it does not insert or update.
 */

import { storedEffectCard } from '@/lib/ads-strategy/effect-judgment/card'
import { supabaseAdmin } from '@/lib/supabase'
import type { PrescriptionContent } from '@/types/diagnostic'
import { collectAdPlays } from '@/lib/ads-strategy/plan-seed/attach'
import { buildPlanSeed } from '@/lib/ads-strategy/plan-seed/build'
import { loadGoalPeriod, productionDeps } from '@/lib/ads-strategy/plan-seed/deps'
import type { AdPlay } from '@/lib/ads-strategy/plan-seed/ad-plays'
import type { PlanSeed } from '@/lib/ads-strategy/plan-seed/types'

const NO_PLAYS = '这份处方没有填广告打法（ad_plays）'

export interface PlanSeedBody {
  success: boolean
  error?: string
  reason?: string
  seed?: PlanSeed | null
  computed_at?: string
}

export interface PlanSeedRead {
  status: number
  body: PlanSeedBody
}

interface PrescriptionRow {
  id: string
  client_id: string
  goal_id: string | null
  content: PrescriptionContent | null
  generation_meta: unknown
}

type Loaded =
  | { kind: 'error' }
  | { kind: 'missing' }
  | { kind: 'empty' }
  | { kind: 'ready'; plays: AdPlay[]; goalId: string | null; generationMeta: unknown }

export async function readPlanSeedForClient(clientId: string, prescriptionId: string): Promise<PlanSeedRead> {
  const loaded = await loadPrescription(clientId, prescriptionId)
  if (loaded.kind === 'error') return { status: 500, body: { success: false, error: '读取处方失败' } }
  if (loaded.kind === 'missing') return { status: 404, body: { success: false, error: '处方不存在' } }
  if (loaded.kind === 'empty') return { status: 200, body: { success: true, seed: null, reason: NO_PLAYS } }
  return computeSeed(clientId, loaded.plays, loaded.goalId, loaded.generationMeta)
}

async function loadPrescription(clientId: string, prescriptionId: string): Promise<Loaded> {
  const { data, error } = await supabaseAdmin
    .from('prescriptions')
    .select('id, client_id, goal_id, content, generation_meta')
    .eq('id', prescriptionId)
    .eq('client_id', clientId)
    .maybeSingle<PrescriptionRow>()
  if (error) return { kind: 'error' }
  if (!data) return { kind: 'missing' }
  if (data.content === null) return { kind: 'empty' }
  const plays = collectAdPlays(data.content)
  if (plays.length === 0) return { kind: 'empty' }
  return { kind: 'ready', plays, goalId: data.goal_id, generationMeta: data.generation_meta }
}

async function computeSeed(
  clientId: string,
  plays: AdPlay[],
  goalId: string | null,
  generationMeta: unknown,
): Promise<PlanSeedRead> {
  try {
    const period = await loadGoalPeriod(goalId)
    const seed = await buildPlanSeed({
      clientId,
      plays,
      period,
      effectCard: storedEffectCard(generationMeta),
    }, productionDeps())
    return { status: 200, body: { success: true, seed, computed_at: new Date().toISOString() } }
  } catch (err) {
    console.error('[plan-seed] compute failed', err instanceof Error ? err.message : '未知错误')
    return { status: 500, body: { success: false, error: '算不出计划草稿建议，请稍后再试' } }
  }
}
