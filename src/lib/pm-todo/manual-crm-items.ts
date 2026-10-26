/**
 * CRM 侧的人工待办（从 manual-items.ts 拆出，Round 1）：
 * 付款待确认、拒联复核、私信疑似拒联。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { daysAgo, type ManualItem } from './manual-item-types'
import { findMessengerStopSignals } from '@/lib/crm/messenger-stop-signal'
import { dropAlreadyPaidTagged } from '@/lib/mailchimp/paid-review-filter'
import { isDoNotContact, type DncTouch } from '@/lib/crm/dnc'
import { countReviewCallsByClient } from '@/lib/telephony/review-calls'
import { contactCardTitle } from '@/lib/crm/display-name'

/** Mailchimp 后台的联系人页 —— 登录后一定打得开的稳定入口。 */
const MAILCHIMP_AUDIENCE_URL = 'https://admin.mailchimp.com/audience/contacts/'

/**
 * 客人像是说他付款了，但**不是我们自己确认的** → 下发给人核一眼。
 *
 * 为什么不自动打标签：`mailchimp/paid-signal` 里那条红线 —— 一封写着
 * 「I'll transfer tomorrow」或者甩了张回单截图的邮件，不等于钱到账。看账不看话。
 * 错打一个 `paid_customer`，这个正在谈的客人会被停掉全部跟进邮件，这单就丢了。
 *
 * 所以这一档只能是人工：Baker 去银行对一眼，到账了就在 Mailchimp 点上标签。
 *
 * 数据来自 `mailchimp-paid-tagging` cron 写进 `cron_run_logs.summary.needsReview`
 * —— 不为它单开一张表（新表要 migration，而这条信息本来就是那次运行的产物）。
 */
