import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  try {
    const clientId = params.id
    const { searchParams } = new URL(request.url)
    const months = searchParams.get('months') || '3' // Default to last 3 months

    if (!clientId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Client ID is required',
        },
        { status: 400 }
      )
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || '',
      { auth: { persistSession: false } }
    )

    // Calculate date range
    const numMonths = parseInt(months)
    const endDate = new Date()
    const startDate = new Date()
    startDate.setMonth(startDate.getMonth() - numMonths)

    // Fetch reports for the period
    const { data: reports, error } = await supabase
      .from('datasource_monthly_reports')
      .select('month, ai_avg_ranking, serp_top10_keywords, backlinks_total, market_opportunity_score, overall_health_score')
      .eq('client_id', clientId)
      .gte('month', startDate.toISOString().slice(0, 7))
      .lte('month', endDate.toISOString().slice(0, 7))
      .order('month', { ascending: true })

    if (error) {
      throw new Error(`Failed to fetch trends: ${error.message}`)
    }

    // Format trend data
    const trendData = (reports || []).map((report: any) => ({
      month: report.month,
      aiTrackerRanking: report.ai_avg_ranking,
      serpTop10: report.serp_top10_keywords,
      backlinks: report.backlinks_total,
      marketOpportunity: report.market_opportunity_score,
      healthScore: report.overall_health_score,
    }))

    // Calculate trend indicators (up/down/stable)
    const calculateTrend = (values: (number | null)[]): 'up' | 'down' | 'stable' => {
      const valid = values.filter((v) => v !== null && v !== undefined)
      if (valid.length < 2) return 'stable'

      const first = valid[0]
      const last = valid[valid.length - 1]
      const delta = (last as number) - (first as number)

      if (delta > 5) return 'up'
      if (delta < -5) return 'down'
      return 'stable'
    }

    const healthScores = trendData.map((t: any) => t.healthScore)
    const aiRankings = trendData.map((t: any) => t.aiTrackerRanking)
    const serpKeywords = trendData.map((t: any) => t.serpTop10)

    return NextResponse.json({
      success: true,
      clientId,
      period: {
        startMonth: startDate.toISOString().slice(0, 7),
        endMonth: endDate.toISOString().slice(0, 7),
      },
      trends: trendData,
      summary: {
        healthTrend: calculateTrend(healthScores),
        aiRankingTrend: calculateTrend(aiRankings),
        serpKeywordTrend: calculateTrend(serpKeywords),
        latestHealthScore: healthScores[healthScores.length - 1] || null,
      },
    })
  } catch (error) {
    console.error('Trend data fetch error:', error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
