/**
 * POST /api/clients/[id]/onboarding/complete
 *
 * Self-serve onboarding Step 5: stamp completion and, when the client asked
 * for help, write one FDE work log. Six-dimension scoring is not started.
 *
 * Body: { helpRequests?: string[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requireOnboardingClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const body = (await req.json().catch(() => ({}))) as { helpRequests?: unknown }
  const helpRequests = Array.isArray(body.helpRequests)
    ? body.helpRequests.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 20)
    : []

  // Stamp completion. Six-dimension scoring is not started.
  const { error: stampErr } = await supabaseAdmin
    .from('clients')
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq('id', clientId)
  if (stampErr) {
    return NextResponse.json({ error: stampErr.message }, { status: 500 })
  }

  // 3. Best-effort FDE notification. Never blocks completion.
  if (helpRequests.length > 0) {
    const summary = `【自助 onboarding 完成】客户提交，需上门/远程帮忙的步骤：${helpRequests.join('、')}`
    await supabaseAdmin
      .from('fde_work_logs')
      .insert({
        client_id: clientId,
        log_date: new Date().toISOString().slice(0, 10),
        summary,
        author_email: (access.user.email ?? 'self-serve@magicengine.cloud').toLowerCase(),
      })
      .then(({ error }) => { if (error) console.error('[onboarding/complete] fde log failed', error) })
  }

  return NextResponse.json({ ok: true, diagnostic_run_id: null, help_requests: helpRequests })
}
