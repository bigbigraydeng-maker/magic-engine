import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { readView } from '@/lib/web-intelligence/service'
import { chatAboutTourLandscape, type TourLandscape } from '@/lib/web-intelligence/tour-landscape'
import { loadMemoryForClient } from '@/lib/memory/service'
import { formatMemoryForPrompt } from '@/lib/memory/format'

type Context = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Context) {
  const { id } = await params
  const access = await requirePaidClientAccess(id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  let body: { question?: unknown; history?: unknown; landscape?: unknown }
  try { body = await req.json() as typeof body } catch { return NextResponse.json({ error: '请输入问题。' }, { status: 400 }) }
  const question = typeof body.question === 'string' ? body.question.trim() : ''
  if (!question) return NextResponse.json({ error: '请输入问题。' }, { status: 400 })
  const history = Array.isArray(body.history)
    ? body.history.filter((item): item is { role: 'user' | 'assistant'; content: string } => {
      const value = item as { role?: unknown; content?: unknown }
      return (value.role === 'user' || value.role === 'assistant') && typeof value.content === 'string'
    }).slice(-10)
    : []
  try {
    const [view, memory] = await Promise.all([readView(id, access.role === 'admin'), loadMemoryForClient(supabaseAdmin, id, { maxRecentDecisions: 5, minConfidence: 0.7 })])
    const clientProducts = view.operating.client_products.map(product => ({ name: product.name, destination: product.destination, route: product.route, duration_days: product.duration_days, price: product.price, departure_window: product.departure_window, includes: product.includes, positioning: product.positioning }))
    const competitorProducts = view.operating.tour_catalog.map(item => ({ domain: item.domain, source_url: item.source_url, observed_at: item.observed_at, name: item.record.name, route: item.record.route, duration_days: item.record.durationDays, price: item.record.price, departure_window: item.record.departureWindow, includes: item.record.includes, positioning: item.record.positioning }))
    const externalSignals = (view.external_signals ?? []).filter(signal => signal.source_type === 'industry_news' || signal.source_type === 'industry_media').slice(0, 12).map(signal => ({ source_type: signal.source_type, source_name: signal.source_name, source_url: signal.source_url, title: signal.title, excerpt: signal.excerpt, observed_at: signal.observed_at }))
    const trafficSignals = (view.traffic_direction ?? []).filter(signal => !signal.is_client).slice(0, 12).map(signal => ({ domain: signal.domain, observed_at: signal.observed_at, estimated_visits: signal.estimated_visits, previous_estimated_visits: signal.previous_estimated_visits, visits_change_pct: signal.visits_change_pct, excerpt: signal.excerpt }))
    const result = await chatAboutTourLandscape({ client_name: view.operating.client_name, market_scope: view.brief.product_scope.market_ids, client_products: clientProducts, competitor_products: competitorProducts, external_signals: externalSignals, traffic_signals: trafficSignals, memory_context: formatMemoryForPrompt(memory, { heading: '已确认的客户监控记忆', includeGlobalLessons: false }), landscape: body.landscape && typeof body.landscape === 'object' ? body.landscape as TourLandscape : null, history, question })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[wi-tour-landscape-chat]', { client_id: id, error: error instanceof Error ? error.message : 'unknown_error' })
    return NextResponse.json({ error: '对话分析暂时不可用，请稍后重试。' }, { status: 502 })
  }
}
