/**
 * GET/POST /api/cron/mailchimp-suppression-sync
 *
 * 每天把 CRM 判过「不感兴趣 / 别再联系」的人，同步进 Mailchimp 的
 * `suppressed_do_not_email` 标签——跟 `mailchimp-paid-tagging` 是同一个思路
 * 的另一档：CRM 那边知道的事，Mailchimp 那边必须自动跟着知道，不能靠人记得
 * 去补标签。
 *
 * ## 为什么要它（2026-09-08 CTS newsletter 排期会话中发现）
 *
 * CRM 的「不感兴趣/别再联系」判定（`lib/crm/dnc.ts`、`lib/crm/segments.ts` 的
 * `DEAD_OUTCOMES`）从来没同步进 Mailchimp。实测发现 CTS 26 个被判过的联系人里
 * 有 6 个当时在 Mailchimp 仍是订阅状态、没打抑制标签——下一封群发邮件本来会
 * 发给他们。这条 cron 让这件事天天自动跑，不再需要发信前手工核对。
 *
 * ## 只加标签，不摘
 *
 * 见 `lib/mailchimp/suppression-sync.ts` 头部说明：CRM 没有「不感兴趣被撤销」
 * 的等价信号，所以本文件只做「新增抑制」，不做「解除抑制」——解除必须是人工
 * 确认后的动作，不属于这条 cron 的职责。
 *
 * Auth:
 *   GET : Authorization: Bearer ${CRON_SECRET}     （Render 定时触发）
 *   POST: x-cron-secret: ${CRON_SECRET}            （手动补跑）
 *
 * ⚠️ 新 cron 必须在 Render 上 link `me-shared-cron-secret` 环境变量组，
 *    否则每天 401 静默失败。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import { fetchAll } from '@/lib/supabase-paginate'
import { readAudienceId } from '@/lib/mailchimp/audience-config'
import {
  syncSuppressionTags,
  DEFAULT_SUPPRESS_TAG,
  type ContactForSuppressionCheck,
} from '@/lib/mailchimp/suppression-sync'

// 一个客户几百到几千个触点，多个客户串行跑，给足时间。
export const maxDuration = 300

interface ContactRow {
  id: string
  primary_email: string | null
  do_not_contact: boolean | null
}

interface TouchpointRow {
  contact_id: string
  metadata: { outcome?: string } | null
  occurred_at: string
}

/**
 * 抑制标签名从客户配置读——跟 `paid-tagging` 的 `readPolicy` 同一个理由：
 * 这个名字是某个客户 Mailchimp 里长出来的，不是平台规则。
 */
function readSuppressTag(leadsConfig: unknown): string {
  const cfg = (leadsConfig ?? {}) as { suppression_sync?: { suppress_tag?: unknown } }
  const raw = cfg.suppression_sync?.suppress_tag
  return typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_SUPPRESS_TAG
}

async function loadContactsForClient(clientId: string): Promise<ContactForSuppressionCheck[]> {
  const contacts = await fetchAll<ContactRow>((from, to) =>
    supabaseAdmin
      .from('contacts')
      .select('id, primary_email, do_not_contact')
      .eq('client_id', clientId)
      .order('id', { ascending: true })
      .range(from, to),
  )

  const touchpoints = await fetchAll<TouchpointRow>((from, to) =>
    supabaseAdmin
      .from('contact_touchpoints')
      .select('contact_id, metadata, occurred_at')
      .eq('client_id', clientId)
      .not('metadata->>outcome', 'is', null)
      .order('id', { ascending: true })
      .range(from, to),
  )

  const touchesByContact = new Map<string, { outcome?: string | null; occurredAt: string }[]>()
  for (const tp of touchpoints) {
    const list = touchesByContact.get(tp.contact_id) ?? []
    list.push({ outcome: tp.metadata?.outcome ?? null, occurredAt: tp.occurred_at })
    touchesByContact.set(tp.contact_id, list)
  }

  return contacts.map((c) => ({
    contactId: c.id,
    email: c.primary_email,
    doNotContactFlag: c.do_not_contact === true,
    touches: touchesByContact.get(c.id) ?? [],
  }))
}

async function run(dryRun: boolean): Promise<NextResponse> {
  const cronRun = await startCronRun('mailchimp-suppression-sync')

  const apiKey = process.env.MAILCHIMP_API_KEY
  if (!apiKey) {
    await cronRun.finish({ error: 'MAILCHIMP_API_KEY 没配' })
    return NextResponse.json({ error: 'MAILCHIMP_API_KEY 没配 —— 去 Render 环境变量加上' }, { status: 500 })
  }

  const { data: clients, error: cErr } = await supabaseAdmin
    .from('clients')
    .select('id, name, leads_config')

  if (cErr) {
    await cronRun.finish({ error: cErr.message })
    return NextResponse.json({ error: cErr.message }, { status: 500 })
  }

  const results: Array<Record<string, unknown>> = []

  for (const client of (clients ?? []) as Array<{ id: string; name: string | null; leads_config: unknown }>) {
    const audience = await readAudienceId(client.id)
    if (!audience.ok) {
      results.push({ client: client.name, error: `读 audience id 失败: ${audience.message}` })
      continue
    }
    if (!audience.audienceId) {
      results.push({ client: client.name, skipped: 'no_audience_id' })
      continue
    }

    const contacts = await loadContactsForClient(client.id)
    const suppressTag = readSuppressTag(client.leads_config)
    const r = await syncSuppressionTags(
      contacts,
      { apiKey, audienceId: audience.audienceId },
      { suppressTag, dryRun },
    )

    results.push({
      client: client.name,
      scanned: r.scanned,
      newlySuppressed: r.newlySuppressed.length,
      alreadyTagged: r.alreadyTagged,
      skippedNoEmail: r.skippedNoEmail,
      notInAudience: r.notInAudience,
      errors: r.errors,
    })
  }

  const failed = results.filter(
    (x) => 'error' in x || (Array.isArray(x.errors) && x.errors.length > 0),
  ).length

  await cronRun.finish({
    processed: results.length,
    completed: results.length - failed,
    failed,
    summary: { dryRun, results },
  })

  return NextResponse.json({ ok: true, dryRun, results })
}

function isDryRun(req: NextRequest): boolean {
  const raw = (req.nextUrl.searchParams.get('dry') ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return run(isDryRun(req))
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return run(isDryRun(req))
}
