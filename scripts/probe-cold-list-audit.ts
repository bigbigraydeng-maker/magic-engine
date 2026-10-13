/**
 * 「先放着」名单审计 —— 只读。
 *
 * 为什么有这个脚本（PM 2026-10-10）：盲测 10 段全新对话，PM 全回「该联系」，而其中 7 位现在
 * 躺在「先放着」里。要回答的是：「先放着」里到底有多少人其实欠着我们一份报价 / 在等我们回，
 * 该怎么定一条**今天打得完**的规则 —— 不能把一百多人一股脑搬进「今天要联系」。
 *
 * 做法：对一个客户，把现在落在 cold 名单的人逐个读最新一段对话，用校准脚本里同一套
 * 「模型只报事实、规则由代码算」（`askModel` + `applyPostChecks`）取事实，再叠上两个
 * 完全由数据算出来的量：**最后一句是谁说的**、**多久没动静**。输出只有计数表，
 * 不含姓名、电话、邮箱、对话 id（PM 2026-10-10：客人信息不出现在任何输出里）。
 *
 * 全程只有 select。会调用模型（每人一次，约 200 次，量级几毛美元）。
 *
 *   CRM_INTENT_CALIBRATION_MODEL=gpt-4o npx tsx --env-file=/path/.env.local \
 *     scripts/probe-cold-list-audit.ts <clientId> <outFile.md>
 */
import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import { buildContactModel, type ContactRowLike, type StageMetaLike, type TouchpointRowLike } from '@/lib/crm/contact-model'
import { segmentContact, type Segment } from '@/lib/crm/segments'
import { listOf } from '@/lib/crm/next-action'
import {
  askModel,
  loadBusinessName,
  loadMessages,
  findCanned,
  buildTranscript,
  applyPostChecks,
  isCanned,
  mask,
  type MsgRow,
  type Verdict,
} from './probe-intent-calibration'

interface ConvRow {
  id: string
  contact_id: string | null
  last_message_at: string | null
}

interface Row {
  idx: number
  segment: Segment
  daysIdle: number
  lastFrom: 'customer' | 'us'
  gaveSpecifics: boolean
  weQuoted: boolean
  declinedOrNotNow: boolean
  spam: boolean
  arranged: boolean
  level: string
}

const DAY = 86_400_000

function bucket(days: number): string {
  if (days <= 14) return '14 天内'
  if (days <= 30) return '15–30 天'
  if (days <= 60) return '31–60 天'
  return '60 天以上'
}
const BUCKETS = ['14 天内', '15–30 天', '31–60 天', '60 天以上']

/** 谁说了最后一句（固定回复不算我们说话）。 */
function lastSpeaker(msgs: MsgRow[], canned: Set<string>): 'customer' | 'us' {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.direction === 'inbound') return 'customer'
    if (!isCanned(m, canned)) return 'us'
  }
  return 'customer'
}

async function loadCold(clientId: string): Promise<Array<{ contactId: string; segment: Segment }>> {
  const [contacts, touches] = await Promise.all([
    fetchAll<ContactRowLike>((f, t) =>
      supabaseAdmin
        .from('contacts')
        .select('id, display_name, primary_phone, primary_email, do_not_contact, snooze_until, stage')
        .eq('client_id', clientId)
        .order('id', { ascending: true })
        .range(f, t),
    ),
    fetchAll<TouchpointRowLike>((f, t) =>
      supabaseAdmin
        .from('contact_touchpoints')
        .select('contact_id, channel, direction, occurred_at, raw, metadata, source')
        .eq('client_id', clientId)
        .order('occurred_at', { ascending: false })
        .range(f, t),
    ),
  ])
  const by = new Map<string, TouchpointRowLike[]>()
  for (const tp of touches) {
    const l = by.get(tp.contact_id) ?? []
    l.push(tp)
    by.set(tp.contact_id, l)
  }
  const stageMeta = new Map<string, StageMetaLike>()
  const out: Array<{ contactId: string; segment: Segment }> = []
  for (const c of contacts) {
    const seg = segmentContact(buildContactModel(c, by.get(c.id) ?? [], stageMeta), new Date())
    // 只要「会被放进先放着」的里面真有对话可读的：不含明确拒联 / 推迟（excluded、nurture_future）。
    if (listOf(seg.segment) === 'cold' && seg.segment !== 'excluded' && seg.segment !== 'nurture_future') {
      out.push({ contactId: c.id, segment: seg.segment })
    }
  }
  return out
}

async function latestConversation(clientId: string): Promise<Map<string, string>> {
  const convs = await fetchAll<ConvRow>((f, t) =>
    supabaseAdmin
      .from('conversations')
      .select('id, contact_id, last_message_at')
      .eq('client_id', clientId)
      .not('contact_id', 'is', null)
      .order('id', { ascending: true })
      .range(f, t),
  )
  const best = new Map<string, ConvRow>()
  for (const c of convs) {
    const prev = best.get(c.contact_id as string)
    if (!prev || (c.last_message_at ?? '') > (prev.last_message_at ?? '')) best.set(c.contact_id as string, c)
  }
  return new Map(Array.from(best.entries()).map(([contactId, c]) => [contactId, c.id]))
}

