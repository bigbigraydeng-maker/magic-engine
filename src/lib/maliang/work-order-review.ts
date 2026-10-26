// Persists a 马良 verdict on a template-render work order.
// The other route writes content_posts.generation_context_snapshot.maliang_check.
// Work orders have no content post, so the same object is stored on output,
// which the review screen already reads. No new column.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { MaliangCheck } from '@/lib/maliang/render-check'
import { dispositionOf, stampWorkOrderOutput } from '@/lib/maliang/review-disposition'
import { remotionNineGridInput } from '@/lib/maliang/remotion-review-input'

export interface WorkOrderReady {
  client_id: string
  work_order_id: string
  output_url: string
}

export interface WorkOrderReviewContext {
  input: ReturnType<typeof remotionNineGridInput>
  output: unknown
  status: string
}

type ReadResult = { ok: true; ctx: WorkOrderReviewContext } | { ok: false; reason: string }

export async function readWorkOrderContext(
  supabase: SupabaseClient,
  data: WorkOrderReady,
): Promise<ReadResult> {
  const order = await supabase
    .from('content_work_orders')
    .select('id, client_id, status, angle, brief, output')
    .eq('id', data.work_order_id)
    .maybeSingle()
  if (order.error) return { ok: false, reason: `work_order_read_failed: ${order.error.message}` }
  if (!order.data) return { ok: false, reason: 'work_order_not_found' }

  const row = order.data as Record<string, unknown>
  if (row.client_id !== data.client_id) return { ok: false, reason: 'work_order_client_mismatch' }
  if (row.status !== 'in_review') return { ok: false, reason: `work_order_status_${String(row.status)}` }

  const client = await supabase.from('clients').select('name').eq('id', data.client_id).maybeSingle()
  if (client.error) return { ok: false, reason: `client_read_failed: ${client.error.message}` }
  if (!client.data) return { ok: false, reason: 'client_not_found' }

  const clientRow = client.data as Record<string, unknown>
  const output = row.output
  const caption = output && typeof output === 'object' && !Array.isArray(output)
    ? (output as { caption?: unknown }).caption
    : undefined

  return {
    ok: true,
    ctx: {
      output,
      status: 'in_review',
      input: remotionNineGridInput({
        title: typeof row.angle === 'string' ? row.angle : '',
        brandName: typeof clientRow.name === 'string' ? clientRow.name : '',
        brief: row.brief,
        caption,
      }),
    },
  }
}

/** Writes the verdict. A reject leaves the approve queue only while the order is still in_review. */
export async function writeWorkOrderVerdict(
  supabase: SupabaseClient,
  workOrderId: string,
  currentOutput: unknown,
  currentStatus: string,
  check: MaliangCheck,
): Promise<void> {
  const stamped = stampWorkOrderOutput(currentOutput, check)
  const outputUpdate = await supabase
    .from('content_work_orders')
    .update({ output: stamped, updated_at: new Date().toISOString() })
    .eq('id', workOrderId)
  if (outputUpdate.error) throw new Error(`写回工单裁决失败：${outputUpdate.error.message}`)

  const disposition = dispositionOf(check.status)
  if (!disposition.holdFromQueue || currentStatus !== 'in_review') return

  const statusUpdate = await supabase
    .from('content_work_orders')
    .update({
      status: 'review_rejected',
      reject_category: 'quality',
      reject_reason: `马良自检不过关：${check.reasons.join('；')}`.slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq('id', workOrderId)
    .eq('status', 'in_review')
  if (statusUpdate.error) throw new Error(`标出审片队列失败：${statusUpdate.error.message}`)
}
