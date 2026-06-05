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
    const month = searchParams.get('month')

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

    // Get current month report
    const currentMonth = month || new Date().toISOString().slice(0, 7)

    const { data: report, error } = await supabase
      .from('datasource_monthly_reports')
      .select('*')
      .eq('client_id', clientId)
      .eq('month', currentMonth)
      .single()

    if (error || !report) {
      return NextResponse.json(
        {
          success: false,
          clientId,
          month: currentMonth,
          error: 'Report not found or not yet generated',
        },
        { status: 404 }
      )
    }

    // Build summary with key metrics
    const summary = {
      success: true,
      clientId,
      month: report.month,
      health_score: report.overall_health_score,
      health_trend: report.health_trend,
      last_synced_at: report.last_synced_at,

      key_metrics: [
        {
          label: 'AI Visibility Ranking',
          value: report.ai_avg_ranking?.toFixed(1) || 'N/A',
          change: report.ai_ranking_change?.toFixed(1) || '0',
          status: getMetricStatus('ai_ranking', report.ai_avg_ranking),
        },
        {
          label: 'SERP Top 10 Keywords',
          value: report.serp_top10_keywords || '0',
          change: (report.serp_new_rankings - report.serp_lost_rankings).toString(),
          status: getMetricStatus('serp_top10', report.serp_top10_keywords),
        },
        {
          label: 'Backlinks',
          value: report.backlinks_total || '0',
          change: report.backlinks_new_this_month?.toString() || '0',
          status: getMetricStatus('backlinks', report.backlinks_total),
        },
        {
          label: 'Market Opportunities',
          value: report.market_top_opportunities || '0',
          change: '0',
          status: getMetricStatus('market_opportunities', report.market_top_opportunities),
        },
        {
          label: 'Monthly Cost',
          value: `$${(report.billing_total_cost || 0).toFixed(2)}`,
          change: '0',
          status: getMetricStatus('billing_cost', report.billing_total_cost),
        },
      ],

      highlights: generateHighlights(report),
      concerns: generateConcerns(report),
    }

    return NextResponse.json(summary)
  } catch (error) {
    console.error('Summary fetch error:', error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

function getMetricStatus(metric: string, value: number | null | undefined): 'up' | 'down' | 'neutral' {
  if (value === null || value === undefined) return 'neutral'

  switch (metric) {
    case 'ai_ranking':
      return value < 10 ? 'up' : value < 50 ? 'neutral' : 'down'
    case 'serp_top10':
      return value > 0 ? 'up' : 'neutral'
    case 'backlinks':
      return value > 100 ? 'up' : value > 50 ? 'neutral' : 'down'
    case 'market_opportunities':
      return value > 10 ? 'up' : value > 5 ? 'neutral' : 'down'
    case 'billing_cost':
      return value < 500 ? 'down' : value < 1000 ? 'neutral' : 'up'
    default:
      return 'neutral'
  }
}

function generateHighlights(report: any): string[] {
  const highlights: string[] = []

  if (report.overall_health_score >= 75) {
    highlights.push(`Excellent health score: ${report.overall_health_score}/100`)
  }

  if (report.serp_top10_keywords && report.serp_top10_keywords > 10) {
    highlights.push(`${report.serp_top10_keywords} keywords in top 10 search results`)
  }

  if (report.backlinks_new_this_month && report.backlinks_new_this_month > 5) {
    highlights.push(`Strong backlink growth: +${report.backlinks_new_this_month} links this month`)
  }

  if (report.ai_avg_ranking && report.ai_avg_ranking < 5) {
    highlights.push(`High AI visibility: Ranking #${Math.round(report.ai_avg_ranking)} on average`)
  }

  if (report.market_top_opportunities && report.market_top_opportunities > report.market_underperformers) {
    highlights.push('Market position advantage with more opportunities than challenges')
  }

  return highlights.slice(0, 5)
}

function generateConcerns(report: any): string[] {
  const concerns: string[] = []

  if (report.overall_health_score < 50) {
    concerns.push('Health score below 50 - review all data sources')
  }

  if (report.health_trend === 'declining') {
    concerns.push('Overall health trend is declining - investigate root causes')
  }

  if (report.ai_ranking_change && report.ai_ranking_change > 2) {
    concerns.push('AI visibility rankings declining - update content strategy')
  }

  if (report.serp_lost_rankings > report.serp_new_rankings) {
    concerns.push(`Losing more keywords than gaining (${report.serp_lost_rankings} vs ${report.serp_new_rankings})`)
  }

  if (report.backlinks_lost_this_month > report.backlinks_new_this_month) {
    concerns.push(`Backlink loss outpacing gains: -${report.backlinks_lost_this_month} vs +${report.backlinks_new_this_month}`)
  }

  if (report.market_underperformers > report.market_top_opportunities) {
    concerns.push('More market underperformers than opportunities - reassess strategy')
  }

  return concerns.slice(0, 5)
}
