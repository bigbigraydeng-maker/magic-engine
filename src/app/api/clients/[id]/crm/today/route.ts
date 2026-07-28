/**
 * GET /api/clients/[id]/crm/today
 *
 * 今天该联系谁。分段和排序全在 lib/crm/segments 里算，这里只负责取数。
 *
 * 一次把这个客户的人和触点全拉出来在内存里分段 —— CTS 现在 335 人 / 634 触点，
 * 这个量级下比在 SQL 里堆窗口函数简单得多，也让分段规则能被单测直接钉住。
 * 到几千人再换成物化视图。
 *
 * 返回按「桶」分组 —— 一次只做一桶。平铺成一条长河的版本在 CTS 真实数据上
 * 就废了：186 人的名单里，最烫的 6 个「客户回话了」被 108 个「打不通」埋掉，
 * 销售看到的还是一大坨，跟他要逃离的 Excel 没区别。
 *
 * Responses:
 *   200  { buckets, offList, counts, totalContacts, todoTotal, generatedAt }
 *   401 / 403 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import {
  todayWorklist,
  segmentCounts,
  segmentContact,
  SEGMENT_ACTION_META,
  type ContactLike,
  type Segment,
} from '@/lib/crm/segments'
import { stageSuppressesWorklist, isMarketingAction } from '@/lib/crm/pipeline'

interface RouteParams {
  params: { id: string }
}

interface ContactRow {
  id: string
  display_name: string | null
  primary_phone: string | null
  primary_email: string | null
  do_not_contact: boolean
  stage: string | null
}

interface TouchRow {
  contact_id: string
  channel: string
  direction: 'inbound' | 'outbound'
  occurred_at: string
  summary: string | null
  metadata: Record<string, unknown> | null
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const [
    { data: contacts, error: cErr },
    { data: touches, error: tErr },
    { data: stageRows },
  ] = await Promise.all([
    supabaseAdmin
      .from('contacts')
      .select('id, display_name, primary_phone, primary_email, do_not_contact, stage')
      .eq('client_id', clientId)
      .limit(5000),
    supabaseAdmin
      .from('contact_touchpoints')
      .select('contact_id, channel, direction, occurred_at, summary, metadata')
      .eq('client_id', clientId)
      .order('occurred_at', { ascending: false })
      .limit(20000),
    supabaseAdmin
      .from('client_pipeline_stages')
      .select('stage_key, label, marketing_action, is_terminal')
      .eq('client_id', clientId),
  ])

  if (cErr || tErr) {
    return NextResponse.json({ error: cErr?.message ?? tErr?.message }, { status: 500 })
  }

  const byContact = new Map<string, TouchRow[]>()
  for (const t of (touches ?? []) as TouchRow[]) {
    const list = byContact.get(t.contact_id) ?? []
    list.push(t)
    byContact.set(t.contact_id, list)
  }

  // 阶段 map:决定这个人还该不该出现在今天的名单上（成交 / 转售后 / 停止营销 → 不该）。
  const stageMeta = new Map<string, { label: string; suppressed: boolean; action: string }>()
  for (const s of (stageRows ?? []) as {
    stage_key: string
    label: string
    marketing_action: string
    is_terminal: boolean
  }[]) {
    stageMeta.set(s.stage_key, {
      label: s.label,
      action: s.marketing_action,
      // 认不出来的动作（DB 加了新值而代码还没跟上）当「停止营销」处理，宁可少打一通。
      suppressed: stageSuppressesWorklist(
        isMarketingAction(s.marketing_action) ? s.marketing_action : 'suppress',
        s.is_terminal,
      ),
    })
  }

  const rows = (contacts ?? []) as ContactRow[]
  const models: ContactLike[] = rows.map((c) => {
    const tps = byContact.get(c.id) ?? []
    const stage = c.stage ? stageMeta.get(c.stage) : undefined
    return {
      id: c.id,
      displayName: c.display_name,
      // 「别再联系」的真相源是不可变的触点：contacts 列是尽力维护的反规范化，
      // 它写失败过（或历史数据没有）时，只要任何一条触点说过 DNC，就照样排除。
      // 两种写法都认：新写入走 metadata.do_not_contact，历史导入的 294 条
      // 跟进记录只写了 metadata.outcome（见 scripts/import-cts-fb-leads.ts）。
      // 少打一通电话的代价，远小于打给明确说过别打的人。
      doNotContact:
        c.do_not_contact ||
        tps.some(
          (t) =>
            t.metadata?.do_not_contact === true ||
            t.metadata?.outcome === 'do_not_contact',
        ),
      stageSuppressed: stage?.suppressed ?? false,
      stageLabel: stage?.label ?? null,
      touchpoints: tps.map((t) => ({
        channel: t.channel,
        direction: t.direction,
        occurredAt: t.occurred_at,
        outcome: (t.metadata?.outcome as string) ?? null,
        travelWindow: (t.metadata?.travel_window as string) ?? null,
        callbackAt: (t.metadata?.callback_at as string) ?? null,
      })),
    }
  })

  const now = new Date()
  const contactById = new Map(rows.map((c) => [c.id, c]))

  const ranked = todayWorklist(models, now)

  const toRow = (c: (typeof ranked)[number]) => {
    const row = contactById.get(c.id)
    const last = (byContact.get(c.id) ?? [])[0]
    return {
      contactId: c.id,
      name: c.displayName || '未留姓名',
      phone: row?.primary_phone ?? null,
      email: row?.primary_email ?? null,
      stage: row?.stage ?? null,
      // 认不出的 stage_key（配置里被删掉了）不留空白，显示原值以便排查。
      stageLabel: row?.stage ? (stageMeta.get(row.stage)?.label ?? row.stage) : null,
      segment: c.seg.segment,
      temperature: c.seg.temperature,
      reason: c.seg.reason,
      suggestedChannel: c.seg.suggestedChannel,
      dueAt: c.seg.dueAt,
      lastTouchAt: c.seg.lastTouchAt,
      lastNote: last?.summary ?? null,
    }
  }

  // 按桶返回，不再拉成一条长河。
  //
  // 之前把 4 个段一次全铺、全局截断 100：CTS 真实分布是 6 个「回话了」
  // 混在 108 个「打不通」里，最烫的人被埋掉，销售看到的还是一大坨。
  // 现在一次只做一桶，每桶单独封顶 —— 最大的桶(打不通 108)也装得下。
  const PER_BUCKET_LIMIT = 300
  const ORDER: Segment[] = [
    'replied',
    'callback_due',
    'new_untouched',
    'retry_channel',
    'stale_conversation',
  ]

  const buckets = ORDER.map((segment) => {
    const all = ranked.filter((c) => c.seg.segment === segment)
    const people = all.slice(0, PER_BUCKET_LIMIT).map(toRow)
    const meta = SEGMENT_ACTION_META[segment]
    return {
      segment,
      label: meta.label,
      howTo: meta.howTo,
      batch: meta.batch,
      total: all.length,
      truncated: all.length > people.length,
      people,
      // 整桶一次性群发用。只给「该发邮件」的桶 —— 这批人已经证明电话打不通，
      // 逐个点等于继续做无用功。没邮箱的人不在这里，页面要说出差额。
      batchEmails:
        meta.batch === 'send_email'
          ? people.map((p) => p.email).filter((e): e is string => !!e)
          : [],
    }
  })

  // 不在今天名单上的人（已成交 / 明确拒绝 / 以后才走）也要能找回来。
  // 否则员工一点「已付定金」，这个人就从 ME 唯一的 CRM 页面消失、再也翻不到 ——
  // 而「已付定金」「即将出行」恰恰是最需要继续跟进的两批（催余款、确认行程）。
  // 误点也必须能改回来，所以这里带上他们的当前阶段。
  const off = models
    .map((c) => ({ c, seg: segmentContact(c, now) }))
    .filter((x) => x.seg.temperature === 'cold' || x.seg.temperature === 'off')
    .slice(0, 300)
    .map(({ c, seg }) => {
      const row = contactById.get(c.id)
      const meta = row?.stage ? stageMeta.get(row.stage) : undefined
      return {
        contactId: c.id,
        name: c.displayName || '未留姓名',
        phone: row?.primary_phone ?? null,
        email: row?.primary_email ?? null,
        stage: row?.stage ?? null,
        stageLabel: meta?.label ?? row?.stage ?? null,
        segment: seg.segment,
        reason: seg.reason,
        // 为什么不在今天名单上。成交跟「明确拒绝」混在一堆叫「已排除」很刺眼，
        // 而且成交客户恰恰最该继续维护（催余款、确认行程）—— 页面按这个分开显示。
        group:
          meta?.action === 'won' || meta?.action === 'postsale'
            ? ('won' as const)
            : seg.segment === 'nurture_future'
              ? ('later' as const)
              : ('stop' as const),
        lastNote: (byContact.get(c.id) ?? [])[0]?.summary ?? null,
      }
    })

  // 今天已经动了多少人。没有这个数字，销售打了 15 通电话也看不到自己的进度 ——
  // 名单只会越看越像干不完，明天就不想打开了。
  // 按触点的发生时间算（不是写入时间），补记昨天的电话不会算进今天。
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const doneToday = new Set(
    ((touches ?? []) as TouchRow[])
      .filter((t) => t.direction === 'outbound' && new Date(t.occurred_at) >= startOfDay)
      .map((t) => t.contact_id),
  ).size

  return NextResponse.json({
    buckets,
    offList: off,
    counts: segmentCounts(models, now),
    totalContacts: models.length,
    todoTotal: ranked.length,
    doneToday,
    generatedAt: now.toISOString(),
  })
}
