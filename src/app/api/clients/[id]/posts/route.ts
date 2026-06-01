import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// POST /api/clients/[id]/posts
// Creates an empty draft content_post bound to an execution_item.
// Used when an FDE opens a marketing-plan task that has no content_post yet
// (task-dispatcher creates execution_items only; save-to-board is the path
// that creates content_posts, but FDE may skip that flow).
//
// Body: { execution_item_id: string }
// Returns: { post: { id, ... } } — the new (or existing) post for this item.
//
// Idempotent: if a content_post for this execution_item_id already exists,
// returns it instead of creating a duplicate.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      execution_item_id?: string
    }
    const executionItemId = body.execution_item_id?.trim()
    if (!executionItemId) {
      return NextResponse.json(
        { error: 'execution_item_id required' },
        { status: 400 },
      )
    }

    // Idempotency: return existing post if any.
    const { data: existing } = await supabaseAdmin
      .from('content_posts')
      .select('id, title, status, route, platforms, caption, hashtags, visual_brief, scheduled_at, format, ratio, created_at, source, execution_item_id')
      .eq('client_id', params.id)
      .eq('execution_item_id', executionItemId)
      .limit(1)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ post: existing, created: false })
    }

    // Fetch the execution_item for title/platform/dimension defaults.
    const { data: item, error: itemErr } = await supabaseAdmin
      .from('execution_items')
      .select('title, dimension, steps_json')
      .eq('id', executionItemId)
      .eq('client_id', params.id)
      .single()

    if (itemErr || !item) {
      return NextResponse.json(
        { error: 'Execution item not found for this client' },
        { status: 404 },
      )
    }

    const stepsJson = (item.steps_json ?? {}) as { platform?: string; kind?: string }
    const platform = stepsJson.platform ?? 'facebook'
    const route = stepsJson.kind === 'social_story' ? 'story' : 'route_a'

    const { data: created, error: insertErr } = await supabaseAdmin
      .from('content_posts')
      .insert({
        client_id:         params.id,
        execution_item_id: executionItemId,
        title:             item.title,
        route,
        platforms:         [platform],
        status:            'draft',
        source:            'kanban',
        caption:           '',
        hashtags:          [],
      })
      .select('id, title, status, route, platforms, caption, hashtags, visual_brief, scheduled_at, format, ratio, created_at, source, execution_item_id')
      .single()

    if (insertErr) throw insertErr

    return NextResponse.json({ post: created, created: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// GET /api/clients/[id]/posts
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(req.url)
    const statusParam          = searchParams.get('status')
    const executionItemIdParam = searchParams.get('execution_item_id')

    let query = supabaseAdmin
      .from('content_posts')
      .select('id, title, status, route, platforms, caption, hashtags, visual_brief, scheduled_at, format, ratio, created_at, source, execution_item_id')
      .eq('client_id', params.id)
      .order('scheduled_at', { ascending: true, nullsFirst: false })
      .limit(200)

    if (statusParam) {
      const statuses = statusParam.split(',').map(s => s.trim()).filter(Boolean)
      if (statuses.length === 1) query = query.eq('status', statuses[0])
      else if (statuses.length > 1) query = query.in('status', statuses)
    }
    if (executionItemIdParam) {
      query = query.eq('execution_item_id', executionItemIdParam).limit(1)
    }

    const { data, error } = await query

    if (error) throw error
    return NextResponse.json({ posts: data ?? [] })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
