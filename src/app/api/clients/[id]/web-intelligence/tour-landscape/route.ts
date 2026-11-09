import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { readView } from '@/lib/web-intelligence/service'
import { summarizeTourLandscape } from '@/lib/web-intelligence/tour-landscape'
import { loadMemoryForClient } from '@/lib/memory/service'
import { formatMemoryForPrompt } from '@/lib/memory/format'

type Context = { params: Promise<{ id: string }> }

export async function POST(_req: Request, { params }: Context) {
  const { id } = await params
  const access = await requirePaidClientAccess(id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  let stage: 'read_view' | 'prepare_prompt' | 'llm' | 'validate' = 'read_view'
  try {
    const [view, memory] = await Promise.all([readView(id, access.role === 'admin'), loadMemoryForClient(supabaseAdmin, id, { maxRecentDecisions: 5, minConfidence: 0.7 })])
    stage = 'prepare_prompt'
    const clientProducts = view.operating.client_products.map(product => ({ name: product.name, destination: product.destination, route: product.route, duration_days: product.duration_days, price: product.price, departure_window: product.departure_window, includes: product.includes, positioning: product.positioning }))
    const competitorProducts = view.operating.tour_catalog.map(item => ({ domain: item.domain, source_url: item.source_url, observed_at: item.observed_at, name: item.record.name, route: item.record.route, duration_days: item.record.durationDays, price: item.record.price, departure_window: item.record.departureWindow, includes: item.record.includes, positioning: item.record.positioning }))
    const externalSignals = (view.external_signals ?? []).filter(signal => signal.source_type === 'industry_news' || signal.source_type === 'industry_media').slice(0, 12).map(signal => ({ source_type: signal.source_type, source_name: signal.source_name, source_url: signal.source_url, title: signal.title, excerpt: signal.excerpt, observed_at: signal.observed_at }))
    const trafficSignals = (view.traffic_direction ?? []).filter(signal => !signal.is_client).slice(0, 12).map(signal => ({ domain: signal.domain, observed_at: signal.observed_at, estimated_visits: signal.estimated_visits, previous_estimated_visits: signal.previous_estimated_visits, visits_change_pct: signal.visits_change_pct, excerpt: signal.excerpt }))
    stage = 'llm'
    const result = await summarizeTourLandscape({ client_name: view.operating.client_name, market_scope: view.brief.product_scope.market_ids, client_products: clientProducts, competitor_products: competitorProducts, external_signals: externalSignals, traffic_signals: trafficSignals, memory_context: formatMemoryForPrompt(memory, { heading: '已确认的客户监控记忆', includeGlobalLessons: false }) })
    stage = 'validate'
    return NextResponse.json(result)
  } catch (error) {
    // Keep the response human-readable without exposing provider errors or
    // credentials; the stage is enough to diagnose the production failure.
    console.error('[wi-tour-landscape]', { client_id: id, stage, error: error instanceof Error ? error.message : 'unknown_error' })
    const message = stage === 'read_view'
      ? '客户和竞品资料暂时无法读取，请稍后重试。'
      : stage === 'llm'
        ? '竞品总览分析服务暂时不可用，请稍后重试。'
        : '竞品总览暂时无法完成，请稍后重试。'
    return NextResponse.json({ error: message, code: `tour_landscape_${stage}` }, { status: 502 })
  }
}
