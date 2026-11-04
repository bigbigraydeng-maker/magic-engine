/**
 * GET/PATCH /api/clients/[id]/publishing-quota
 * The settings form for clients.publishing_calendar_config.quota.
 * Saves quota numbers only. weekly_pack and any other key on that column stay.
 * Does not publish, and does not apply a migration.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import {
  emptyStoredQuota,
  mergeQuotaConfig,
  parseQuotaPatch,
  readStoredQuota,
} from '@/lib/social/publishing-quota/save'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function columnMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42703' || /does not exist|column/i.test(error.message ?? '')
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('publishing_calendar_config')
    .eq('id', params.id)
    .maybeSingle()

  if (columnMissing(error)) {
    return NextResponse.json({ quota: emptyStoredQuota(), has_other_config: false, column_ready: false })
  }
  if (error) return NextResponse.json({ error: '现在读不到发布名额' }, { status: 500 })
  if (!data) return NextResponse.json({ error: '找不到这个客户' }, { status: 404 })

  const stored = readStoredQuota((data as { publishing_calendar_config?: unknown }).publishing_calendar_config)
  return NextResponse.json({ ...stored, column_ready: true })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const parsed = parseQuotaPatch(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('publishing_calendar_config')
    .eq('id', params.id)
    .maybeSingle()

  if (columnMissing(error)) return NextResponse.json({ error: '名额这一列还没建好，没有写入' }, { status: 409 })
  if (error) return NextResponse.json({ error: '现在读不到发布名额，没有写入' }, { status: 500 })
  if (!data) return NextResponse.json({ error: '找不到这个客户' }, { status: 404 })

  const current = (data as { publishing_calendar_config?: unknown }).publishing_calendar_config
  const merged = mergeQuotaConfig(current, parsed.patch)
  if (!merged.ok) return NextResponse.json({ error: merged.error }, { status: 409 })

  const { error: writeErr } = await supabaseAdmin
    .from('clients')
    .update({ publishing_calendar_config: merged.config })
    .eq('id', params.id)
  if (columnMissing(writeErr)) return NextResponse.json({ error: '名额这一列还没建好，没有写入' }, { status: 409 })
  if (writeErr) return NextResponse.json({ error: '没有保存成功' }, { status: 500 })

  const stored = readStoredQuota(merged.config)
  return NextResponse.json({ ...stored, column_ready: true })
}
