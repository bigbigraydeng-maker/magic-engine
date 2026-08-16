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
  segmentCounts,
  segmentContact,
  SEGMENT_ACTION_META,
  type ContactLike,
  type Segment,
  engagementFromMetadata,
  isPhoneVerdict,
  isFailedReach,
  latestIntentVerdict,
  offListGroup,
} from '@/lib/crm/segments'
import { reclassifyStoredOutcome } from '@/lib/crm/note-parser'
import { isDoNotContact, withoutClearedDnc } from '@/lib/crm/dnc'
import { WORKLIST_GROUPS, groupDisplayMeta } from '@/lib/crm/worklist-groups'
import { contactCardTitle } from '@/lib/crm/display-name'
import { followUpMarks, localDay } from '@/lib/crm/follow-up-marks'
import { dayWorklist, localDayStartMs } from '@/lib/crm/day-list'
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
  /** 原话。存量结果值读的时候要靠它重判一次（见 reclassifyStoredOutcome）。 */
  raw: string | null
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

/**
 * 这条电话线通不通 —— **判据跟 `segmentContact` 是同一份**（`isPhoneVerdict`）。
 *
 * 原先这里看「最新的任意一条结果是不是坏号」，跟分段那边不一致：一个只有坏号、
 * 之后又打了一次没人接的人，分段判他「号码打不通」，这里却因为最新一条是
 * `no_answer` 而把他丢进「不要再联系」—— **补号码这件该有人动手的事又一次被
 * 藏起来**（铁律 3：发现不许死在日志里）。
 *
 * `touches` 已按 occurred_at 倒序（见下面的查询），所以第一条判决就是最近那次。
 */