export async function pushPaidSignalReviewItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  /**
   * 看**最近 7 天所有跑完的非预演运行**，按邮箱去重 —— 不是「最近一次」。
   *
   * 首版写的是 limit(1)，子牙复审指出三个具体漏法，每一个都会让待办静默消失：
   *
   *   1. **漏发**：日常只回溯 3 天。一条待确认在第 1 天出现、Baker 三天没处理，
   *      第 4 天的运行已经扫不到那封信 → 待办凭空消失，再没人看见。
   *      铁律 3 下半在第 4 天失效 —— 管道断头。
   *   2. **被冲掉**：`?dry=1&days=365` 写的是同一个 job_name 的行。PM 跑一次预演，
   *      待办被一年历史刷满；5:10 的 daily 一跑又全换掉。两个方向都不是预期。
   *   3. **读到半截**：不筛 status 的话，最新一行可能是 `running`（summary 还是
   *      null）→ 当天待办静默为空。cron 5:10 跑、今日待办也是早上生成，撞上概率不低。
   *
   * 去重之后，多看几次运行反而比只看一次轻 —— 同一个人不会出现两遍。
   *
   * 彻底的「人处理完就消失」需要一张 ack 表，那是 A 级改动，不塞进这个 PR。
   */
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('summary, started_at, status')
    .eq('job_name', 'mailchimp-paid-tagging')
    .eq('status', 'completed')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(30)

  if (error) throw new Error(`cron_run_logs query failed: ${error.message}`)

  const rows: unknown[] = []
  const seen = new Set<string>()
  for (const run of (data ?? []) as Array<{ summary?: { needsReview?: unknown; dryRun?: unknown } | null }>) {
    // 预演不是真运行 —— 它的结果不该变成任何人的待办。
    if (run.summary?.dryRun === true) continue
    const list = Array.isArray(run.summary?.needsReview) ? run.summary.needsReview : []
    for (const item of list) {
      const email = typeof (item as { email?: unknown })?.email === 'string' ? (item as { email: string }).email : ''
      const clientId = typeof (item as { clientId?: unknown })?.clientId === 'string'
        ? (item as { clientId: string }).clientId : ''
      const key = `${clientId}::${email.trim().toLowerCase()}`
      if (!email.trim() || seen.has(key)) continue
      seen.add(key)
      rows.push(item)
    }
  }

  /**
   * 🔴 按 Mailchimp **当前**标签再过滤一次（Codex P1 复审 PR #1484）。
   *
   * 上面那 7 天窗口是有原因的（见本函数头注的三个漏法），不能砍。但它带来一个
   * 后果：PM 今天处理完，今天的 summary 里确实没他了，**昨天的 summary 里还在**，
   * 于是同一条待办天天重新冒出来，直到旧日志滚出窗口 —— 写入侧那道过滤
   * （`runPaidTagging`）管不到已经落库的历史摘要。
   *
   * 所以在生成待办的这一刻，按真实标签状态再判一次。查不到 / 出错一律保留
   * （fail-open）—— 漏掉一条真待处理的付款确认，客人会继续收到营销邮件。
   */
  // 🔴 必须先过滤再截取 20 条（Codex P1 复审 PR #1484）。
  // 之前是先 slice(0, 20) 再过滤已处理：如果最近 7 天去重后超过 20 个候选人，
  // 且排在前 20 个的历史候选恰好已经被 PM 打过标签，这里会把它们连着这次机会
  // 一起删掉，却从不去看第 21 条之后仍未处理的人 —— 那些人就再也不会被下发。
  const allCandidates = rows.map((raw) => {
    const r = raw as { email?: unknown; clientId?: unknown }
    return {
      email: typeof r.email === 'string' ? r.email : '',
      clientId: typeof r.clientId === 'string' ? r.clientId : '',
      raw,
    }
  })
  const keepable = await dropAlreadyPaidTagged(
    supabase,
    allCandidates.filter((c) => c.email && c.clientId),
  ).catch((e) => {
    console.warn('[manual-items] 付款待确认的已处理过滤失败（保留全部，不静默丢）:', e)
    return allCandidates.filter((c) => c.email && c.clientId).map((c) => ({ ...c, paidTag: undefined }))
  })
  const keepKeys = new Map(keepable.map((c) => [
    `${c.clientId}::${c.email.trim().toLowerCase()}`, c,
  ]))
  // 没有 clientId 的记录过滤不了（判不出用哪个 audience）—— 一律保留
  const toEmit = allCandidates
    .filter((c) => !c.clientId || !c.email || keepKeys.has(`${c.clientId}::${c.email.trim().toLowerCase()}`))
    .slice(0, 20)

  for (const { raw } of toEmit) {
    const r = raw as {
      email?: unknown
      name?: unknown
      evidence?: unknown
      receivedAt?: unknown
      clientId?: unknown
      clientName?: unknown
    }
    const email = typeof r.email === 'string' ? r.email : ''
    if (!email) continue
    const who = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : email
    const quote = typeof r.evidence === 'string' ? r.evidence.trim() : ''
    const days = daysAgo(typeof r.receivedAt === 'string' ? r.receivedAt : null, now)
    const when = days === null ? '' : days === 0 ? '今天' : `${days} 天前`

    const paidTag = keepKeys.get(`${typeof r.clientId === 'string' ? r.clientId : ''}::${email.trim().toLowerCase()}`)?.paidTag
    const tagInstruction = paidTag ? `${paidTag} 标签` : '该客户配置的已付款标签（先在客户设置核对标签名）'

    items.push({
      kind: 'paid_signal_needs_review',
      client_id: typeof r.clientId === 'string' ? r.clientId : 'infra',
      client_name: typeof r.clientName === 'string' ? r.clientName : 'Magic Engine 后台',
      // 原话逐字带上 —— 人一眼就知道该不该信，不用回邮箱翻
      what: `${who}${when ? `（${when}）` : ''}像是说他付款了${quote ? `：「${quote}」` : ''} —— 但这是他自己说的，不是我们确认到账，所以系统没敢自动标成已付款客户。不标的话，他还会继续收到招揽邮件`,
      how: `去银行流水核一眼钱到了没有。到了就在 Mailchimp 搜这个邮箱，给他加上 ${tagInstruction}（加完他就自动退出群发名单了）；没到就不用管`,
      href: MAILCHIMP_AUDIENCE_URL,
    })
  }
}

