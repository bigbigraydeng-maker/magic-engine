import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getUserPermissions } from '@/lib/auth/whitelist'

/**
 * P0-J fix (魏征 CRITICAL #1): this endpoint previously returned ALL clients
 * to any anonymous caller. It is consumed by /dashboard/content and
 * /dashboard/visuals which are reachable by self_serve users — that's how
 * raydeng@workvisas.work saw 41 strangers' content on first login.
 *
 * Now requires a session, and self_serve / portal_only callers only see their
 * own client rows (via client_portal_users.email lookup). Admin keeps the
 * full list.
 */
export async function GET() {
  try {
    // ── 1. Session gate ───────────────────────────────────────────────────
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const email = user.email.toLowerCase()

    // ── 2. Admin shortcut — return everything ─────────────────────────────
    const adminPerms = getUserPermissions(email)
    // 受限管理员（DEMO_ADMINS）不能走这条捷径 —— 否则客户列表会把
    // 全部真实客户的名字和域名摊给演示账号。收敛成只返回它自己那一个。
    const isAdmin = adminPerms?.role === 'admin' && !adminPerms.allowedClientId

    if (adminPerms?.role === 'admin' && adminPerms.allowedClientId) {
      const { data } = await supabaseAdmin
        .from('clients')
        .select('id, name, domain, created_at, semrush_db, plan_tier')
        .eq('id', adminPerms.allowedClientId)
      return NextResponse.json({ clients: data ?? [] })
    }

    // ── 3. Non-admin: filter to client_portal_users.email matches only ────
    let allowedIds: string[] | null = null
    if (!isAdmin) {
      const { data: accessRows } = await supabaseAdmin
        .from('client_portal_users')
        .select('client_id')
        .eq('email', email)
      allowedIds = (accessRows ?? []).map(r => r.client_id as string)
      if (allowedIds.length === 0) {
        return NextResponse.json({ clients: [] })
      }
    }

    let query = supabaseAdmin
      .from('clients')
      .select('id, name, domain, created_at, semrush_db, plan_tier')
      .order('created_at', { ascending: false })

    if (!isAdmin && allowedIds) {
      query = query.in('id', allowedIds)
    }

    const { data, error } = await query

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
