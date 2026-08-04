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
import { WORKLIST_GROUPS, groupDisplayMeta } from '@/lib/crm/worklist-groups'
import { contactCardTitle } from '@/lib/crm/display-name'
import { followUpMarks, localDay } from '@/lib/crm/follow-up-marks'
import { stageSuppressesWorklist, isMarketingAction } from '@/lib/crm/pipeline'
import { isAutomatedTouch } from '@/lib/crm/automated-touch'
import { contactKindOf, readDomainRules, type ContactKind } from '@/lib/crm/contact-kind'
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
  snooze_until: string | null
}

interface TouchRow {
  contact_id: string
  channel: string
  source: string | null
  direction: 'inbound' | 'outbound'
  occurred_at: string
  summary: string | null
  metadata: Record<string, unknown> | null
}

/**
 * 这个人最近一次通话的结果。分「号码要修」那一组用。
 *
 * touches 已经按 occurred_at 倒序（见下面的查询），所以第一条带 outcome 的
 * 就是最近的那次。
 */
function latestOutcomeOf(touches: TouchRow[]): string | null {
  for (const t of touches) {
    const o = t.metadata?.outcome
    if (typeof o === 'string' && o) return o
  }
  return null
}

interface IdentityRow {
  contact_id: string
  value: string
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
  let emailIdentities: IdentityRow[]
  let touches: TouchRow[]
  let stageRows: StageRow[]
  try {
    ;[contacts, emailIdentities, touches, stageRows] = await Promise.all([
      fetchAll<ContactRow>((from, to) =>
        supabaseAdmin
          .from('contacts')
          .select('id, display_name, primary_phone, primary_email, do_not_contact, stage, pinned_at, snooze_until')
          .eq('client_id', clientId)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      // 邮箱身份 —— 用来判「终端客户 / 同行 / 自己人」。
      // 不能只看 contacts.primary_email：一个人可以挂多个邮箱，同行的人常常
      // 用私人 Gmail 来问事，而他的公司邮箱才是判据。
      fetchAll<IdentityRow>((from, to) =>
        supabaseAdmin
          .from('contact_identities')
          .select('contact_id, value')
          .eq('client_id', clientId)
          .eq('kind', 'email')
          .order('contact_id', { ascending: true })
          .range(from, to),
      ),
      fetchAll<TouchRow>((from, to) =>
        supabaseAdmin
          .from('contact_touchpoints')
          .select('contact_id, channel, direction, occurred_at, summary, metadata, source')
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

  // 这个客户的「自己人域名 / 同行域名」清单。读不到就当没配 —— 全按终端客户走，
  // 跟这条规则上线之前一模一样，不会因为读配置失败让整块看板打不开。
  let clientRow: { leads_config: unknown } | null = null
  try {
    const { data } = await supabaseAdmin
      .from('clients')
      .select('leads_config')
      .eq('id', clientId)
      .maybeSingle()
    clientRow = data as { leads_config: unknown } | null
  } catch {
    // 同上：读不到就按没配处理
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

  /**
   * 终端客户 / 同行 / 自己人。
   *
   * PM 2026-08-04（客户直接反馈「contact 里面怎么还有工作人员」）定的口径：
   * **同行单独标记、分类；「今天该联系谁」主要还是终端客户。**
   *
   * **自己人在这里就整个丢掉** —— 他们根本不该出现在客人名单的任何位置，
   * 连「不用再联系」那一栏都不该有。同行留着但打上标记，页面默认只看终端客户。
   *
   * 判据全在 lib/crm/contact-kind，按域名算，不存列（域名清单一改就该跟着变）。
   */
  const rules = readDomainRules(clientRow?.leads_config)
  const emailsByContact = new Map<string, string[]>()
  for (const c of contacts) if (c.primary_email) emailsByContact.set(c.id, [c.primary_email])
  for (const i of emailIdentities) {
    const list = emailsByContact.get(i.contact_id) ?? []
    if (!list.includes(i.value)) list.push(i.value)
    emailsByContact.set(i.contact_id, list)
  }
  const kindOf = (id: string): ContactKind =>
    contactKindOf(emailsByContact.get(id) ?? [], rules)

  const rows = contacts.filter((c) => kindOf(c.id) !== 'staff')
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
      // 销售把他推迟了 —— 到期之前不进名单，到期自己回来（见 lib/crm/segments）。
      snoozeUntil: c.snooze_until,
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
      // 这个人实际能怎么被联系到 —— 决定「建议用哪个渠道」落在哪。
      // 私信能力看他有没有 messenger 触点（有触点就说明那条线是通的）。
      hasPhone: !!c.primary_phone,
      hasEmail: !!c.primary_email,
      hasMessenger: tps.some((t) => t.channel === 'messenger'),
    }
  })

  const now = new Date()
  const contactById = new Map(rows.map((c) => [c.id, c]))

  /**
   * 「今天」按客户所在地算，不按服务器。
   *
   * 服务器跑在 UTC，销售在纽西兰（UTC+12/+13）：他上午做完的活，在 UTC 里
   * 还落在昨天；等纽西兰到中午 UTC 跨日，「今天已经跟过」会集体消失 ——
   * 销售会以为系统把他一早的活弄丢了。
   */
  let timeZone = 'Pacific/Auckland'
  try {
    const { data: cli } = await supabaseAdmin
      .from('clients')
      .select('country')
      .eq('id', clientId)
      .maybeSingle()
    if ((cli?.country ?? '').toUpperCase() === 'AU') timeZone = 'Australia/Sydney'
  } catch {
    // 读不到就按 NZ —— 两个客户目前都在纽西兰，猜错也只差两小时。
  }

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

  /**
   * 没名字的人说过的第一句话。
   *
   * CTS 有 13 个人显示「未留姓名」—— 全是从私信进来的，Meta 那边就没给名字。
   * 一排「未留姓名」在看板上等于一排看不出该不该打的人，销售只能一个个点开。
   * 他们说过话，一句「有没有长城的团」比「未留姓名」有用得多。
   *
   * 只为**没有名字**的那几个人查（485 人里 13 个），不给整张表加负担。
   * 查不到就照旧显示「未留姓名」—— 这一块是锦上添花，坏了不能拖垮整页。
   */
  const namelessIds = rows.filter((r) => !(r.display_name ?? '').trim()).map((r) => r.id)
  const firstSaid = new Map<string, string>()
  if (namelessIds.length > 0) {
    try {
      const { data: convos } = await supabaseAdmin
        .from('conversations')
        .select('id, contact_id')
        .eq('client_id', clientId)
        .in('contact_id', namelessIds)

      const convoIds = (convos ?? []).map((c) => c.id as string)
      const convoToContact = new Map((convos ?? []).map((c) => [c.id as string, c.contact_id as string]))
      if (convoIds.length > 0) {
        const { data: msgs } = await supabaseAdmin
          .from('conversation_messages')
          .select('conversation_id, body, sent_at')
          .in('conversation_id', convoIds)
          // 只认客人自己说的 —— 我们的自动欢迎语人人一样，
          // 拿它当标题会让十几张卡长得一模一样。
          .eq('direction', 'inbound')
          .order('sent_at', { ascending: true })

        for (const m of msgs ?? []) {
          const contactId = convoToContact.get(m.conversation_id as string)
          // 正序遍历 + 只记第一次 = 每个人取他最早说的那句。
          if (contactId && !firstSaid.has(contactId) && (m.body ?? '').trim()) {
            firstSaid.set(contactId, m.body as string)
          }
        }
      }
    } catch {
      // 取不到就算了，下面会退回「未留姓名」
    }
  }

  const toRow = (c: (typeof ranked)[number]) => {
    const row = contactById.get(c.id)
    const last = (byContact.get(c.id) ?? [])[0]
    // 早上打开这一页要一眼看懂：今天动过没有、上次谁跟的、聊到哪了。
    const marks = followUpMarks(
      (byContact.get(c.id) ?? []).map((t) => ({
        direction: t.direction,
        occurredAt: t.occurred_at,
        summary: t.summary,
        engagement: engagementFromMetadata(t.metadata),
        loggedBy: (t.metadata?.logged_by as string | null) ?? null,
        automated: isAutomatedTouch(t.source, t.metadata),
      })),
      now,
      timeZone,
    )
    return {
      /** 今天已经有人联系过他 —— 卡片当场变浅，不用靠记。 */
      doneToday: marks.doneToday,
      /** 上次是谁跟的。不知道就是 null，页面不假装。 */
      lastBy: marks.lastBy,
      /** 他打开过邮件、之后没人跟。只做提示，不参与排序（打开可能是 Apple 替他开的）。 */
      openedDaysAgo: marks.openedDaysAgo,
      /**
       * 终端客户还是同行。**只做标记和筛选，不参与分批和排序** ——
       * 一个同行今天该不该被联系，判据跟散客完全一样（他有没有开口、等了多久）。
       */
      kind: kindOf(c.id),
      contactId: c.id,
      name: contactCardTitle(c.displayName, firstSaid.get(c.id)),
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
      /** 被推迟到什么时候。今天名单上的人这里恒为 null —— 推迟的人已经被挡在外面了。 */
      snoozeUntil: row?.snooze_until ?? null,
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
  // 展示用分桶在 lib/crm/worklist-groups 里，不在这个文件里 —— 它漏一行就会让
  // 整段客人从页面上消失（2026-08-02 的 33 人事故），必须能被测试钉住。
  const buckets = WORKLIST_GROUPS.map(({ key, members, layer }) => {
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
    const meta = groupDisplayMeta({ key, members, layer })
    return {
      segment: key,
      // 这一列在页面上属于哪一层（要人做的 / 刚有动作的 / 先放着的）。
      layer,
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
        name: contactCardTitle(c.displayName, firstSaid.get(c.id)),
        phone: row?.primary_phone ?? null,
        email: row?.primary_email ?? null,
        stage: row?.stage ?? null,
        stageLabel: meta?.label ?? row?.stage ?? null,
        segment: seg.segment,
        reason: seg.reason,
        // 为什么不在今天名单上。成交跟「明确拒绝」混在一堆叫「已排除」很刺眼，
        // 而且成交客户恰恰最该继续维护（催余款、确认行程）—— 页面按这个分开显示。
        /** 被推迟到什么时候。有值 = 他是被人手推迟的，不是被规则排除的。 */
        snoozeUntil: row?.snooze_until ?? null,
        /**
         * 号码是坏的 —— 这一条要单独拎出来。
         *
         * 它以前跟「明确拒绝」混在同一堆「不用再联系」里，于是一个**只是号码
         * 抄错了**的真客人被永久静默排除，没有任何地方提醒谁去补一个对的号码。
         * 交给自动跟进也没用：号码是坏的，SOP 再激活也发不出去。
         * 单独成组 = 变成一件人能动手修的事（铁律 3）。
         */
        // 「被推迟」必须能跟「已停止」分开。混在一起的话，销售想把一个人提前
        // 叫回来就无从下手 —— 他会在一堆「明确拒绝」里找一个自己上周放一放的人。
        group:
          row?.snooze_until && new Date(row.snooze_until).getTime() > now.getTime()
            ? ('snoozed' as const)
            : latestOutcomeOf(byContact.get(c.id) ?? []) === 'bad_number'
              ? ('fix_number' as const)
              : meta?.action === 'won' || meta?.action === 'postsale'
                ? ('won' as const)
                : seg.segment === 'nurture_future'
                  ? ('later' as const)
                  : ('stop' as const),
        lastNote: (byContact.get(c.id) ?? [])[0]?.summary ?? null,
        kind: kindOf(c.id),
      }
    })

  /**
   * 今天已经动过多少人。没有这个数字，销售打了 15 通电话也看不到自己的进度 ——
   * 名单只会越看越像干不完，明天就不想打开了。按触点的**发生时间**算
   * （不是写入时间），补记昨天的电话不会算进今天。
   *
   * 两处曾经算错，都会让这个数字骗人：
   *  · 按服务器（UTC）的日子算 —— 纽西兰上午做的活，到中午 UTC 跨日会集体
   *    清零，销售以为系统把他一早的活弄丢了。
   *  · 把 Mailchimp 群发算进去 —— 一封群发能让这个数字跳到几百，而实际上
   *    没有任何一个人被真的跟过。
   */
  const today = localDay(now.toISOString(), timeZone)
  const doneToday = new Set(
    touches
      .filter(
        (t) =>
          t.direction === 'outbound' &&
          !isAutomatedTouch(t.source, t.metadata) &&
          !engagementFromMetadata(t.metadata) &&
          localDay(t.occurred_at, timeZone) === today,
      )
      .map((t) => t.contact_id),
  ).size

  return NextResponse.json({
    buckets,
    offList: off,
    // 在这一页直接回私信时，发出去的话是挂在谁名下的 —— 两个 CTS 邮箱共用
    // 这块屏，发送框要当面说清楚现在是谁在说话（跟私信页同一口径）。
    viewerEmail: access.user.email ?? null,
    counts: segmentCounts(models, now),
    totalContacts: models.length,
    todoTotal: ranked.length,
    doneToday,
    generatedAt: now.toISOString(),
  })
}
