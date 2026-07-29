/**
 * 客户的 leads 模块配置 —— GET / PATCH。
 *
 * 目前只有一项：要不要把这个客户的邮件反应（谁打开了、谁点了链接）同步进 CRM。
 *
 * 默认关。一个 Mailchimp 账户可能只服务部分客户，全开会把别人的邮件反应
 * 写到这个客户的联系人身上 —— 那是跨客户数据污染，比不同步严重得多。
 *
 * Responses: 200 { config } / 400 / 401 / 403 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

export interface LeadsConfig {
  /** 开了才会把邮件打开/点击同步进这个客户的 CRM。 */
  mailchimpEnabled: boolean
}

function readConfig(raw: unknown): LeadsConfig {
  const o = (raw ?? {}) as Record<string, unknown>
  return { mailchimpEnabled: o.mailchimp_enabled === true }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('leads_config')
    .eq('id', clientId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: '客户不存在' }, { status: 404 })

  return NextResponse.json({ config: readConfig(data.leads_config) })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: { mailchimpEnabled?: unknown }
  try {
    body = (await req.json()) as { mailchimpEnabled?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (typeof body.mailchimpEnabled !== 'boolean') {
    return NextResponse.json({ error: 'mailchimpEnabled 必须是 true / false' }, { status: 400 })
  }

  // 读-改-写：leads_config 以后还会加别的项，整块覆盖会把它们抹掉。
  const { data: cur } = await supabaseAdmin
    .from('clients')
    .select('leads_config')
    .eq('id', clientId)
    .maybeSingle()

  const next = {
    ...((cur?.leads_config as Record<string, unknown> | null) ?? {}),
    mailchimp_enabled: body.mailchimpEnabled,
  }

  const { error: updErr } = await supabaseAdmin
    .from('clients')
    .update({ leads_config: next })
    .eq('id', clientId)

  if (updErr) {
    return NextResponse.json({ error: `保存失败: ${updErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ config: readConfig(next) })
}
