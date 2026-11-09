/**
 * 捞出「客人开过口、却没有任何真人动作」的人，做成销售能直接补跟的清单。
 *
 * PM 2026-09-27 要的：这批人可能是**漏掉的生意**。
 *
 * ## 入口判据为什么是「客人开过口」，不是「标着已联系」
 *
 * 第一版只捞 `stage = 'contacted'` 的人 —— 对 CTS 成立（460 人标着已联系），
 * 但拿去跑 NAL 会返回 **0 人**：NAL 197 个人里 168 个**压根没标过任何阶段**
 * （25 个「新线索」、4 个「已报价」、1 个「已成交」，**一个都不在「已联系」**）。
 * 那样跑出来技术上对、业务上没用。
 *
 * 所以入口改成**对两家都成立**的那个：**客人主动开过口（有任何一条 inbound）**。
 * 「标着已联系却查无真人动作」变成里面一个单独标出来的子集 —— 那一组最刺眼，
 * 因为系统明确说过「联系过了」，这些人已经从「今天该联系谁」名单上消失了。
 *
 * ## 判据（跟生产同一套，不另造）
 *
 * 「有真人动作」= 满足任一：
 *   · 有一条出站触点，而 `isAutomatedTouch` 判它不是机器发的（电话、非群发邮件都算）
 *   · 私信会话里 `lastHumanPageReplyAt` 判出有真人回过
 * 两条都不满足 → 进名单。
 *
 * ## 🔴 三条必须挡住的（名单的价值全靠这个）
 *
 * 1. **说过「别再联系」的人不进名单。** 把他们给销售，等于让销售去骚扰一个明确
 *    拒绝过的人 —— 比漏掉一单生意严重得多，而且是我们自己造成的。
 * 2. **推迟中（snooze 未到期）的人不进名单。** 那是「现在别打，到点再说」，
 *    不是「漏了」。
 * 3. **号码坏 / 无任何联系方式的人单独分组，不混进主名单。** 让销售照着一串
 *    打不通的号打，第二次就没人再信这份名单了。
 *
 * ## 输出不进仓库
 *
 * 结果含客人姓名 / 电话 / 邮箱。按客户数据红线，**只写到给定的输出路径，
 * 绝不写进仓库、绝不打印进日志**。脚本本身不含任何客户数据。
 *
 * ## 怎么跑
 *
 * ```bash
 * npx tsx --env-file=/path/to/.env.local scripts/probe-crm-contacted-but-untouched.ts \
 *   [clientId] [输出文件路径]
 * ```
 *
 * 全程只有 SELECT。
 */
import { writeFileSync } from 'fs'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import { isAutomatedTouch } from '@/lib/crm/automated-touch'
import { lastHumanPageReplyAt, type ThreadMessage } from '@/lib/messenger/automation'
import { describeStageActor, stageReasonForDisplay } from '@/lib/crm/actors'

const DEFAULT_CLIENT = 'c0000000-0000-0000-0000-000000000000' // CTS，脚本缺省值不是判据
const CLIENT_ID = process.argv[2] ?? DEFAULT_CLIENT
const OUT = process.argv[3] ?? '/tmp/contacted-but-untouched.md'
/** 长得像邮箱但是机器的发件身份。 */
const BOT_SENDERS = new Set(['governed-reply-agent@magicengine.cloud'])
const IN_CHUNK = 80

interface C {
  id: string
  display_name: string | null
  primary_phone: string | null
  primary_email: string | null
  do_not_contact: boolean
  snooze_until: string | null
  first_seen_at: string
  /** 现在标在哪一档 —— 用来标出「系统说联系过了」那个最刺眼的子集。 */
  stage: string | null
}
interface Tp {
  contact_id: string
  channel: string
  direction: string
  source: string | null
  occurred_at: string
  summary: string | null
  metadata: Record<string, unknown> | null
  attr_ad_name: string | null
  attr_campaign_id: string | null
}
interface Ev { contact_id: string; changed_by: string | null; note: string | null; created_at: string }
interface Conv { id: string; contact_id: string | null }
interface Msg { conversation_id: string; direction: string; body: string | null; sent_at: string }
interface Log { conversation_id: string; sent_by_email: string | null }

