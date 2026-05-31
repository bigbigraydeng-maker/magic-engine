import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// GET /api/clients/[id]/posts
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(req.url)
    const statusParam = searchParams.get('status')

    let query = supabaseAdmin
      .from('content_posts')
      .select('id, title, status, route, platforms, caption, hashtags, visual_brief, scheduled_at, format, ratio, created_at, source')
      .eq('client_id', params.id)
      .order('scheduled_at', { ascending: true, nullsFirst: false })
      .limit(200)

    if (statusParam) {
      const statuses = statusParam.split(',').map(s => s.trim()).filter(Boolean)
      if (statuses.length === 1) query = query.eq('status', statuses[0])
      else if (statuses.length > 1) query = query.in('status', statuses)
    }

    const { data, error } = await query

    if (error) throw error
    return NextResponse.json({ posts: data ?? [] })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
