/**
 * Strategy signal fetchers (Phase 8.D.1.4 helper)
 *
 * Reads the three input dimensions from Supabase and reshapes them
 * into the analyzer's input types. Kept separate from orchestrator
 * so the analyzer side can be tested without touching the DB.
 */

import { supabaseAdmin } from '@/lib/supabase'
import type {
  WeakQuery,
  KeywordOpportunity,
} from './analyzer'

const WEAK_LOOKBACK = 8           // last N runs per query
const WEAK_THRESHOLD_RANK = 3     // rank > 3 (or null) counts as weak
const KEYWORD_LIMIT = 200

interface QueryRow {
  id: string
  question: string
  topics?: string[] | null
}

interface RunRow {
  query_id: string
  client_brand_rank: number | null
  ran_at: string
}

interface KeywordRow {
  keyword: string
  volume: number | null
  kd: number | null
  intent: string | null
  topics?: string[] | null
}

function topicsFromQuestion(q: string): string[] {
  const stop = new Set([
    'the','a','an','and','or','but','in','on','at','to','for','of','with',
    'is','are','was','were','be','been','how','what','why','when','who',
    'do','does','did','will','would','can','could','should','best','top',
    'your','my','our','their','its','this','that','these','those','from',
    'by','about','which','get','have','has','had','not','no','yes',
  ])
  return Array.from(
    new Set(
      q
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !stop.has(w))
    )
  ).slice(0, 6)
}

export async function fetchWeakQueries(clientId: string): Promise<WeakQuery[]> {
  const { data: queries } = await supabaseAdmin
    .from('ai_visibility_queries')
    .select('id, question')
    .eq('client_id', clientId)
    .eq('enabled', true)

  if (!queries || queries.length === 0) return []

  const ids = (queries as QueryRow[]).map((q) => q.id)

  const { data: runs } = await supabaseAdmin
    .from('ai_visibility_runs')
    .select('query_id, client_brand_rank, ran_at')
    .eq('client_id', clientId)
    .in('query_id', ids)
    .order('ran_at', { ascending: false })
    .limit(ids.length * WEAK_LOOKBACK)

  const runsByQuery = new Map<string, RunRow[]>()
  for (const r of (runs || []) as RunRow[]) {
    const arr = runsByQuery.get(r.query_id) ?? []
    if (arr.length < WEAK_LOOKBACK) arr.push(r)
    runsByQuery.set(r.query_id, arr)
  }

  const out: WeakQuery[] = []
  for (const q of queries as QueryRow[]) {
    const r = runsByQuery.get(q.id) ?? []
    if (r.length === 0) {
      out.push({
        query_id: q.id,
        question: q.question,
        weakness_score: 1, // never measured ⇒ assume weak until proven otherwise
        best_engine_rank: null,
        topics: q.topics ?? topicsFromQuestion(q.question),
      })
      continue
    }
    const weakRuns = r.filter(
      (run) => run.client_brand_rank == null || run.client_brand_rank > WEAK_THRESHOLD_RANK
    ).length
    const score = weakRuns / r.length
    if (score < 0.5) continue // skip strong queries
    const ranks = r
      .map((x) => x.client_brand_rank)
      .filter((x): x is number => typeof x === 'number')
    out.push({
      query_id: q.id,
      question: q.question,
      weakness_score: score,
      best_engine_rank: ranks.length > 0 ? Math.min(...ranks) : null,
      topics: q.topics ?? topicsFromQuestion(q.question),
    })
  }

  return out.sort((a, b) => b.weakness_score - a.weakness_score)
}

export async function fetchKeywordOpportunities(
  clientId: string
): Promise<KeywordOpportunity[]> {
  const { data } = await supabaseAdmin
    .from('keywords')
    .select('keyword, volume, kd, intent')
    .eq('client_id', clientId)
    .order('opportunity_score', { ascending: false, nullsFirst: false })
    .limit(KEYWORD_LIMIT)

  return ((data || []) as KeywordRow[]).map((k) => ({
    keyword: k.keyword,
    volume: k.volume,
    kd: k.kd,
    intent: k.intent ?? undefined,
    topics: k.topics ?? topicsFromQuestion(k.keyword),
  }))
}
