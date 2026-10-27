// After a template render is stored, ask 马良 to look. If this send fails, the
// work order is already in the human queue and marked not machine-reviewed.

import { isRemotionBrief } from '@/lib/factory/render-mode'
import { factoryVideoUrl } from '@/lib/factory/outlets'
import { MALIANG_RENDER_READY_EVENT } from '@/lib/inngest/functions/maliang-render-check'

export interface RemotionReviewEvent {
  name: typeof MALIANG_RENDER_READY_EVENT
  data: { client_id: string; work_order_id: string; output_url: string }
}

export function remotionPublicVideoUrl(videoPath: string, supabaseUrl: string | undefined): string | null {
  const base = supabaseUrl?.trim().replace(/\/$/, '')
  if (!base || !videoPath.trim()) return null
  try {
    const url = new URL(factoryVideoUrl(videoPath, base))
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.toString()
  } catch {
    return null
  }
}

export async function enqueueRemotionMaliangReview(args: {
  brief: unknown
  clientId: string
  workOrderId: string
  videoPath: string
  supabaseUrl: string | undefined
  send: (event: RemotionReviewEvent) => Promise<unknown>
}): Promise<{ sent: boolean; reason?: string }> {
  if (!isRemotionBrief(args.brief)) return { sent: false, reason: 'not_remotion' }
  const outputUrl = remotionPublicVideoUrl(args.videoPath, args.supabaseUrl)
  if (!outputUrl) return { sent: false, reason: 'no_public_url' }
  try {
    await args.send({
      name: MALIANG_RENDER_READY_EVENT,
      data: { client_id: args.clientId, work_order_id: args.workOrderId, output_url: outputUrl },
    })
    return { sent: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { sent: false, reason: message.slice(0, 300) }
  }
}