/**
 * 可能被误判成「永久别再联系」的人。
 *
 * 🔴 **这一条是刻意不自动化的**（PM 2026-08-16）。
 *
 * 旧的判词把「not intending to go」（我不打算去）当成了「别再联系我」，而
 * `contacts.do_not_contact` 是全系统最重的一个标记：**任何渠道都不许再发**。
 * 词表已经改好，新写的备注不会再落这个坑，但**存量那几个人不会自己回来**。
 *
 * 为什么不写自动解除：本仓一贯的判断是「漏判是骚扰，误判只是少打一通」。
 * 让一段正则去**解开**这个闸，方向恰好反了 —— 万一某人原话里同时含着真正的
 * 拒绝，我们就会去骚扰一个明确说过别联系的客人。这是客户红线，不该由规则来赌。
 *
 * 所以按铁律 3 的下半条办：**确实不该自动化，就下发成人工任务，且进同一个管道**。
 * 判据只挑「原话里只有『不打算去』、没有任何划界限说法」的那些 —— 真的说过
 * 「别再联系 / 不要打电话 / 只邮件联系」的人不在里面，不会被打扰。
 */
interface ContactRowForDnc {
  id: string
  client_id: string
  display_name: string
  do_not_contact?: boolean
}

export async function pushDncReviewItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  ids: string[],
  nameOf: (id: string) => string,
): Promise<void> {
  if (ids.length === 0) return

  /**
   * 候选人从**两头**取（Codex 复审 2026-08-16）：
   *
   *   · 镜像列 `do_not_contact = true` 的
   *   · 触点里说过拒联的 —— 那才是真相源
   *
   * 只按镜像列筛会漏掉最该被复核的一批：写触点成功、镜像列那一步失败的人。
   * 那种半写入状态确实存在（取消接口正因为它才回 500），而这些人恰恰
   * **被今日名单和分段当成拒联继续排除着** —— 漏了他们，这条任务就白设了。
   */
  const { data: flaggedRows } = await supabase
    .from('contacts')
    .select('id, client_id, display_name, do_not_contact')
    .in('client_id', ids)
    .eq('do_not_contact', true)

  const { data: dncTouchRows } = await supabase
    .from('contact_touchpoints')
    .select('contact_id')
    .in('client_id', ids)
    .eq('metadata->>outcome', 'do_not_contact')

  const extraIds = Array.from(
    new Set(((dncTouchRows ?? []) as { contact_id: string }[]).map((t) => t.contact_id)),
  ).filter((id) => !(flaggedRows ?? []).some((c) => (c.id as string) === id))

  let contacts = (flaggedRows ?? []) as ContactRowForDnc[]
  if (extraIds.length > 0) {
    const { data: extra } = await supabase
      .from('contacts')
      .select('id, client_id, display_name, do_not_contact')
      .in('client_id', ids)
      .in('id', extraIds)
    contacts = contacts.concat((extra ?? []) as ContactRowForDnc[])
  }
  if (contacts.length === 0) return

  const { data: touches } = await supabase
    .from('contact_touchpoints')
    // metadata / occurred_at 是给判据用的：有人纠正过「这条判错了」之后，
    // 这条任务不许再冒出来 —— 否则 FDE 每天被同一个已经处理完的人骚扰一次。
    .select('contact_id, raw, metadata, occurred_at')
    .in('contact_id', contacts.map((c) => c.id as string))
  if (!touches) return

  /** 客户真的在划界限的说法 —— 命中任何一条就不算误判，别去打扰。 */
  const BOUNDARY =
    /do not follow up|no need\s*(to\s*)?follow up|do(es)? not want to talk|do not (like|want) (phone|call)|不要.?电话|不需要联系|别再(联系|打)|只邮件联系/i
  const SOFT = /not intending to go/i

  const byContact = new Map<string, string[]>()
  const touchesByContact = new Map<string, DncTouch[]>()
  for (const t of touches) {
    const cid = t.contact_id as string
    const list = byContact.get(cid) ?? []
    if (typeof t.raw === 'string' && t.raw) list.push(t.raw)
    byContact.set(cid, list)

    const meta = (t.metadata ?? {}) as Record<string, unknown>
    const dncList = touchesByContact.get(cid) ?? []
    dncList.push({
      outcome: (meta.outcome as string) ?? null,
      flagged: meta.do_not_contact === true,
      occurredAt: t.occurred_at as string,
    })
    touchesByContact.set(cid, dncList)
  }

  for (const c of contacts) {
    /**
     * 🔴 **别再拿那一列当判据**（Codex 复审 2026-08-16）。
     *
     * `contacts.do_not_contact` 是尽力维护的镜像，写失败过。人已经点过
     * 「判错了，放回名单」、纠正的触点也写好了，只要那一次镜像更新没成功，
     * 这条任务第二天照旧冒出来 —— FDE 会以为自己上次点的按钮是假的。
     * 判据只有一份，见 `lib/crm/dnc`。
     */
    // 镜像列按它**实际的值**传，别写死：只按触点找来的那批，列可能是 false
    // （正是「触点写成功、镜像那一步失败」的那种半写入状态）。
    if (!isDoNotContact(c.do_not_contact === true, touchesByContact.get(c.id as string) ?? [])) {
      continue
    }

    const raws = byContact.get(c.id as string) ?? []
    if (raws.some((r) => BOUNDARY.test(r))) continue
    if (!raws.some((r) => SOFT.test(r))) continue

    const name = contactCardTitle(c.display_name as string | null)
    items.push({
      kind: 'dnc_maybe_wrong',
      client_id: c.client_id as string,
      client_name: nameOf(c.client_id as string),
      what: `${name} 被标成「永久别再联系」，但他原话只说了「不打算去」—— 可能是系统早前判错了，这个人现在收不到我们任何消息`,
      how: '点链接直接就打开他的抽屉了 —— 联系方式下面有一条黄条写着「他被标成别再联系」。先看黄条下面的往来记录，确认他原话只是「不打算去」、没说过「别再打给我」，再点黄条上的「判错了？点这里放回名单」',
      /**
       * 🔴 绝对网址 —— 相对路径会被链接闸判成 broken，整条待办被丢掉
       *    （狄仁杰 2026-08-05 实测 kept=0，理由见 pushCrossClientItems）。
       *
       * 🔴 `?contact=` 这个参数「全部客人」那一页**真的读**（Codex 复审
       *    2026-08-16）：点进去自动打开这个人的抽屉（2026-09-28 B2 起，原来是
       *    就地展开一块），并且那一页就有取消入口。
       *    改这个链接前先确认新落点也满足这两条 —— 否则 FDE 点进去只会看到
       *    一张 583 行的表，还得自己搜名字，进去了也找不到上面说的那个按钮。
       */
      href: `https://app.magicengine.com.au/dashboard/clients/${c.client_id as string}/crm/all?contact=${c.id as string}`,
    })
  }
}

