import { NextRequest, NextResponse } from 'next/server'
import { getOpenAIClient } from '@/lib/ai/openai-client'
import { buildMonthlyReport } from '@/lib/reports/monthly-aggregator'

/**
 * POST /api/reports/[clientId]/monthly/recommendations
 *
 * Uses GPT-4o to generate 3–5 actionable next-month recommendations
 * based on the current monthly report data.
 *
 * Body: {} (empty — all context is loaded from the DB)
 *
 * Reference: ROADMAP.md P7.4.6
 */
export const maxDuration = 60

export async function POST(
  _req: NextRequest,
  { params }: { params: { clientId: string } }
) {
  try {
    const { clientId } = params

    // Load report data for context
    const report = await buildMonthlyReport(clientId)

    const weakQueries = report.competitive
      .filter(r => r.client_rank === null || r.client_rank > 3)
      .slice(0, 5)
      .map(r => `"${r.question}" (rank: ${r.client_rank ?? 'not mentioned'})`)
      .join('\n')

    const strongQueries = report.competitive
      .filter(r => r.client_rank !== null && r.client_rank <= 3)
      .slice(0, 3)
      .map(r => `"${r.question}" (rank: ${r.client_rank})`)
      .join('\n')

    const systemPrompt = `You are a strategic AI visibility consultant preparing a monthly report for a client in the AU/NZ market.
Write in a professional, direct tone. Be specific and actionable. Use Australian/New Zealand English spelling.
Do NOT mention the internal tool name, OpenAI, Claude, or any AI vendor names. Use "AI Visibility Tracker" and "AI systems" generically.`

    const userPrompt = `## Client Report — ${report.period_label}
Client: ${report.client_name}

### AI Visibility Performance
- This month avg rank: ${report.overview.this_month_avg_rank ?? 'No data'}
- Last month avg rank: ${report.overview.last_month_avg_rank ?? 'No data'}
- Rank change: ${report.overview.rank_change != null ? (report.overview.rank_change > 0 ? `+${report.overview.rank_change} (worsened)` : `${report.overview.rank_change} (improved)`) : 'N/A'}
- AI mentions this month: ${report.overview.this_month_mentions}
- Queries tracked: ${report.overview.queries_tracked}

### Weak Areas (not in top 3)
${weakQueries || 'None identified yet'}

### Strong Areas (top 3)
${strongQueries || 'None yet'}

### GEO Status
- Active directive version: ${report.geo.active_version ?? 'None deployed'}
- Pages with GEO snippet: ${report.geo.deployed_pages_count}
- Blog posts published this month: ${report.geo.published_blogs_this_month}

---

Write exactly 4 recommendations for next month. Format as a numbered list.
Each recommendation must:
1. Start with an action verb
2. Reference specific data from the report (query name, rank number, etc.)
3. Include a concrete expected outcome
4. Be 2–3 sentences max

Focus on the most impactful AI visibility improvements for the AU/NZ market.`

    // Instantiate inside handler
    const openai = getOpenAIClient()

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens:  800,
    })

    const text     = completion.choices[0]?.message?.content ?? ''
    const cost_usd = ((completion.usage?.prompt_tokens ?? 0) * 0.0000025)
                   + ((completion.usage?.completion_tokens ?? 0) * 0.00001)

    return NextResponse.json({
      success:         true,
      recommendations: text,
      cost_usd:        Math.round(cost_usd * 10_000) / 10_000,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
