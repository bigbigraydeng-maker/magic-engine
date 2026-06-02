import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/baselines/score-history?sub_industry=X&weeks=12
 *
 * For a given sub_industry, returns weekly P50 of all domains' scores
 * over the past N weeks. Used by Admin UI sparkline.
 *
 * Aggregation: collected_at → ISO week → median of all scores in that week.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const subIndustry = searchParams.get('sub_industry')
  const weeks       = Math.min(parseInt(searchParams.get('weeks') ?? '12', 10), 52)

  if (!subIndustry) {
    return NextResponse.json({ error: 'sub_industry is required' }, { status: 400 })
  }

  const sinceDate = new Date()
  sinceDate.setDate(sinceDate.getDate() - weeks * 7)

  const { data, error } = await supabaseAdmin
    .from('baseline_domain_score_history')
    .select('score, collected_at')
    .eq('sub_industry', subIndustry)
    .gte('collected_at', sinceDate.toISOString())
    .order('collected_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Group by ISO week (YYYY-Wxx), compute P50 per week
  const byWeek = new Map<string, number[]>()
  for (const row of (data ?? [])) {
    const d = new Date(row.collected_at)
    // ISO week format: YYYY-Www
    const year = d.getUTCFullYear()
    const week = isoWeekNumber(d)
    const weekKey = `${year}-W${week.toString().padStart(2, '0')}`
    if (!byWeek.has(weekKey)) byWeek.set(weekKey, [])
    byWeek.get(weekKey)!.push(row.score)
  }

  const trend = Array.from(byWeek.entries())
    .map(([week, scores]) => {
      const sorted = [...scores].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      const p50 = sorted.length % 2 === 0
        ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
        : sorted[mid]
      return { week, p50, n: scores.length }
    })
    .sort((a, b) => a.week.localeCompare(b.week))

  return NextResponse.json({ sub_industry: subIndustry, weeks: trend })
}

// ISO 8601 week number — standard algorithm
function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}
