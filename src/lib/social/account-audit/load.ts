/** Read-only loader: factory work orders of one client → AuditReel[]. Nothing here writes. */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuditReel } from './audit'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

function variantId(brief: Record<string, unknown>): string | null {
  const v = brief.variant_of
  if (typeof v === 'string' && v) return v.slice(0, 8)
  const base = isRecord(v) ? str(v.base_work_order_id) : null
  return base ? base.slice(0, 8) : null
}

/** One work-order row → AuditReel. Unreadable fields stay null (the audit then says "not measured"). */
export function toAuditReel(row: unknown): AuditReel | null {
  if (!isRecord(row) || typeof row.id !== 'string' || typeof row.created_at !== 'string') return null
  const brief = isRecord(row.brief) ? row.brief : {}
  const remotion = isRecord(brief.remotion) ? brief.remotion : {}
  const props = isRecord(remotion.props) ? remotion.props : {}
  const slots = Array.isArray(props.scenes) ? props.scenes : Array.isArray(props.items) ? props.items : null
  const social = isRecord(brief.social_agent) ? brief.social_agent : {}
  return {
    id: row.id.slice(0, 8),
    createdOn: row.created_at.slice(0, 10),
    template: str(remotion.template),
    engine: str(brief.engine),
    music: str(props.musicFile),
    scenes: slots ? slots.length : null,
    brandColor: str(props.brandColor),
    variantOf: variantId(brief),
    format: str(social.format),
    pillar: str(social.pillar),
  }
}

export async function loadAuditReels(db: SupabaseClient, clientId: string, sinceIso: string): Promise<AuditReel[]> {
  const { data, error } = await db
    .from('content_work_orders')
    .select('id, created_at, brief')
    .eq('client_id', clientId)
    .in('status', ['approved', 'published', 'in_review', 'measuring', 'closed'])
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(300)
  if (error) throw new Error(`account_audit_read_failed: ${error.message}`)
  const out: AuditReel[] = []
  for (const row of Array.isArray(data) ? data : []) {
    const reel = toAuditReel(row)
    if (reel) out.push(reel)
  }
  return out
}