function table(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |`
  return [head, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')
}

async function main(): Promise<void> {
  const [clientId, outFile] = process.argv.slice(2)
  if (!clientId || !outFile) {
    console.error('用法: probe-cold-list-audit.ts <clientId> <outFile.md>')
    process.exit(1)
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY 未设置')
    process.exit(1)
  }

  const cold = await loadCold(clientId)
  const convOf = await latestConversation(clientId)
  const business = await loadBusinessName(clientId)

  const items = cold
    .map((c) => ({ ...c, convId: convOf.get(c.contactId) }))
    .filter((c): c is { contactId: string; segment: Segment; convId: string } => Boolean(c.convId))
  const noConversation = cold.length - items.length

  const allMsgs: MsgRow[][] = []
  for (const it of items) allMsgs.push(await loadMessages(it.convId))
  const canned = findCanned(allMsgs)

  const rows: Row[] = []
  let input = 0
  let output = 0
  let failed = 0
  for (let i = 0; i < items.length; i++) {
    const msgs = allMsgs[i]
    if (msgs.length === 0) continue
    const transcript = buildTranscript(msgs, canned)
    try {
      const { verdict, usage } = await askModel(business, transcript)
      input += usage.input
      output += usage.output
      if (!verdict) {
        failed++
        continue
      }
      const checked = applyPostChecks(verdict as Verdict, transcript, msgs, canned)
      const lastAt = Date.parse(msgs[msgs.length - 1].sent_at)
      rows.push({
        idx: i,
        segment: items[i].segment,
        daysIdle: Math.max(0, Math.floor((Date.now() - lastAt) / DAY)),
        lastFrom: lastSpeaker(msgs, canned),
        gaveSpecifics: verdict.customer_gave_specifics,
        weQuoted: verdict.we_gave_price,
        declinedOrNotNow: verdict.we_declined || verdict.customer_said_not_now,
        spam: verdict.is_spam_or_unrelated,
        arranged: verdict.next_step_arranged || verdict.ordered_or_paid,
        level: checked.level,
      })
    } catch {
      failed++
    }
  }

  // 候选规则（互斥，从上往下先中先算）—— 只用事实，不用意向档。
  const rule = (r: Row): string => {
    if (r.spam) return 'F 垃圾或无关'
    if (r.declinedOrNotNow) return 'E 他说不要 / 我们做不了'
    if (r.gaveSpecifics && !r.weQuoted) return 'A 给了具体货物，我们还欠报价'
    if (r.lastFrom === 'customer') return 'B 客人最后说话，等我们回'
    if (r.gaveSpecifics && r.weQuoted) return 'C 给了具体货物，我们已报价，等客人'
    if (r.arranged) return 'D 已约下一步 / 已下单'
    return 'G 泛泛一问，没有下文'
  }
  const RULES = ['A 给了具体货物，我们还欠报价', 'B 客人最后说话，等我们回', 'C 给了具体货物，我们已报价，等客人', 'D 已约下一步 / 已下单', 'E 他说不要 / 我们做不了', 'F 垃圾或无关', 'G 泛泛一问，没有下文']

  const byRule = RULES.map((name) => {
    const hit = rows.filter((r) => rule(r) === name)
    return [name, String(hit.length), ...BUCKETS.map((b) => String(hit.filter((r) => bucket(r.daysIdle) === b).length))]
  })

  const segCount = new Map<string, number>()
  for (const r of rows) segCount.set(r.segment, (segCount.get(r.segment) ?? 0) + 1)

  const md = [
    `# 「先放着」名单审计`,
    ``,
    `- 日期：${new Date().toISOString().slice(0, 10)}　客户：${clientId.slice(0, 8)}　模型：${process.env.CRM_INTENT_CALIBRATION_MODEL ?? 'gpt-4o-mini'}`,
    `- 现在在「先放着」且有对话可读的：${rows.length} 人（另有 ${noConversation} 人没有对话记录，${failed} 人模型没答出来，均不在下表）`,
    `- 按分段：${Array.from(segCount.entries()).map(([k, v]) => `${k} ${v}`).join('　')}`,
    ``,
    `## 按「该不该今天打」的事实分组 × 多久没动静`,
    ``,
    table(['事实分组', '人数', ...BUCKETS], byRule),
    ``,
    `分组规则（从上往下先中先算）：垃圾 → 他说不要 / 我们做不了 → 给了具体货物但我们没报价 → 客人最后一句话没人回 → 给了货物且已报价 → 已约下一步 → 其余。`,
    ``,
  ].join('\n')
  await writeFile(outFile, md, 'utf8')

  // 魏征复审：A 组（欠报价）要先让 PM 标 10 个，看有没有「不该」。中性摘要，不带任何判断，
  // 只给多久没动静 + 原文片段（打码）。按稳定哈希取，不挑好看的。
  const clip = (t: string | null | undefined) => mask((t ?? '').replace(/\s+/g, ' ').trim()).slice(0, 170)
  const aRows = rows
    .filter((r) => rule(r) === RULES[0])
    .sort((a, b) =>
      createHash('sha256').update(String(a.idx) + items[a.idx].contactId).digest('hex')
        .localeCompare(createHash('sha256').update(String(b.idx) + items[b.idx].contactId).digest('hex')),
    )
    .slice(0, 10)
  const digest = aRows
    .map((r, n) => {
      const msgs = allMsgs[r.idx]
      const cust = msgs.filter((m) => m.direction === 'inbound')
      const ours = msgs.filter((m) => m.direction === 'outbound' && !isCanned(m, canned))
      return [
        `${n + 1}.  ${r.daysIdle} 天没动静；客人说了 ${cust.length} 句，我们真人说了 ${ours.length} 句`,
        `    客人说的货 / 需求：${clip(cust.find((m) => (m.body ?? '').length > 25)?.body ?? cust[0]?.body)}`,
        `    客人最后一句：${clip(cust[cust.length - 1]?.body)}`,
        `    我们最后一句：${clip(ours[ours.length - 1]?.body)}`,
      ].join('\n')
    })
    .join('\n\n')
  await writeFile(`${outFile}.A-digest.md`, digest, 'utf8')
  console.log(`读了 ${rows.length} 人；报告：${outFile}`)
  console.log(`tokens: input=${input} output=${output}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
