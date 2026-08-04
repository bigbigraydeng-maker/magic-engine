/**
 * Client industry — single write entry for clients.industry.
 *
 * GET   → current value + whether it is a known (controlled-vocabulary) value.
 * PATCH → replaces it with a value from INDUSTRY_OPTIONS (or null to clear).
 *
 * Consumed by `lib/memory/service.ts > loadGlobalLessons`: industry-scoped
 * cross-client lessons ("学区盘广告不要只投住在楼盘附近的人") are only injected
 * into an agent's prompt when the client's industry matches. A client with a
 * free-text or empty industry silently reads none of them — which is why this
 * field needs a real UI instead of a manual DB edit.
 *
 * Mirrors src/app/api/clients/[id]/brand-aliases/route.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { isKnownIndustry } from '@/lib/clients/industries'

interface PatchBody {
  industry?: unknown
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('industry')
    .eq('id', clientId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const raw = (data as { industry: unknown }).industry
  const industry = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null

  return NextResponse.json({
    industry,
    // false + non-null ⇒ 存量自由文本，行业经验大概率匹配不上，UI 要提示改
    is_known: industry ? isKnownIndustry(industry) : false,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = body.industry
  if (raw !== null && typeof raw !== 'string') {
    return NextResponse.json(
      { error: 'Body must include `industry: string | null`' },
      { status: 400 },
    )
  }

  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  const next = trimmed.length > 0 ? trimmed : null

  // 只收词表内的值：自由文本正是「匹配不上任何行业经验」的根因，
  // 从写入侧堵住，不要在取数侧一直做兼容。
  if (next !== null && !isKnownIndustry(next)) {
    return NextResponse.json(
      { error: `Unknown industry: ${next}. Pick one from INDUSTRY_OPTIONS.` },
      { status: 400 },
    )
  }

  const { error: updateErr } = await supabaseAdmin
    .from('clients')
    .update({ industry: next })
    .eq('id', clientId)

  if (updateErr) {
    return NextResponse.json(
      { error: `Failed to update industry: ${updateErr.message}` },
      { status: 500 },
    )
  }

  try {
    revalidatePath(`/dashboard/clients/${clientId}/settings`)
  } catch {
    // best-effort during dev / non-Next runtime
  }

  return NextResponse.json({ success: true, industry: next })
}
