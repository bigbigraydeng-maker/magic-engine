/**
 * Count actual adoption candidates per agent. Inactive adopted or retired
 * lessons are not waiting for a first adoption.
 * The agents page only shows the number and a link. Adoption stays on the ad engine page.
 * No credentials → null. The page must keep rendering.
 */

const AGENT_BY_PILLAR: Record<string, string> = {
  ads: 'weiqing',
  seo: 'kongzi',
  social: 'sudongpo',
  reputation: 'simaqian',
  ai_visibility: 'mengzi',
  geo: 'mengzi',
}

export function agentCodeForLesson(pillar: string | null, flywheel: string | null): string | null {
  const key = (pillar || flywheel || '').trim().toLowerCase()
  return AGENT_BY_PILLAR[key] ?? null
}

export function pendingLessonLabel(count: number | null): string {
  return count === null ? '待采纳经验读不到' : `待采纳经验 ${count} 条`
}

export function isPendingLesson(evidence: Record<string, unknown> | null): boolean {
  if (!evidence || evidence.status === 'adopted') return false
  if (evidence.status === 'candidate') return true
  if (evidence.kind === 'candidate' && evidence.candidate === true) return true
  return evidence.kind === 'tune_candidate' || evidence.kind === 'expert_rss_candidate'
}

export async function loadPendingLessonCounts(): Promise<Map<string, number> | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  try {
    const { supabaseAdmin } = await import('@/lib/supabase')
    const { data, error } = await supabaseAdmin
      .from('global_learned_lessons')
      .select('pillar, flywheel, evidence')
      .eq('is_active', false)
    if (error || !data) return null
    return countByAgent(data as Array<{ pillar: string | null; flywheel: string | null; evidence: Record<string, unknown> | null }>)
  } catch {
    return null
  }
}

export function countByAgent(rows: Array<{ pillar: string | null; flywheel: string | null; evidence: Record<string, unknown> | null }>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (!isPendingLesson(row.evidence)) continue
    const code = agentCodeForLesson(row.pillar, row.flywheel)
    if (!code) continue
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return counts
}
