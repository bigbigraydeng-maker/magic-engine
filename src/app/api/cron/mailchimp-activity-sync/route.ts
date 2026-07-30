/**
 * GET/POST /api/cron/mailchimp-activity-sync
 *
 * 每天把邮件反应搬进 CRM：谁收到了、谁打开了、谁点了链接。
 *
 * 为什么要它：销售一天打不完 297 个电话。但一批邮件发出去，三分之一会打开、
 * 一成多会点链接（CTS 近 90 天真实数据）—— **点了行程链接的人才是今天该打的**。
 * 在这之前系统完全看不到这件事，销售只能按「我们打没打过他」排序。
 *
 * 跑完之后，这些反应会出现在每个客人的往来记录里，并且参与冷热分级。
 *
 * Auth:
 *   GET : Authorization: Bearer ${CRON_SECRET}     （Render 定时触发）
 *   POST: x-cron-secret: ${CRON_SECRET}            （手动补跑）
 *
 * ⚠️ 新 cron 必须在 Render 上 link `me-shared-cron-secret` 环境变量组，
 *    否则每天 401 静默失败（daily-cron-digest 只报「失败」不报「没跑」，
 *    上一个踩这个坑的 cron 哑了 51 天）。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { syncMailchimpActivity } from '@/lib/mailchimp/sync'
import { ping } from '@/lib/mailchimp/client'

// 一个客户几十封邮件 × 每封翻页拉名单，给足时间。
export const maxDuration = 600

async function run(): Promise<NextResponse> {
  const apiKey = process.env.MAILCHIMP_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'MAILCHIMP_API_KEY 没配 —— 去 Render 环境变量加上' },
      { status: 500 },
    )
  }

  // 先 ping。key 失效时给一句人话，而不是每个客户各炸一次 401。
  try {
    await ping(apiKey)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Mailchimp 连不上' },
      { status: 502 },
    )
  }

  // 哪些客户要同步：leads_config.mailchimp_enabled = true。
  // 默认不开 —— 一个 Mailchimp 账户可能只服务部分客户，不能把别人的邮件
  // 反应写到这个客户的联系人身上。
  const { data: clients, error } = await supabaseAdmin
    .from('clients')
    .select('id, name, leads_config')
    .not('leads_config', 'is', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const targets = (clients ?? []).filter(
    (c) => (c.leads_config as { mailchimp_enabled?: boolean } | null)?.mailchimp_enabled === true,
  )

  if (targets.length === 0) {
    return NextResponse.json({
      ok: true,
      note: '没有客户开启邮件同步（clients.leads_config.mailchimp_enabled）',
      synced: [],
    })
  }

  const synced: Array<Record<string, unknown>> = []
  for (const c of targets) {
    try {
      const r = await syncMailchimpActivity({ clientId: c.id as string, apiKey })
      synced.push({ client: c.name, ...r })
    } catch (err) {
      // 一个客户失败不拖垮其它客户。
      synced.push({ client: c.name, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return NextResponse.json({ ok: true, synced })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return run()
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return run()
}
