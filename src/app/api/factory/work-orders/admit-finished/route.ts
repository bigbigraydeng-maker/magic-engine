import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { admitFinishedVideo, type AdmitInput } from '@/lib/factory/admit-finished'
import type { ConsentUse } from '@/lib/factory/talent-consent'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { MALIANG_RENDER_READY_EVENT } from '@/lib/inngest/functions/maliang-render-check'

const CONSENT_USES: readonly ConsentUse[] = ['facebook_organic', 'meta_ads']

function parseTalentConsent(raw: unknown): AdmitInput['talentConsent'] | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const status = record.status
  const scopeRaw = record.scope
  const scope: ConsentUse[] = Array.isArray(scopeRaw)
    ? scopeRaw.filter((entry): entry is ConsentUse =>
        typeof entry === 'string' && CONSENT_USES.some((use) => use === entry))
    : []
  return {
    status: status === 'granted' || status === 'not_needed' ? status : (status as 'granted' | 'not_needed'),
    scope,
    subject: typeof record.subject === 'string' ? record.subject : '',
    evidence: typeof record.evidence === 'string' ? record.evidence : '',
  }
}

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const admin = await requireGlobalAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })

  const confirmedBy = admin.user.email ?? ''
  if (!confirmedBy) return NextResponse.json({ error: 'admin email missing' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const endcard = typeof body.endcard === 'object' && body.endcard !== null
    ? body.endcard as Record<string, unknown>
    : {}

  const input: AdmitInput = {
    clientId: String(body.client_id ?? ''),
    storagePath: String(body.storage_path ?? ''),
    angle: String(body.angle ?? ''),
    rationale: String(body.rationale ?? body.angle ?? ''),
    caption: String(body.caption ?? ''),
    endcard: {
      cta: String(endcard.cta ?? ''),
      url: String(endcard.url ?? ''),
    },
    masterBriefId: typeof body.master_brief_id === 'string' ? body.master_brief_id : undefined,
    goalId: typeof body.goal_id === 'string' ? body.goal_id : undefined,
    confirmedBy,
    talentConsent: parseTalentConsent(body.talent_consent),
  }

  const result = await admitFinishedVideo(supabaseAdmin, input, {
    sendReview: async (data) => {
      // One review per admitted order: Inngest drops a re-send with the same id within 24 hours.
      await sendInngestEvent({ id: `maliang-admit:${data.work_order_id}`, name: MALIANG_RENDER_READY_EVENT, data })
    },
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({
    ok: true,
    work_order_id: result.workOrderId,
    deduped: result.deduped,
    review_queued: result.reviewQueued,
    review_error: result.reviewError,
    auto_checklist_summary: result.autoChecklist.map(c => ({
      key: c.key,
      outcome: c.outcome,
      detail: c.detail,
    })),
  })
}
