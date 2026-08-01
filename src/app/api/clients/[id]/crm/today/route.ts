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
  engagementFromMetadata,
} from '@/lib/crm/segments'
import { stageSuppressesWorklist, isMarketingAction } from '@/lib/crm/pipeline'
import { fetchAll } from '@/lib/supabase-paginate'

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
  pinned_at: string | null
}

interface TouchRow {
  contact_id: string
  channel: string
  direction: 'inbound' | 'outbound'
  occurred_at: string
  summary: string | null
  metadata: Record<string, unknown> | null
}

interface StageRow {
  stage_key: string
  label: string
  marketing_action: string
  is_terminal: boolean
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // 必须分页拉全 —— Supabase 单次查询硬顶 1000 行，`.limit(20000)` 会被静默
  // 砍掉且不报错。配合 order desc，丢掉的正是最老的记录：一位客户六月说过
  // 「下个月左右走」，那条排在 1000 名开外，系统就完全看不见他要出行。
  // 实测 CTS：库里 1271 条，limit(20000) 只回 1000 条。
  let contacts: ContactRow[]
  let touches: TouchRow[]
  let stageRows: StageRow[]
  try {
    ;[contacts, touches, stageRows] = await Promise.all([
      fetchAll<ContactRow>((from, to) =>
        supabaseAdmin
          .from('contacts')
          .select('id, display_name, primary_phone, primary_email, do_not_contact, stage, pinned_at')
          .eq('client_id', clientId)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAll<TouchRow>((from, to) =>
        supabaseAdmin
          .from('contact_touchpoints')
          .select('contact_id, channel, direction, occurred_at, summary, metadata')
          .eq('client_id', clientId)
          .order('occurred_at', { ascending: false })
          .range(from, to),
      ),
      fetchAll<StageRow>((from, to) =>
        supabaseAdmin
          .from('client_pipeline_stages')
          .select('stage_key, label, marketing_action, is_terminal')
          .eq('client_id', clientId)
          .order('sort_order', { ascending: true })
          .range(from, to),
      ),
    ])
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '读取失败' },
      { status: 500 },
    )
  }

  // 已发出的行程单 —— 用来提议「已报价」。
  //
  // 这是最值钱的一条提议：行程单工具就在同一个系统里，「发出去了」这个动作
  // 系统自己知道，不需要任何人记得回来改阶段。而「发了报价还停在新询价」
  // 恰恰是手工 CRM 最常烂掉的地方。
  //
  // 按终端客户名匹配（行程单上没有 contact_id）。取不到就算了 —— 提议缺失
  // 只是少一个便利，提议错了才是伤害。
  let quotedNames = new Set<string>()
  try {
    const { data: quotes } = await supabaseAdmin
      .from('tailor_made_itineraries')
      .select('end_client_name, status')
      .eq('client_id', clientId)
      .in('status', ['sent', 'confirmed'])
    quotedNames = new Set(
      (quotes ?? [])
        .map((q) => (q.end_client_name ?? '').trim().toLowerCase())
        .filter(Boolean),
    )
  } catch {
    // 行程单表不存在或读失败：跳过这条提议，其余照常
  }

  const byContact = new Map<string, TouchRow[]>()
  for (const t of touches) {
    const list = byContact.get(t.contact_id) ?? []
    list.push(t)
    byContact.set(t.contact_id, list)
  }

  // 阶段 map:决定这个人还该不该出现在今天的名单上（成交 / 转售后 / 停止营销 → 不该）。
  const stageMeta = new Map<string, { label: string; suppressed: boolean; action: string }>()
  for (const s of stageRows) {
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

  const rows = contacts
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
        // 邮件被打开 / 链接被点 = 行为信号，不是真人消息。分段逻辑必须区分，
        // 否则「打开了邮件」会冒充「客户回话了」挤进最高优先桶。
        engagement: engagementFromMetadata(t.metadata),
      })),
    }
  })

  const now = new Date()
  const contactById = new Map(rows.map((c) => [c.id, c]))

  const ranked = todayWorklist(models, now)

  /**
   * 系统提议改阶段 —— 提议，不自动改。
   *
   * 为什么不自动改：改错了阶段，人得去翻「哪里被改了」，一次就不再信这一页。
   * 提议错了他忽略掉即可，代价不对称。
   *
   * 为什么必须有：阶段目前 100% 靠人点，而 CTS 那份手工 CRM 正是死在这 ——
   * 128 行里「阶段」列 0 个填了，自动提醒退化成 122 条一模一样的红字。
   * 不给提示，这套系统会以同样的方式腐烂一遍。
   *
   * 只做一条高置信度的：客户明确说了不感兴趣 / 别再联系，而阶段还停在
   * 会继续被催的档位 → 提议移到该客户的「停止营销」阶段。
   * 用 marketing_action 而不是写死阶段名 —— 每个客户的阶段是自己配的
   * （诊所叫「不适合治疗」，旅行社叫「已流失」）。
   */
  const suppressStage = stageRows.find(
    (s) => s.marketing_action === 'suppress',
  )

  const suggestStage = (
    c: (typeof ranked)[number],
    currentStage: string | null,
  ): { toStage: string; label: string; why: string } | null => {
    if (!suppressStage) return null
    if (currentStage === suppressStage.stage_key) return null

    const dead = c.touchpoints.some(
      (t) => t.outcome === 'not_interested' || t.outcome === 'do_not_contact',
    )
    if (!dead) return null

    return {
      toStage: suppressStage.stage_key,
      label: suppressStage.label,
      why: '通话记录里客户明确说过不感兴趣 / 别再联系',
    }
  }

  /**
   * 行程单已发出，但阶段还停在「已发行程单」之前 → 提议推进。
   *
   * 用 sort_order 判断「之前」而不是写死 stage_key：每个客户的阶段是自己配的。
   * 找不到名字里带「报价 / 行程单 / quote」的阶段就不提议 —— 猜错了比不提更糟。
   */
  const quoteStage = stageRows.find((st) =>
    /报价|行程单|quote/i.test(st.label) || /quote/i.test(st.stage_key),
  )
  const stageOrder = new Map(stageRows.map((st, i) => [st.stage_key, i]))

  const suggestQuoted = (
    name: string | null,
    currentStage: string | null,
  ): { toStage: string; label: string; why: string } | null => {
    if (!quoteStage || !name) return null
    if (!quotedNames.has(name.trim().toLowerCase())) return null
    if (currentStage === quoteStage.stage_key) return null

    // 已经走得比「已报价」更靠后（已付订金 / 出行中）就别往回拉
    const cur = currentStage ? stageOrder.get(currentStage) : undefined
    const target = stageOrder.get(quoteStage.stage_key)
    if (cur !== undefined && target !== undefined && cur >= target) return null

    return {
      toStage: quoteStage.stage_key,
      label: quoteStage.label,
      why: '行程单已经发给这位客人了',
    }
  }

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
      pinned: Boolean(row?.pinned_at),
      pinnedAt: row?.pinned_at ?? null,
      suggestedStage:
        suggestStage(c, row?.stage ?? null) ??
        suggestQuoted(c.displayName, row?.stage ?? null),
    }
  }

  // 按桶返回，不再拉成一条长河。
  //
  // 之前把 4 个段一次全铺、全局截断 100：CTS 真实分布是 6 个「回话了」
  // 混在 108 个「打不通」里，最烫的人被埋掉，销售看到的还是一大坨。
  // 现在一次只做一桶，每桶单独封顶 —— 最大的桶(打不通 108)也装得下。
  const PER_BUCKET_LIMIT = 300
  // 展示用分桶。
  //
  //「客户回话了」与「该回电了」合成一桶：对销售来说这两批的动作完全一样 ——
  // 今天打这个电话。分成两个名字相近的桶，只是让人在「这俩有什么区别」上
  // 多花一秒。区别保留在每个人卡片下面那行原因里（seg.reason），
  // 那才是有用的粒度：「客户来消息了，已经等了 18 小时」比桶名更能说明问题。
  const GROUPS: Array<{ key: string; members: Segment[] }> = [
    { key: 'following_up',      members: ['replied', 'callback_due'] },
    { key: 'travel_due',        members: ['travel_due'] },
    { key: 'new_untouched',     members: ['new_untouched'] },
    { key: 'retry_channel',     members: ['retry_channel'] },
    { key: 'stale_conversation',members: ['stale_conversation'] },
  ]

  const GROUP_META: Record<string, { label: string; howTo: string }> = {
    following_up: {
      label: '今天要跟进',
      howTo: '客户来了消息，或之前约好今天打 —— 这批最容易成，今天一定要联系。每个人下面写了他为什么在这儿。',
    },
  }

  const buckets = GROUPS.map(({ key, members }) => {
    const all = ranked
      .filter((c) => members.includes(c.seg.segment))
      // 置顶的排最前（多个置顶按最近钉的在上）。只在桶内生效 ——
      // 跨桶置顶会让人脱离「这批该怎么办」的说明，反而不知道要干嘛。
      .sort((a, b) => {
        const pa = contactById.get(a.id)?.pinned_at ?? null
        const pb = contactById.get(b.id)?.pinned_at ?? null
        if (pa && pb) return pb.localeCompare(pa)
        if (pa) return -1
        if (pb) return 1
        return 0
      })
    const people = all.slice(0, PER_BUCKET_LIMIT).map(toRow)
    const base = SEGMENT_ACTION_META[members[0]]
    const meta = { ...base, ...(GROUP_META[key] ?? {}) }
    return {
      segment: key,
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
    touches
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
