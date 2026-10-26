/**
 * Human-readable labels for creative-pool entries (read-only).
 *
 * The pool stores only a Meta video id. The factory's published receipt
 * (content_work_orders.published_ref) is the source of truth that links that id
 * back to our own video, so we resolve names from there. If an id cannot be
 * matched we return nothing for it — the UI then says "unrecognised"; we never
 * guess a name.
 */

import { supabaseAdmin } from '@/lib/supabase'

export interface CreativeLabel {
  /** Tour / product name, e.g. the text before the first colon of the work-order angle. */
  title: string
  /** Short format description (revision notes stripped). */
  subtitle: string | null
  publishedAt: string | null
  /** Facebook link to open the video. */
  url: string | null
}

interface WorkOrderRow {
  angle: string | null
  published_ref: {
    video_id?: unknown
    post_id?: unknown
    published_at?: unknown
    permalink?: unknown
  } | null
}

/** "Best of China: 15-second reel (v3 ...)" → title "Best of China", subtitle "15-second reel". */
export function splitAngle(angle: string): { title: string; subtitle: string | null } {
  const idx = angle.indexOf(':')
  const rawTitle = (idx === -1 ? angle : angle.slice(0, idx)).trim()
  const rest = idx === -1 ? '' : angle.slice(idx + 1)
  const subtitle = rest.split(/\s[(|]/)[0]?.trim() ?? ''
  return { title: rawTitle, subtitle: subtitle === '' ? null : subtitle }
}

export function toLabel(row: WorkOrderRow): CreativeLabel | null {
  if (!row.angle || row.angle.trim() === '') return null
  const { title, subtitle } = splitAngle(row.angle)
  if (title === '') return null
  const ref = row.published_ref
  const publishedAt = typeof ref?.published_at === 'string' ? ref.published_at : null
  const videoId = typeof ref?.video_id === 'string' ? ref.video_id : typeof ref?.post_id === 'string' ? ref.post_id : null
  return {
    title,
    subtitle,
    publishedAt,
    url: videoId ? `https://www.facebook.com/reel/${videoId}` : null,
  }
}

export async function loadCreativeLabels(
  clientId: string,
  refs: string[],
): Promise<Record<string, CreativeLabel>> {
  const ids = refs.filter(r => /^\d+$/.test(r))
  if (ids.length === 0) return {}
  const { data, error } = await supabaseAdmin
    .from('content_work_orders')
    .select('angle, published_ref')
    .eq('client_id', clientId)
    .not('published_ref', 'is', null)
  if (error || !data) return {}
  const out: Record<string, CreativeLabel> = {}
  for (const row of data as WorkOrderRow[]) {
    const vid = row.published_ref?.video_id
    const pid = row.published_ref?.post_id
    for (const id of ids) {
      if (vid !== id && pid !== id) continue
      const label = toLabel(row)
      if (label) out[id] = label
    }
  }
  return out
}
