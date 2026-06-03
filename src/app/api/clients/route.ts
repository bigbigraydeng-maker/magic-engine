import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('id, name, domain, created_at, semrush_db, plan_tier')
      .order('created_at', { ascending: false })

    if (error) throw error
    const clients = data ?? []

    // B8: enrich with active Goal summary so list cards can show Goal title
    // Single batched query — avoids N+1 (19 clients × 1 query = 19 queries).
    const clientIds = clients.map(c => c.id)
    if (clientIds.length === 0) return NextResponse.json({ clients })

    const { data: activeGoals } = await supabaseAdmin
      .from('goals')
      .select('client_id, title, intent, primary_metric_label, baseline_value, target_value, period_end')
      .in('client_id', clientIds)
      .eq('status', 'active')
      .order('created_at', { ascending: false })

    // Group by client_id — first goal wins (most recent active)
    const goalsByClient = new Map<string, {
      title: string
      intent: string
      primary_metric_label: string
      baseline_value: number
      target_value: number
      period_end: string
      count: number
    }>()

    for (const g of (activeGoals ?? [])) {
      const existing = goalsByClient.get(g.client_id as string)
      if (existing) {
        existing.count += 1
      } else {
        goalsByClient.set(g.client_id as string, {
          title: g.title as string,
          intent: g.intent as string,
          primary_metric_label: g.primary_metric_label as string,
          baseline_value: Number(g.baseline_value),
          target_value: Number(g.target_value),
          period_end: g.period_end as string,
          count: 1,
        })
      }
    }

    const enriched = clients.map(c => {
      const g = goalsByClient.get(c.id)
      return {
        ...c,
        active_goal: g ? {
          title: g.title,
          intent: g.intent,
          primary_metric_label: g.primary_metric_label,
          baseline_value: g.baseline_value,
          target_value: g.target_value,
          period_end: g.period_end,
        } : null,
        active_goals_count: g?.count ?? 0,
      }
    })

    return NextResponse.json({ clients: enriched })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, domain, website_url } = body

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('clients')
      .insert({
        name,
        domain: domain || website_url || null,
        semrush_db: 'au',
        monthly_quota: 1000,
        plan_tier: 'starter',
      })
      .select('id, name')
      .single()

    if (error) throw error
    return NextResponse.json({ client: data }, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err)
    console.error('[POST /api/clients]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
