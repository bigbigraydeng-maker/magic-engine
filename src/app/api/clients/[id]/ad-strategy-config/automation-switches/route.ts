/**
 * Read and flip the three ads automation switches on leads_config.
 * Internal admins only. Other leads_config fields are left in place.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { isUuid } from '@/lib/validation-utils'
import {
  automationSwitchAuditSummary,
  mergeAdsAutomationSwitches,
  readAdsAutomationSwitches,
  type AdsAutomationSwitchKey,
  type AdsAutomationSwitches,
} from '@/lib/ads-strategy/automation-switches'

const KEYS: readonly AdsAutomationSwitchKey[] = [
  'ads_predictive_early_warning',
  'ads_trend_check',
  'ads_tune_cards',
]

type ClientRow = { id: string; leads_config: unknown }

export async function GET(_req: Request, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  const id = await clientId(ctx.params)
  if (!isUuid(id)) return NextResponse.json({ error: '这个地址不对。' }, { status: 400 })
  const staff = await requireGlobalAdmin()
  if (!staff.ok) return denied(staff.status)
  const row = await loadClient(id)
  if (row === 'missing') return NextResponse.json({ error: '客户不存在。' }, { status: 404 })
  if (row === 'unreadable') return NextResponse.json({ error: '开关读不到。' }, { status: 409 })
  return NextResponse.json({ switches: readAdsAutomationSwitches(row.leads_config) })
}

export async function POST(req: Request, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  const id = await clientId(ctx.params)
  if (!isUuid(id)) return NextResponse.json({ error: '这个地址不对。' }, { status: 400 })
  const staff = await requireGlobalAdmin()
  if (!staff.ok) return denied(staff.status)
  const actor = staff.user.email?.trim().toLowerCase() ?? ''
  if (!actor) return NextResponse.json({ error: '你不能改这个开关。' }, { status: 403 })

  const patch = parsePatch(await req.json().catch(() => null))
  if (!patch.ok) return NextResponse.json({ error: patch.error }, { status: 400 })

  const row = await loadClient(id)
  if (row === 'missing') return NextResponse.json({ error: '客户不存在。' }, { status: 404 })
  if (row === 'unreadable') return NextResponse.json({ error: '开关读不到。' }, { status: 409 })

  const before = readAdsAutomationSwitches(row.leads_config)
  const nextConfig = mergeAdsAutomationSwitches(row.leads_config, patch.value)
  const after = readAdsAutomationSwitches(nextConfig)
  const summary = automationSwitchAuditSummary(before, after)
  if (!summary) return NextResponse.json({ switches: after, auditWarning: null })

  const saved = await saveConfig(id, nextConfig)
  if (!saved) return NextResponse.json({ error: '开关没写成。' }, { status: 409 })
  const audited = await writeWorkLog(id, actor, summary)
  if (audited) return NextResponse.json({ switches: after, auditWarning: null })

  const rolledBack = await saveConfig(id, row.leads_config ?? {})
  if (!rolledBack) {
    return NextResponse.json(
      { error: '开关可能已经改了，但没能记进工作日志，也没能改回去。请再看一眼当前状态。', switches: after },
      { status: 500 },
    )
  }
  return NextResponse.json({ error: '这次没有改，因为没能记进工作日志。' }, { status: 500 })
}

function denied(status: number): NextResponse {
  return NextResponse.json({ error: status === 401 ? '请先登录。' : '你不能改这个开关。' }, { status })
}

async function clientId(params: { id: string } | Promise<{ id: string }>): Promise<string> {
  return (await params).id
}

function parsePatch(raw: unknown): { ok: true; value: Partial<AdsAutomationSwitches> } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '请写明要改哪个开关。' }
  }
  const body = raw as Record<string, unknown>
  const names = Object.keys(body)
  if (names.length === 0) return { ok: false, error: '请写明要改哪个开关。' }
  const value: Partial<AdsAutomationSwitches> = {}
  for (const name of names) {
    if (!KEYS.includes(name as AdsAutomationSwitchKey)) {
      return { ok: false, error: '请求里带了开关不认识的内容，没有收下。' }
    }
    if (typeof body[name] !== 'boolean') return { ok: false, error: '请写明开还是关。' }
    value[name as AdsAutomationSwitchKey] = body[name]
  }
  return { ok: true, value }
}

async function loadClient(id: string): Promise<ClientRow | 'missing' | 'unreadable'> {
  const { data, error } = await supabaseAdmin.from('clients').select('id, leads_config').eq('id', id).maybeSingle()
  if (error) return 'unreadable'
  if (!data) return 'missing'
  return data as ClientRow
}

async function saveConfig(id: string, leadsConfig: unknown): Promise<boolean> {
  const saved = await supabaseAdmin.from('clients').update({ leads_config: leadsConfig }).eq('id', id)
  return !saved.error
}

async function writeWorkLog(clientId: string, actor: string, summary: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from('fde_work_logs').insert({
    client_id: clientId,
    log_date: new Date().toISOString().slice(0, 10),
    summary,
    author_email: actor,
  })
  if (error) console.error('[ads-automation-switches] work log insert failed')
  return !error
}