const chunk = <T,>(a: readonly T[], n: number): T[][] => {
  const o: T[][] = []
  for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n))
  return o
}
const day = (iso: string | null): string => (iso ? iso.slice(0, 10) : '—')

/**
 * 进线多久了 —— 决定**先打谁**。
 *
 * 一个 3 天内进线、还没人碰过的人，跟一个三个月前的老线索，价值差一个数量级：
 * 前者还记得自己问过什么，后者多半已经在别家订了。给销售一份不排序的名单，
 * 他会从第一行开始打，而第一行不一定是最该打的那个。
 */
function freshness(firstSeenAt: string): { band: string; order: number } {
  const days = (Date.now() - Date.parse(firstSeenAt)) / 86_400_000
  if (days <= 3) return { band: '🔥 3 天内 —— 还烫着，优先打', order: 0 }
  if (days <= 7) return { band: '🟠 4–7 天', order: 1 }
  if (days <= 30) return { band: '🟡 8–30 天', order: 2 }
  return { band: '⚪ 超过 30 天 —— 大概率已经在别家订了', order: 3 }
}

async function main(): Promise<void> {
  const everyone = await fetchAll<C>((f, t) =>
    supabaseAdmin
      .from('contacts')
      .select('id, display_name, primary_phone, primary_email, do_not_contact, snooze_until, first_seen_at, stage')
      .eq('client_id', CLIENT_ID)
      .order('id', { ascending: true })
      .range(f, t),
  )
  const byId = new Map(everyone.map((c) => [c.id, c]))

  const tps = await fetchAll<Tp>((f, t) =>
    supabaseAdmin
      .from('contact_touchpoints')
      .select('contact_id, channel, direction, source, occurred_at, summary, metadata, attr_ad_name, attr_campaign_id')
      .eq('client_id', CLIENT_ID)
      .order('occurred_at', { ascending: false })
      .range(f, t),
  )

  // ── 谁有真人动作 ──────────────────────────────────────────────
  const humanTouch = new Set<string>()
  /** 客人主动开过口的人 —— 这才是「可能漏掉的生意」的入口。 */
  const spokeFirst = new Set<string>()
  const lastAny = new Map<string, string>()
  const sourceOf = new Map<string, string>()
  const whyAuto = new Map<string, string>()
  for (const t of tps) {
    if (!byId.has(t.contact_id)) continue
    if (!lastAny.has(t.contact_id)) lastAny.set(t.contact_id, t.occurred_at)
    if (t.direction === 'inbound') spokeFirst.add(t.contact_id)
    if (t.direction === 'outbound' && !isAutomatedTouch(t.source, t.metadata)) humanTouch.add(t.contact_id)
    // 来源线索：优先广告名，其次表单
    if (!sourceOf.has(t.contact_id)) {
      if (t.attr_ad_name) sourceOf.set(t.contact_id, `广告「${t.attr_ad_name}」`)
      else if (t.channel === 'meta_lead_form') sourceOf.set(t.contact_id, 'Facebook 表单')
    }
    // 机器是靠哪种往来标上的：记下最近一条「不是真人做的」往来
    if (!whyAuto.has(t.contact_id) && (t.direction === 'inbound' || isAutomatedTouch(t.source, t.metadata))) {
      const who = t.direction === 'inbound' ? '客人自己发来' : '系统发出'
      whyAuto.set(t.contact_id, `${who}的${t.channel}（${day(t.occurred_at)}）`)
    }
  }

  const convs = await fetchAll<Conv>((f, t) =>
    supabaseAdmin.from('conversations').select('id, contact_id').eq('client_id', CLIENT_ID).range(f, t),
  )
  const convOf = new Map<string, string>()
  for (const c of convs) if (c.contact_id && byId.has(c.contact_id)) convOf.set(c.id, c.contact_id)

  const logs: Log[] = []
  const msgs: Msg[] = []
  for (const part of chunk([...convOf.keys()], IN_CHUNK)) {
    const l = await supabaseAdmin
      .from('conversation_outbound_log')
      .select('conversation_id, sent_by_email')
      .in('conversation_id', part)
    if (l.error) throw new Error(l.error.message)
    logs.push(...((l.data ?? []) as Log[]))
    const m = await supabaseAdmin
      .from('conversation_messages')
      .select('conversation_id, direction, body, sent_at')
      .in('conversation_id', part)
      .limit(20000)
    if (m.error) throw new Error(m.error.message)
    msgs.push(...((m.data ?? []) as Msg[]))
  }
  const humanViaMe = new Set<string>()
  for (const l of logs) {
    const e = (l.sent_by_email ?? '').toLowerCase()
    if (e.includes('@') && !BOT_SENDERS.has(e)) humanViaMe.add(l.conversation_id)
  }
  const threads = new Map<string, ThreadMessage[]>()
  for (const m of msgs) {
    const list = threads.get(m.conversation_id) ?? []
    list.push({
      direction: m.direction === 'inbound' ? 'inbound' : 'outbound',
      body: m.body ?? '',
      sentAt: m.sent_at,
      tags: [],
      sentByHumanViaMe: humanViaMe.has(m.conversation_id) ? true : undefined,
    })
    threads.set(m.conversation_id, list)
  }
  for (const [cid, list] of threads) {
    const p = convOf.get(cid)
    if (!p) continue
    if (lastHumanPageReplyAt(list) !== null) humanTouch.add(p)
    // 私信里客人自己发过话，同样算「开过口」（NAL 的人几乎全是这一类）
    if (list.some((m) => m.direction === 'inbound')) spokeFirst.add(p)
  }

  // ── AI 当时给的理由（最值钱的一列：凭哪句话判的） ──────────────
  const evs = await fetchAll<Ev>((f, t) =>
    supabaseAdmin
      .from('contact_stage_events')
      .select('contact_id, changed_by, note, created_at')
      .eq('client_id', CLIENT_ID)
      .eq('to_stage', 'contacted')
      .order('created_at', { ascending: false })
      .range(f, t),
  )
  const verdict = new Map<string, Ev>()
  for (const e of evs) if (!verdict.has(e.contact_id)) verdict.set(e.contact_id, e)

  // ── 分组 ───────────────────────────────────────────────────────
  const untouched = everyone.filter((c) => spokeFirst.has(c.id) && !humanTouch.has(c.id))
  const now = Date.now()
  const dnc = untouched.filter((c) => c.do_not_contact)
  const snoozed = untouched.filter(
    (c) => !c.do_not_contact && c.snooze_until && Date.parse(c.snooze_until) > now,
  )
  const rest = untouched.filter((c) => !dnc.includes(c) && !snoozed.includes(c))
  const reachable = rest.filter((c) => c.primary_phone || c.primary_email)
  const noWay = rest.filter((c) => !c.primary_phone && !c.primary_email)

  const link = (id: string) =>
    `https://app.magicengine.com.au/dashboard/clients/${CLIENT_ID}/crm/all?contact=${id}`

  /**
   * 🔴 这份名单只可能包含**已经进到 ME 里**的往来。
   *
   * 如果这个客户的进线同步断了（NAL 2026-09-16 起 Messenger 断流 11 天），或者某个
   * 渠道压根没接（NAL 的主渠道是 WhatsApp，一条都没接进来），那么名单会**少算**，
   * 而少算的恰恰是最新的那批 —— 也就是最烫的那批。
   *
   * 不把这句话写在最上面，PM 和销售会以为「打完这 N 个就清完了」。
   */
  /**
   * 🔴 必须**按渠道分别看**，不能看整体最新那一条。
   *
   * 实测 NAL：它的邮件到 2026-09-25 还在进，而**私信 9-16 就断了 11 天**。
   * 只看整体最新一条 → 「看起来是通的」→ 警告不触发 → 而断掉的恰恰是它的主渠道。
   * **一个活着的渠道会把一个死掉的渠道盖住。**
   */
  const perChannel = new Map<string, { count: number; newest: string }>()
  for (const t of tps) {
    if (t.direction !== 'inbound') continue
    const cur = perChannel.get(t.channel)
    if (!cur) perChannel.set(t.channel, { count: 1, newest: t.occurred_at })
    else {
      cur.count += 1
      if (t.occurred_at > cur.newest) cur.newest = t.occurred_at
    }
  }
  const daysAgo = (iso: string): number => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  /** 历史上有量、最近却安静太久的渠道 —— 有量才说明它本该在进，安静才是异常。 */
  const quiet = [...perChannel.entries()]
    .filter(([, v]) => v.count >= 10 && daysAgo(v.newest) >= 7)
    .map(([ch, v]) => ({ ch, days: daysAgo(v.newest), newest: v.newest, count: v.count }))
    .sort((a, b) => b.days - a.days)

  const lines: string[] = []
  lines.push(`# 客人开过口、但查不到任何真人动作`)
  lines.push(``)
  lines.push(`生成于 ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · 客户 ${CLIENT_ID}`)
  lines.push(``)
  lines.push(`**怎么来的**：这些人**自己主动开过口**（发过私信、填过表单、来过邮件），但逐个查下来**找不到任何真人做过的动作** —— 没有人打过电话、没有人发过非群发的邮件、私信里也没有真人回过。`)
  lines.push(``)
  lines.push(`**怎么用**：每一条后面有直达链接，点进去就是这个人在 ME 里的记录，可以直接记一笔、改跟进阶段。`)
  lines.push(``)
  if (quiet.length > 0) {
    lines.push(`> 🔴 **这份名单少算了，别当成全部。**`)
    lines.push(`>`)
    for (const q of quiet) {
      lines.push(
        `> 这个客户的**${q.ch}**历史上进过 ${q.count} 条，但**最新的一条是 ${q.days} 天前**（${day(q.newest)}）—— 要么同步断了，要么那个渠道压根没接进来。`,
      )
    }
    lines.push(`>`)
    lines.push(
      `> **漏掉的恰恰是最新最烫的那批。** 先把进线修通再重跑这份名单，否则打完这几个会以为清完了。`,
    )
    lines.push(``)
  }
  lines.push(`各渠道最新一条客人来信：${[...perChannel.entries()].map(([ch, v]) => `${ch} ${daysAgo(v.newest)} 天前`).join(' · ')}`)
  lines.push(``)
  lines.push(`| 组 | 人数 |`)
  lines.push(`|---|---|`)
  lines.push(`| ✅ 可以直接补跟（有电话或邮箱） | **${reachable.length}** |`)
  lines.push(`| ⚠️ 没有任何联系方式（只有私信） | ${noWay.length} |`)
  lines.push(`| ⛔ 说过「别再联系」——**不要跟** | ${dnc.length} |`)
  lines.push(`| 💤 推迟中，到点再说——**现在不用跟** | ${snoozed.length} |`)
  lines.push(`| 客人主动开过口的总人数 | ${everyone.filter((c) => spokeFirst.has(c.id)).length} |`)
  lines.push(`| 这个客户的联系人总数 | ${everyone.length} |`)
  lines.push(``)
  lines.push(
    `其中**最刺眼的一组**：系统已经把他标成「已联系」、实际却没人碰过 —— **${untouched.filter((c) => c.stage === 'contacted').length} 人**。他们因为被标了，已经从「今天该联系谁」名单上消失。`,
  )
  lines.push(``)
  lines.push(`**先打谁**（只统可以直接补跟那 ${reachable.length} 人）：`)
  lines.push(``)
  lines.push(`| 进线多久 | 人数 |`)
  lines.push(`|---|---|`)
  for (const band of ['🔥 3 天内 —— 还烫着，优先打', '🟠 4–7 天', '🟡 8–30 天', '⚪ 超过 30 天 —— 大概率已经在别家订了']) {
    const n = reachable.filter((c) => freshness(c.first_seen_at).band === band).length
    lines.push(`| ${band} | ${n} |`)
  }
  lines.push(``)
  lines.push(`名单已经按这个顺序排好了 —— **从上往下打就行。**`)
  lines.push(``)

  const section = (title: string, rows: C[], note: string) => {
    lines.push(`---`)
    lines.push(``)
    lines.push(`## ${title}（${rows.length} 人）`)
    lines.push(``)
    lines.push(note)
    lines.push(``)
    if (rows.length === 0) {
      lines.push(`（这一组没有人。）`)
      lines.push(``)
      return
    }
    const sorted = [...rows].sort((a, b) => {
      const fa = freshness(a.first_seen_at).order
      const fb = freshness(b.first_seen_at).order
      if (fa !== fb) return fa - fb
      return Date.parse(lastAny.get(b.id) ?? b.first_seen_at) - Date.parse(lastAny.get(a.id) ?? a.first_seen_at)
    })
    for (const c of sorted) {
      const v = verdict.get(c.id)
      lines.push(`### ${c.display_name || '未留姓名'}`)
      lines.push(``)
      const ways: string[] = []
      if (c.primary_phone) ways.push(`📞 ${c.primary_phone}`)
      if (c.primary_email) ways.push(`✉️ ${c.primary_email}`)
      lines.push(`- **怎么联系**：${ways.join('　') || '只有私信，没有电话和邮箱'}`)
      lines.push(
        `- **多久了**：${freshness(c.first_seen_at).band}（进线 ${day(c.first_seen_at)}）`,
      )
      lines.push(`- **他从哪来**：${sourceOf.get(c.id) ?? '不清楚'}`)
      lines.push(`- **最近一次任何往来**：${day(lastAny.get(c.id) ?? null)}`)
      if (c.stage === 'contacted') {
        lines.push(`- 🔴 **系统已经把他标成「已联系」** —— 所以他已经从「今天该联系谁」名单上消失了`)
      }
      lines.push(`- **为什么被标成「已联系」**：${whyAuto.get(c.id) ?? '没找到触发它的那条往来'}`)
      if (v) {
        const why = stageReasonForDisplay(v.note)
        lines.push(
          `- **当时系统怎么说的**：${describeStageActor(v.changed_by)}（${day(v.created_at)}）${why ? ` —— ${why}` : ''}`,
        )
      }
      lines.push(`- **点这里跟进**：${link(c.id)}`)
      lines.push(``)
    }
  }

  section('可以直接补跟', reachable, '**建议动作**：按「最近一次往来」从新到旧打。打通了在 ME 里记一笔，打不通点「没打通」，都不用打字。')
  section('没有任何联系方式', noWay, '这些人只在私信里出现过。**别当成电话名单** —— 去私信里回他，或者顺手问一个联系方式。')
  section('⛔ 说过「别再联系」', dnc, '🔴 **不要联系这一组。** 列在这里只是为了说明他们为什么不在上面那份名单里。')
  section('💤 推迟中', snoozed, '有人已经标了「现在别打，到点再说」，到期会自动回到「今天该联系谁」。现在不用管。')

  writeFileSync(OUT, lines.join('\n') + '\n', 'utf8')
  // 只打印计数，不打印任何客人信息
  console.log(`联系人总数 ${everyone.length} · 客人主动开过口 ${everyone.filter((c) => spokeFirst.has(c.id)).length} 人`)
  console.log(`  其中「系统已标已联系、实际没人碰过」：${untouched.filter((c) => c.stage === 'contacted').length}`)
  console.log(`  找不到真人动作：${untouched.length}`)
  console.log(`    ✅ 可以直接补跟：${reachable.length}`)
  console.log(`    ⚠️ 没有联系方式：${noWay.length}`)
  console.log(`    ⛔ 别再联系（已挡）：${dnc.length}`)
  console.log(`    💤 推迟中（已挡）：${snoozed.length}`)
  for (const q of quiet) {
    console.log(`  🔴 少算警告：${q.ch} 历史 ${q.count} 条，最新一条 ${q.days} 天前 —— 同步断了或没接进来`)
  }
  console.log(`\n名单写到：${OUT}（含客人信息，不进仓库）`)
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