/**
 * 客人在 Facebook 私信里像是说了「别再联系」—— 提示销售去看一眼。
 *
 * 🔴 **只提示，不自动封渠道**（PM 2026-08-17 拍板 B 方案）。判据本身现在还判不准
 * （issue #1019），把 2099 条私信喂进去自动写 `do_not_contact`，代价是一批正常客人
 * 被永久静默排除，而解除只能一个个手动点。风险方向倒过来：判错了浪费销售 10 秒，
 * 判漏了跟今天一样。完整理由见 `lib/crm/messenger-stop-signal.ts` 文件头。
 *
 * 那个模块**一行写操作都没有** —— 这是它的核心纪律，别在这里给它补上。
 */
export async function pushMessengerStopItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  ids: string[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  if (ids.length === 0) return

  const { signals, dropped } = await findMessengerStopSignals(supabase, ids, now)
  if (dropped > 0) {
    // 🔴 上限压掉了多少必须说出来 —— 静默截断会被读成「就这么几条」。
    console.warn(`[manual-items] 私信拒联提示：每客户上限压下 ${dropped} 条，本轮未下发`)
  }
  if (signals.length === 0) return

  const { data: names } = await supabase
    .from('contacts')
    .select('id, display_name')
    .in('id', signals.map((s) => s.contactId))
  const nameById = new Map(
    ((names ?? []) as { id: string; display_name: string | null }[]).map((c) => [
      c.id,
      c.display_name,
    ]),
  )

  for (const s of signals) {
    const who = contactCardTitle(nameById.get(s.contactId))
    items.push({
      kind: 'dm_maybe_stop',
      client_id: s.clientId,
      client_name: nameOf(s.clientId),
      what: `${who} 在 Facebook 私信里说了「${s.quote}」—— 听着像是不想再被联系，但系统读不懂私信，他现在**照常留在名单里**，明天还会被打扰`,
      /**
       * 🔴 **两条路都必须让人留一笔**（Codex 复审 PR #1037，2026-08-17）。
       *
       * 初版写的是「只是这次不想去 → 什么都不用做，这条明天不再冒出来」——
       * 那是假的：光点开链接不写任何东西，抑制条件（那条私信之后有一笔
       * `me_manual` 触点）就不成立，同一条会**连着冒 30 天**。
       *
       * 一条说明不准的人工任务比没有更糟：FDE 照做、发现没用、下次就整栏跳过。
       * 所以两条路都收在「写一句」上 —— 顺带这一笔也成了留痕，
       * 下一个人能看见当初是谁、按什么理由判的。
       */
      how: '点链接直接打开他的抽屉，先把私信原话看完整（同一段对话里可能后面又改口了）。真要停 → 在他的记录里写一句「客户说别再联系」，系统会停掉所有渠道；只是这次不想去 → 写一句「只是这次不去，可以继续联系」。**两种都得写一句**，写完这条才不会再冒出来（没写就等于没人看过，明天还来）',
      /**
       * 🔴 绝对网址 —— 相对路径会被链接闸判成 broken，整条待办被丢掉
       *    （狄仁杰 2026-08-05 实测 kept=0，理由见 pushCrossClientItems）。
       *    `?contact=` 那一页真的读，点进去自动打开这个人的抽屉（同 pushDncReviewItems，
       *    2026-09-28 B2 起是抽屉不是就地展开）。
       */
      href: `https://app.magicengine.com.au/dashboard/clients/${s.clientId}/crm/all?contact=${s.contactId}`,
    })
  }
}

