// Batch update post status or delete multiple posts at once
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { updateRecord } from '@/lib/airtable/client'

const ALLOWED_STATUSES = ['draft', 'approved', 'scheduled', 'published', 'rejected'] as const
type PostStatus = typeof ALLOWED_STATUSES[number]

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { post_ids, action, status } = body

    if (!Array.isArray(post_ids) || post_ids.length === 0) {
      return NextResponse.json({ success: false, error: 'post_ids array required' }, { status: 400 })
    }

    if (!post_ids.every((id: unknown) => typeof id === 'string' && id.length > 0)) {
      return NextResponse.json({ success: false, error: 'post_ids must be an array of non-empty strings' }, { status: 400 })
    }

    if (post_ids.length > 100) {
      return NextResponse.json({ success: false, error: 'Max 100 posts per batch' }, { status: 400 })
    }

    const resolvedAction: string = action ?? 'updateStatus'

    if (resolvedAction === 'delete') {
      // Fetch post metadata before deletion to tombstone Airtable records
      const { data: postsToDelete, error: fetchError } = await supabaseAdmin
        .from('content_posts')
        .select('id, client_id, airtable_record_id')
        .in('id', post_ids)

      if (fetchError) throw fetchError

      // For new-table clients, mark Airtable records as Deleted so they won't re-sync
      const withAirtable = (postsToDelete ?? []).filter(p => p.airtable_record_id)
      if (withAirtable.length > 0) {
        const clientIds = Array.from(new Set(withAirtable.map(p => p.client_id)))
        const { data: clients } = await supabaseAdmin
          .from('clients')
          .select('id, airtable_base_id, airtable_content_table_id')
          .in('id', clientIds)

        const clientMap = Object.fromEntries(
          (clients ?? []).map(c => [c.id, c])
        )

        for (const post of withAirtable) {
          const client = clientMap[post.client_id]
          // Only archive in new-table mode (legacy Content Calendar is not filtered by Status)
          if (client?.airtable_base_id && client?.airtable_content_table_id) {
            await updateRecord(
              client.airtable_base_id,
              client.airtable_content_table_id,
              post.airtable_record_id,
              { Status: 'Deleted' }
            ).catch(e =>
              console.error('[batch/delete] Airtable archive failed:', post.airtable_record_id, e)
            )
          }
        }
      }

      const { data, error } = await supabaseAdmin
        .from('content_posts')
        .delete()
        .in('id', post_ids)
        .select('id')

      if (error) throw error
      return NextResponse.json({ success: true, deleted: data?.length ?? 0 })
    }

    if (resolvedAction === 'updateStatus') {
      if (!ALLOWED_STATUSES.includes(status as PostStatus)) {
        return NextResponse.json(
          { success: false, error: `status must be one of: ${ALLOWED_STATUSES.join(', ')}` },
          { status: 400 }
        )
      }

      const { data, error } = await supabaseAdmin
        .from('content_posts')
        .update({ status })
        .in('id', post_ids)
        .select('id, status')

      if (error) throw error
      return NextResponse.json({ success: true, updated: data?.length ?? 0 })
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
