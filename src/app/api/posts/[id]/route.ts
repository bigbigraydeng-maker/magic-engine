import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { readGuardFlag, toPublicGuardFlag } from '@/lib/content/guard-receipt'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabaseAdmin
      .from('content_posts')
      .select('id, client_id, title, route, platforms, status, caption, script, hashtags, visual_brief, scheduled_at, created_at, execution_item_id, generation_context_snapshot, clients(name)')
      .eq('id', params.id)
      .maybeSingle()

    if (error) throw error
    if (!data) {
      return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 })
    }

    const access = await requirePaidClientAccess(data.client_id)
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status })
    }

    let visual_asset_url: string | null = null
    let visual_asset_type: string | null = null

    const { data: assetRow } = await supabaseAdmin
      .from('visual_assets')
      .select('storage_url, asset_type')
      .eq('post_id', params.id)
      .eq('client_id', data.client_id)
      .eq('generation_status', 'ready')
      .not('storage_url', 'is', null)
      .order('is_final', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (assetRow) {
      visual_asset_url = assetRow.storage_url
      visual_asset_type = assetRow.asset_type
    }

    // 发布前自检的红旗翻给前端；整份 snapshot 不外送（生成过程的内部字段，不是
    // 给审核人看的），判分服务的原始报错也在 toPublicGuardFlag 里摘掉了。
    const { generation_context_snapshot, ...publicData } = data

    return NextResponse.json({
      success: true,
      post: {
        ...publicData,
        guard: toPublicGuardFlag(readGuardFlag(generation_context_snapshot)),
        visual_asset_url,
        visual_asset_type,
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data: owner, error: ownerError } = await supabaseAdmin
      .from('content_posts')
      .select('client_id')
      .eq('id', params.id)
      .maybeSingle()
    if (ownerError) throw ownerError
    if (!owner) {
      return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 })
    }
    const access = await requirePaidClientAccess(owner.client_id)
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status })
    }

    const body = await req.json()

    const allowed = ['title', 'script', 'caption', 'visual_brief', 'hashtags', 'scheduled_at', 'status', 'revision_notes', 'execution_item_id']
    const update: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) update[key] = body[key]
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ success: false, error: 'No supported fields supplied' }, { status: 400 })
    }

    // execution_item_id is a cross-table relationship, not an opaque string.
    // Prove the target belongs to the same client before linking it; otherwise
    // a later publish completion trigger could close another customer's work.
    if ('execution_item_id' in update && update.execution_item_id !== null) {
      if (typeof update.execution_item_id !== 'string' || update.execution_item_id.length === 0) {
        return NextResponse.json({ success: false, error: 'execution_item_id must be a non-empty string or null' }, { status: 400 })
      }
      const { data: executionItem, error: executionError } = await supabaseAdmin
        .from('execution_items')
        .select('id')
        .eq('id', update.execution_item_id)
        .eq('client_id', owner.client_id)
        .maybeSingle()
      if (executionError) throw executionError
      if (!executionItem) {
        return NextResponse.json(
          { success: false, error: 'Execution item not found for this client' },
          { status: 404 },
        )
      }
    }

    const { error } = await supabaseAdmin
      .from('content_posts')
      .update(update)
      .eq('id', params.id)
      .eq('client_id', owner.client_id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