function phoneLineDeadFrom(touches: TouchRow[]): boolean {
  for (const t of touches) {
    const o = t.metadata?.outcome
    if (typeof o === 'string' && isPhoneVerdict(o, t.source)) return o === 'bad_number'
  }
  return false
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
          .select('contact_id, channel, direction, occurred_at, summary, raw, metadata, source')
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
      // 判据只有一份，见 lib/crm/dnc —— 它同时认「人明确纠正过这条判错了」。
      doNotContact: isDoNotContact(
        c.do_not_contact,
        tps.map((t) => ({
          // 存量里「其实是别再联系」的原话，读的时候重判一次 —— 词表改了
          // 存量不会自己回来（见 reclassifyStoredOutcome）。
          outcome:
            reclassifyStoredOutcome((t.metadata?.outcome as string) ?? null, t.raw, {
              direction: t.direction,
              source: t.source,
            }) ?? null,
          flagged: t.metadata?.do_not_contact === true,
          occurredAt: t.occurred_at,
        })),
      ),
      stageSuppressed: stage?.suppressed ?? false,
      stageLabel: stage?.label ?? null,
      // 销售把他推迟了 —— 到期之前不进名单，到期自己回来（见 lib/crm/segments）。
      snoozeUntil: c.snooze_until,
      touchpoints: tps.map((t) => ({
        channel: t.channel,
        direction: t.direction,
        occurredAt: t.occurred_at,
        // 存量记录读的时候顺手重判一次 —— 否则这次的软硬之分只对以后的
        // 笔记生效，已经被埋掉的人永远回不来（见 reclassifyStoredOutcome）。
        outcome: reclassifyStoredOutcome((t.metadata?.outcome as string) ?? null, t.raw) ?? null,
        // 判「电话线通不通」要靠它分清真打通了和手打出来的 spoke（见 isPhoneVerdict）
        source: t.source,
        travelWindow: (t.metadata?.travel_window as string) ?? null,
        callbackAt: (t.metadata?.callback_at as string) ?? null,
        // 邮件被打开 / 链接被点 = 行为信号，不是真人消息。分段逻辑必须区分，
        // 否则「打开了邮件」会冒充「客户回话了」挤进最高优先桶。
        engagement: engagementFromMetadata(t.metadata),
        // 机器发的（群发 / AI 外呼）不算「我们出手」—— 见 day-list 的 needsMeAgain
        automated: isAutomatedTouch(t.source, t.metadata),
        // 销售按的是哪个按钮。**两个值都要如实传下去**，不能把 unsnooze 压成
        // null：判断层除了「清不清推迟」（只认 snooze），还要判「这一笔算不算
        // 我们出手了」（两个都不算 —— 客人那头什么都没收到）。压成 null 的话，
        // 一次「叫回来」会盖住客人当天的回信，把他折叠成已处理（Codex 第六轮）。
        action:
          t.metadata?.action === 'snooze'
            ? ('snooze' as const)
            : t.metadata?.action === 'unsnooze'
              ? ('unsnooze' as const)
              : null,
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

  /**
   * 今天动过谁。
   *
   * 必须在排名单**之前**算好：名单要靠它决定哪张卡是灰的，而灰卡必须留在
   * 原位 —— 这正是 PM 2026-08-05 那句「做完动作回到目录页，我如何知道哪个
   * 已经联系了」要修的东西。
   *
   * 三条排除，三条都是真事故：
   *  · 群发不算（一封 Mailchimp 能把整页标成已跟过）
   *  · 打开/点击不算（那是客人做的，不是我们跟进）
   *  · **推迟 / 取消推迟不算**（Codex 复审 2026-08-15）——
   *    这两个动作也写一笔真人出站触点（为了留痕和冻结判据），但它们是
   *    「安排名单」，不是「联系了这个人」，客人那头什么都没收到。
   *
   *    不排掉的话最刺眼的是**取消推迟**：销售在「不在今天名单上的人」里点
   *    「现在就叫回来」，人回到名单上却**当场是灰的、写着「今天联系过了」**，
   *    还把进度加了一格 —— 他刚刚明明是想把这个人捞回来打电话。
   *
   *    真推迟的那一头不受影响：live 版看得见 `snooze_until`，
   *    `dayRow` 靠 `droppedOff` 照样把他标成已处理（理由写「标了：先放着…」）。
   */
  const todayLocal = localDay(now.toISOString(), timeZone)
  const touchedTodayIds = new Set(
    touches
      .filter(
        (t) =>
          t.direction === 'outbound' &&
          !isAutomatedTouch(t.source, t.metadata) &&
          !engagementFromMetadata(t.metadata) &&
          t.metadata?.action !== 'snooze' &&
          t.metadata?.action !== 'unsnooze' &&
          // 拨到一个空号不算「我们出手了」—— 客人什么都没收到，
          // 该走的备用渠道一次都还没走。判据跟 day-list 共用同一个函数。
          !isFailedReach(t.metadata?.outcome as string | undefined) &&
          localDay(t.occurred_at, timeZone) === todayLocal,
      )
      .map((t) => t.contact_id),
  )

  /**
   * 今天**从「还在名单上」被推进到「不再联系」**的那些人。
   *
   * 冻结副本要靠它把 `stageSuppressed` 清掉，让卡片留在原位变灰。
   *
   * ⚠️ **必须看改之前那个阶段抑不抑制，不能只看「今天改过阶段」**
   * （Codex 复审 2026-08-15）：一个本来就不在名单上的人（已付定金）今天被推到
   * 另一个同样不在名单上的阶段（付清了），光凭「今天改过」就清掉抑制，
   * 冻结版会按历史触点把他判成 warm、**塞进今天要联系的名单** ——
   * 一个已经付清全款的客人跳出来让人去推销他。
   *
   * `from_stage` 为空（第一次挂阶段）当作「本来在名单上」—— 那时他确实在。
   * 一天内改了多次就看**最早那一条**的 from_stage，那才是今天早上的状态。
   * 读不到就当没有：最坏结果是人照旧当天消失（改动前的行为），不会多打电话。
   */
  const stageSuppressedTodayIds = new Set<string>()
  /** 已经看过今天第一条变更的人 —— 后面的都不看了。 */
  const seenStageEvent = new Set<string>()
  try {
    /**
     * 🔴 **这一条必须分页拉全**（子牙复审 2026-08-16）。
     *
     * Supabase 单次查询硬顶 1000 行、被砍还不报错（本文件上面那几个查询都
     * 因此走了 `fetchAll`）。这一条原先漏了。
     *
     * 以前不容易触发：一天没那么多人改阶段。但「读往来记录自动填阶段」上线后，
     * 每小时最多写 60 条阶段变更，一天可以过千 —— 而这里是**正序**，被砍掉的
     * 正是当天最新那些。后果是下午被改过阶段的人拿不到 `stageSuppressedToday`，
     * 冻结副本不清抑制，**卡片在下午凭空消失** —— 正是 day-list 整个文件
     * 存在的理由（PM 2026-08-05：「做完动作回到目录页，我如何知道哪个已经联系了」）。
     */
    const events = await fetchAll<{
      id: string
      contact_id: string
      from_stage: string | null
      created_at: string
    }>((from, to) =>
      supabaseAdmin
        .from('contact_stage_events')
        .select('id, contact_id, from_stage, created_at')
        .eq('client_id', clientId)
        .gte('created_at', new Date(localDayStartMs(now, timeZone)).toISOString())
        // 排序键必须**唯一**（Codex 复审 2026-08-16）：并列的 created_at 在
        // 两次 range 请求之间可以换序，页与页之间就会重复或漏行。漏掉某人
        // 当天最早那条变更，`stageSuppressedTodayIds` 就算错，卡片照旧消失。
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    )

    for (const e of events ?? []) {
      const cid = e.contact_id as string
      // 只认今天最早那一条 —— 后面的 from_stage 已经是今天改过之后的状态了。
      if (seenStageEvent.has(cid)) continue
      seenStageEvent.add(cid)
      const from = e.from_stage as string | null
      const wasOnList = !from || !(stageMeta.get(from)?.suppressed ?? false)
      if (wasOnList) stageSuppressedTodayIds.add(cid)
    }
  } catch (err) {
    console.error('[crm/today] 读今天的阶段变更失败，按「没改过」算:', err)
  }

  /**
   * 今天这份名单**一天之内不变**（判据见 lib/crm/day-list）。
   *
   * 跟原来的 `todayWorklist` 只差一条：分批按「今天开工那一刻」算，
   * 于是今天做的动作不会把任何人挪走或挪没 —— 处理过的就地变灰留在原位。
   * 客人今天的动作照常实时进来（今天进线的当天就上名单，今天回话的当场升顶）。
   */
  const ranked = dayWorklist(
    models.map((m) => ({ ...m, stageSuppressedToday: stageSuppressedTodayIds.has(m.id) })),
    now,
    {
      dayStartMs: localDayStartMs(now, timeZone),
      touchedToday: (id) => touchedTodayIds.has(id),
    },
  )

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
  /**
   * 一条阶段提议。`stillFollowed` 决定**点完之后跟销售怎么说** ——
   *
   * 🔴 这三条提议指向的阶段行为完全不同（Codex 复审 2026-08-16）：
   *   · 停止营销 → 人从名单上收起来
   *   · 短期内不考虑 / 已报价 → **人还在名单上，系统继续跟**
   *
   * 原先三条共用同一句「不用再跟了，明天起在『不用再联系』那一栏找他」。
   * 对后两条来说那是**反话**：销售照着去那一栏找人，找不到；或者信了这句话
   * 不再管他，而系统其实还在跟。判据用 `stageSuppressesWorklist`，
   * 跟名单本身用的是同一个函数，不另写一套。
   */
  interface StageSuggestion {
    toStage: string
    label: string
    why: string
    /** true = 点完之后这个人**照旧留在名单上**，系统继续跟。 */
    stillFollowed: boolean
  }

  const suppressStage = stageRows.find(
    (s) => s.marketing_action === 'suppress',
  )
  /**
   * 「短期内不考虑」那一档 —— 客户自己配的名字，按 marketing_action 找。
   *
   * PM 2026-08-16 给的业务事实：leads 聊过之后有「暂时不感兴趣、还要继续营销」
   * 和「明确不要了」两种，下场必须不一样。上面那条只覆盖了后者。
   */
  const deferStage = stageRows.find((s) => s.marketing_action === 'defer')

  const suggestStage = (
    c: (typeof ranked)[number],
    currentStage: string | null,
  ): StageSuggestion | null => {
    if (!suppressStage) return null
    if (currentStage === suppressStage.stage_key) return null

    /**
     * 🔴 **已经被人推翻过的拒联判词不许再拿来建议**（Codex 复审 2026-08-16）。
     *
     * 不滤的话会出现一个直接反噬的循环：FDE 刚点完「这条判错了，放回名单」，
     * 这个人第二天一出现在名单上，系统立刻建议把他改到「停止营销」——
     * 跟他刚做的纠正正好相反。他顺手一点，人又被永久埋回去，白干一场。
     * 跟 `segments.ts` 用**同一个**函数。
     */
    const dead = withoutClearedDnc(c.touchpoints).some(
      (t) => t.outcome === 'not_interested' || t.outcome === 'do_not_contact',
    )
    if (!dead) return null

    return {
      toStage: suppressStage.stage_key,
      label: suppressStage.label,
      why: '通话记录里客户明确说过不感兴趣 / 别再联系',
      stillFollowed: !stageSuppressesWorklist(
        isMarketingAction(suppressStage.marketing_action) ? suppressStage.marketing_action : 'suppress',
        suppressStage.is_terminal,
      ),
    }
  }

  /**
   * 「他说现在先不考虑」→ 提议移到「短期内不考虑」那一档。
   *
   * 这是**阶段自己填自己**的第一块：系统已经在读每一通电话，读到这句话就该
   * 把人放到对的格子里，而不是等谁记得回来手填。CTS 583 个人里 556 个阶段
   * 是空的 —— 靠人填的状态列一定会烂（那份 128 行的手工 CRM 就是这么死的）。
   *
   * 仍然只是**提议**：卡片上出现一个按钮，人点一下才生效。AI 读错的代价
   * 不该由客户承担。
   */
  const suggestDeferred = (
    c: (typeof ranked)[number],
    currentStage: string | null,
  ): StageSuggestion | null => {
    if (!deferStage) return null
    if (currentStage === deferStage.stage_key) return null
    // 🔴 判据必须跟 `segmentContact` 用**同一个函数**（Codex 复审 2026-08-16）。
    //
    // 原先这里取「最近一次的任意结果」：这个人按建议收到一封群发之后，
    // 群发写下的那笔兜底 `spoke` 会更晚，于是分段那边靠 latestIntentVerdict
    // 照旧把他留在「交给系统跟」，而这条提议**当场消失** —— 同一件事两处
    // 判法不同，页面自相矛盾。今天已经在别处栽过两次，这次不再写第二套。
    if (latestIntentVerdict(c.touchpoints) !== 'not_interested_now') return null

    return {
      toStage: deferStage.stage_key,
      label: deferStage.label,
      why: '通话记录里他说现在先不考虑 —— 不是不要了，过阵子还该跟',
      stillFollowed: !stageSuppressesWorklist(
        isMarketingAction(deferStage.marketing_action) ? deferStage.marketing_action : 'suppress',
        deferStage.is_terminal,
      ),
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
  ): StageSuggestion | null => {
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
      stillFollowed: !stageSuppressesWorklist(
        isMarketingAction(quoteStage.marketing_action) ? quoteStage.marketing_action : 'suppress',
        quoteStage.is_terminal,
      ),
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
      /**
       * 今天已经动过他了 —— 卡片当场变浅，不用靠记。
       *
       * 取 day-list 算出来的那个，不是 `marks.doneToday`：后者只认「发出过
       * 联系」，而「他不买了 / 号码是坏的」的结论写在触点的 outcome 上，
       * 冻结版看不见 —— 那几个人会留在原地并且看起来没被处理过。
       *
       * 「推迟」和「推到成交」同样就地变灰（原 M2.7a 缺口，2026-08-15 补上）：
       * 推迟那一笔触点带 `action:'snooze'`，改阶段看今天那条变更记录的
       * `from_stage`（**只有改之前还在名单上的才算**，见上面 stageSuppressedTodayIds
       * 那段），冻结副本据此把这两样清掉 —— 详见 `withoutOurActionsSince`。
       */
      doneToday: c.handled,
      /** 是怎么处理的（今天联系过了 / 标了：他说不买了…）。没处理就是 null。 */
      handledWhy: c.handledWhy,
      /** 「跟进了」还是「关掉了」—— 两个数字必须分开显示，见 day-list 里的说明。 */
      handledKind: c.handledKind,
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
      /**
       * 卡片正文那句话。
       *
       * 已处理的人用 `handledWhy`，**不能用冻结版那句** —— 冻结版是「假装我们
       * 今天什么都没做」算出来的，于是一张卡上会同时写着「✓ 今天联系过了」
       * 和「客户来消息了，已经等了 18 小时」，而那个小时数还会**整天变大**。
       * 两个销售共用这块屏时，第二个人看到「客户等了 18 小时」会再回一遍。
       */
      reason: c.handled && c.handledWhy ? c.handledWhy : c.seg.reason,
      suggestedChannel: c.seg.suggestedChannel,
      /** 号码在库里但打不通 —— 卡片靠它把「没留电话」和「号是坏的」分开说。 */
      phoneUnusable: c.seg.phoneUnusable ?? false,
      /** 被标成「别再联系」—— 抽屉靠它给出取消入口（早前判词误判过一批人）。 */
      doNotContact: c.doNotContact === true,
      dueAt: c.seg.dueAt,
      lastTouchAt: c.seg.lastTouchAt,
      lastNote: last?.summary ?? null,
      pinned: Boolean(row?.pinned_at),
      pinnedAt: row?.pinned_at ?? null,
      /** 被推迟到什么时候。今天名单上的人这里恒为 null —— 推迟的人已经被挡在外面了。 */
      snoozeUntil: row?.snooze_until ?? null,
      suggestedStage:
        suggestStage(c, row?.stage ?? null) ??
        suggestDeferred(c, row?.stage ?? null) ??
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
      //
      // 🔴 **今天已经处理过的人不进群发地址。** 名单改成「一天不变」之后，
      //    处理过的人会留在桶里（就地变灰），而这里原样照抄整桶 ——
      //    于是一个今天亲口说「不买了」的人，当天会收到一封面向他的群发信，
      //    CRM 里还记一笔我们发过。这是 kind-filter 那次事故的翻版：
      //    「名单一旦开始说假话，销售就不再信它」，只是这次从筛选侧挪到了冻结侧。
      batchEmails:
        meta.batch === 'send_email'
          ? people
              .filter((p) => !p.doneToday)
              .map((p) => p.email)
              .filter((e): e is string => !!e)
          : [],
    }
  })

  // 不在今天名单上的人（已成交 / 明确拒绝 / 以后才走）也要能找回来。
  // 否则员工一点「已付定金」，这个人就从 ME 唯一的 CRM 页面消失、再也翻不到 ——
  // 而「已付定金」「即将出行」恰恰是最需要继续跟进的两批（催余款、确认行程）。
  // 误点也必须能改回来，所以这里带上他们的当前阶段。
  //
  // 🔴 **今天还冻结在名单上的人不能同时出现在这里**（Codex 复审 2026-08-15）。
  //    这一栏按**实时**状态算，而名单按冻结状态算 —— 今天刚标了「不买了」/
  //    推迟 / 推到成交的人，实时看已经下名单（进这一栏），冻结看还在名单上
  //    （留在原位变灰）。两边各算各的，同一个人当天**在页面上出现两次**；
  //    搜索时两组直接拼起来，还会撞出重复的 React key。
  //    今天以冻结的那份为准，明天冻结失效他自然落到这一栏。
  const rankedIds = new Set(ranked.map((c) => c.id))
  const off = models
    .filter((c) => !rankedIds.has(c.id))
    .map((c) => ({ c, seg: segmentContact(c, now) }))
    .filter((x) => x.seg.temperature === 'cold' || x.seg.temperature === 'off')
    .slice(0, 300)
    .map(({ c, seg }) => {
      const row = contactById.get(c.id)
      const meta = row?.stage ? stageMeta.get(row.stage) : undefined
      /**
       * 「别再联系」—— 抽屉靠它给取消入口，**分组也必须先看它**（见下面 group）。
       * 提到这里成局部，是因为坏号分组要用同一个值，不能让它只挂在返回对象上。
       */
      const doNotContact = isDoNotContact(
        row?.do_not_contact ?? false,
        (byContact.get(c.id) ?? []).map((t) => ({
          // 存量里「其实是别再联系」的原话读的时候重判一次。
          outcome:
            reclassifyStoredOutcome((t.metadata?.outcome as string) ?? null, t.raw, {
              direction: t.direction,
              source: t.source,
            }) ?? null,
          flagged: t.metadata?.do_not_contact === true,
          occurredAt: t.occurred_at,
        })),
      )
      return {
        contactId: c.id,
        name: contactCardTitle(c.displayName, firstSaid.get(c.id)),
        phone: row?.primary_phone ?? null,
        email: row?.primary_email ?? null,
        stage: row?.stage ?? null,
        stageLabel: meta?.label ?? row?.stage ?? null,
        segment: seg.segment,
        reason: seg.reason,
        /**
         * 号码在库里但打不通 —— **不在名单上的人同样要带**（Codex 复审 2026-08-16）。
         *
         * 不带的话，抽屉里那个值是 `undefined`，照旧渲染成可点的拨号链接 ——
         * 而这一组（`fix_number`）**整组存在的意义就是「这个号打不通，去补一个」**。
         * 点开它就能拨那个已知打不通的号，是这一组里最不该出现的事。
         */
        phoneUnusable: seg.phoneUnusable ?? false,
        /** 被标成「别再联系」—— 抽屉靠它给出取消入口。 */
        doNotContact,
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
        // 🔴 DNC 最先判、压过坏号分组 —— 判据集中在 `offListGroup`，与
        //    `segmentContact` 次序对齐，可被单独直测（见 segments 里那段说明）。
        //    坏号的「同一判据」约束（Codex 复审 2026-08-16）仍在：用
        //    `phoneLineDeadFrom` 而非「最新一条是不是坏号」。
        group: offListGroup({
          doNotContact,
          snoozed: !!(
            row?.snooze_until && new Date(row.snooze_until).getTime() > now.getTime()
          ),
          phoneLineDead: phoneLineDeadFrom(byContact.get(c.id) ?? []),
          won: meta?.action === 'won' || meta?.action === 'postsale',
          nurtureFuture: seg.segment === 'nurture_future',
        }),
        lastNote: (byContact.get(c.id) ?? [])[0]?.summary ?? null,
        kind: kindOf(c.id),
      }
    })

  /**
   * 顶上那条进度**不在这里算**。
   *
   * 服务端这份没按「终端客户 / 同行」筛过，页面默认只看终端客户 ——
   * 直接用会出现「顶上写 120、底下铺 40」这种**数得出来的谎话**。
   * 所以页面从筛后的桶现算（`page.tsx` 的 `dayProgress(shown)`）。
   *
   * 那为什么不在这里按 kind 筛完再算？因为 kind 是**页面上可切的视图**，
   * 服务端不知道人此刻在看哪一个。
   *
   * ⚠️ 之前这里算了 `progress` / `doneToday` 一起返回，页面没人读 ——
   * 一个「有但不许用」的字段是最坏的选项：下一个人看到 `data.progress`
   * 就在手边，十有八九会用上，正好掉进上面那个坑（魏征 2026-08-06 验收）。
   */

  return NextResponse.json({
    buckets,
    offList: off,
    // 在这一页直接回私信时，发出去的话是挂在谁名下的 —— 两个 CTS 邮箱共用
    // 这块屏，发送框要当面说清楚现在是谁在说话（跟私信页同一口径）。
    viewerEmail: access.user.email ?? null,
    counts: segmentCounts(models, now),
    totalContacts: models.length,
    todoTotal: ranked.length,
    generatedAt: now.toISOString(),
  })
}