/** 一行 `contacts`（只声明这条待办用得到的列）。 */
interface ImportantDueRow {
  id: string
  client_id: string
  display_name: string | null
  important_note: string
  important_due_at: string
}

/**
 * 客人身上的「⭐重要标记」到期了 —— 员工手工设的「约好周三 3 点回电」这种事。
 *
 * 到期日到了就出现在待办里；员工处理完把 due 日期清掉，明天就不再出现。
 * 判据只看 `important_due_at ≤ 今天` 且 `important_note` 非空 —— 没写原因的
 * 空标记不催（催了也没人知道该做什么）。每人每天最多一条：同 contact_id 只查一行。
 */
export async function pushImportantDueItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  ids: string[],
  nameOf: (id: string) => string,
  now: Date = new Date(),
): Promise<void> {
  if (ids.length === 0) return

  const { data } = await supabase
    .from('contacts')
    .select('id, client_id, display_name, important_note, important_due_at')
    .in('client_id', ids)
    .not('important_note', 'is', null)
    .lte('important_due_at', now.toISOString())

  for (const c of (data ?? []) as ImportantDueRow[]) {
    const note = c.important_note.length > 60 ? `${c.important_note.slice(0, 60)}…` : c.important_note
    items.push({
      kind: 'crm_important_due',
      client_id: c.client_id,
      client_name: nameOf(c.client_id),
      what: `${c.display_name ?? '一位客人'} 上的重要标记到期了：${note}`,
      how: '点链接进去看，处理完把「重要标记」的到期日清掉，明天就不会再出现；不想再看直接把整条标记删了',
      href: `https://app.magicengine.com.au/dashboard/clients/${c.client_id}/crm/all?contact=${c.id}`,
    })
  }
}

/**
 * 电话系统收了通话、但没能自动记进客人档案（待确认 / 没记成）—— 每个客户一条汇总。
 *
 * 三件套：what（几通、后果）、how（怎么处理，具体到点哪里）、href（绝对网址，直达待确认页）。
 * 只读：读失败抛出去，由调用方记警告；不许把「读不到」当成「没有」。
 */
export async function pushPhoneReviewItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  ids: string[],
  nameOf: (id: string) => string,
): Promise<void> {
  const counts = await countReviewCallsByClient(supabase, ids)
  for (const [clientId, n] of counts) {
    if (n <= 0) continue
    items.push({
      kind: 'phone_call_needs_review',
      client_id: clientId,
      client_name: nameOf(clientId),
      what: `有 ${n} 通电话没能自动记进客人档案 —— 客人打来或我们打出去的这几通，销售在客人页上看不到`,
      how: '点链接看是哪几通（时间、方向、号码尾号、为什么待确认）。在「全部客人」里按尾号搜到是谁，就在他档案里记一笔；找不到就新建一位客人再记',
      href: `https://app.magicengine.com.au/dashboard/clients/${clientId}/crm/phone-review`,
    })
  }
}

