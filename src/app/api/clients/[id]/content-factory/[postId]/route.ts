import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// PATCH /api/clients/[id]/content-factory/[postId]
// body: { action: 'confirm' | 'reject' }
// 选题段的确认/打回：confirm → approved(进备料段)，reject → rejected(留选题段)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; postId: string } },
) {
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string }
    const status =
      body.action === 'confirm' ? 'approved'
      : body.action === 'reject' ? 'rejected'
      : null
    if (!status) {
      return NextResponse.json({ error: "action 必须是 'confirm' 或 'reject'" }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('content_posts')
      .update({ status })
      .eq('client_id', params.id)   // 双重限定，防越权改到别客户
      .eq('id', params.postId)
      .select('id, status')
      .single()

    if (error) throw error
    if (!data) return NextResponse.json({ error: '未找到该内容' }, { status: 404 })

    return NextResponse.json({ post: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
