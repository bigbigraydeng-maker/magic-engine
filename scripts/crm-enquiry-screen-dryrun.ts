/**
 * 「邮件 / WhatsApp 来客是不是有效咨询」筛选 —— **干跑**（全程只读：只有 SELECT + 调大模型，不写库、不外发消息）。
 * 设计稿：docs/specs/2026-10-21-crm-valid-leads-only-design-v0.md §5.5 / §6
 *
 * 做三件事：
 *   1. 用 PM 页面同一条取数路径算出「今天要联系」基线（enrich → buildPriorityView），再对其中每个人跑一遍
 *      准入 → 第一层规则 → 硬否决 → 模型，报告「基线 → N，挪走 M 个」+ 被挪走者名单（原因 + 原文前 120 字）。
 *   2. 金标准一：CTS 里**我们用邮件回过信的人**的第一封来信 —— 绝不该被判成「不是咨询」。有一个被判走 = 判据不合格。
 *   3. 打印每个「留下」原因的人数、硬否决每个词命中几次。
 *
 * 怎么跑（密钥由 node --env-file 加载，脚本不读、不打印密钥）：
 *   node --env-file=/path/.env.local node_modules/tsx/dist/cli.mjs scripts/crm-enquiry-screen-dryrun.ts \
 *     --client <clientId> [--staff Baker,Anna] [--no-model] [--out report.json]
 *
 * --no-model：只跑第一层 + 硬否决，不调模型（零花费）。
 * 模型：平台已有的 Claude Haiku（对外叫 Strategy Engine），每封只发「主题 + 前 255 字预览」。
 * （OpenAI 账户 2026-10-21 实测余额为 0，调用返回 429，所以不用 gpt-4o-mini。）
 */

import fs from 'node:fs'
import { getAnthropicClient } from '@/lib/anthropic/client'
import { supabaseAdmin as sb } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import { buildPriorityView } from '@/lib/crm/contact-list-view'
import { stageMetaOf } from '@/lib/crm/contact-response-row'
import { contactKindOf, isSystemAccountName, readDomainRules } from '@/lib/crm/contact-kind'
import { enrichContacts } from '@/lib/crm/contact-enrichment'
import { loadEnrichmentInputs } from '@/lib/crm/contact-enrichment-loader'
import { loadLatestBriefByContact } from '@/lib/crm/brief-lookup'
import { decideScreen, type ScreenDecision } from '@/lib/crm/enquiry-screen/decide'
import { SCREEN_MODEL, acceptNonEnquiry, callScreenModel } from '@/lib/crm/enquiry-screen/classify'
import { hasEnquiryEvidence, layerOneVerdict } from '@/lib/crm/enquiry-screen/rules'
import { flattenEnquiryTerms } from '@/lib/crm/industry/travel-enquiry-terms'
import {
  NOT_ENQUIRY_STAGE_KEY,
  SCREENABLE_INBOUND_SOURCES,
  readScreenConfig,
  type ScreenStageEvent,
  type ScreenTouch,
} from '@/lib/crm/enquiry-screen/types'

const CTS = 'c0000000-0000-0000-0000-000000000000'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`)

interface TouchRow {
  id: string
  contact_id: string
  channel: string
  direction: 'inbound' | 'outbound'
  occurred_at: string
  created_at: string
  summary: string | null
  raw: string | null
  metadata: Record<string, unknown> | null
  source: string | null
}

function toScreenTouch(t: TouchRow): ScreenTouch {
  const subject = typeof t.metadata?.subject === 'string' ? (t.metadata.subject as string) : null
  return {
    channel: t.channel,
    source: t.source,
    direction: t.direction,
    occurredAt: t.occurred_at,
    createdAt: t.created_at,
    subject,
    preview: t.raw ?? t.summary,
  }
}

function makeComplete(): (system: string, user: string) => Promise<string> {
  const client = getAnthropicClient()
  return async (system, user) => {
    const res = await client.messages.create({
      model: SCREEN_MODEL,
      max_tokens: 400,
      temperature: 0,
      system,
      messages: [{ role: 'user', content: user }],
    })
    return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  }
}

function chunk<T>(items: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n))
  return out
}

async function main(): Promise<void> {
  const clientId = arg('client') ?? CTS
  const staffNames = (arg('staff') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const useModel = !flag('no-model')
  const now = new Date()

  const { data: client } = await sb
    .from('clients')
    .select('name, industry, business_scope, leads_config')
    .eq('id', clientId)
    .single()
  const rules = readDomainRules(client?.leads_config)
  const baseConfig = readScreenConfig(client?.leads_config)
  const config = { ...baseConfig, enabled: true } // 干跑强制打开，只为出报告
  const businessDescription = [client?.name, client?.industry, client?.business_scope].filter(Boolean).join(' — ')

  // ── 1. 基线：和 PM 页面同一条取数路径 ──
  let contacts = await fetchAll<Record<string, unknown>>((f, t) =>
    sb
      .from('contacts')
      .select('id, display_name, primary_phone, primary_email, do_not_contact, snooze_until, stage, first_seen_at, pinned_at, important_note, important_due_at')
      .eq('client_id', clientId)
      .order('id', { ascending: true })
      .range(f, t),
  )
  const touches = await fetchAll<TouchRow>((f, t) =>
    sb
      .from('contact_touchpoints')
      .select('id, contact_id, channel, direction, occurred_at, created_at, summary, raw, metadata, source')
      .eq('client_id', clientId)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(f, t),
  )
  const stages = await fetchAll<{ stage_key: string; label: string; marketing_action: string; is_terminal: boolean }>((f, t) =>
    sb.from('client_pipeline_stages').select('stage_key, label, marketing_action, is_terminal').eq('client_id', clientId).order('sort_order').range(f, t),
  )
  const hasNotEnquiryStage = stages.some((s) => s.stage_key === NOT_ENQUIRY_STAGE_KEY)
  const briefs = await loadLatestBriefByContact(clientId)
  contacts = contacts.filter((c) => !isSystemAccountName(c.display_name as string | null))
  const inputs = await loadEnrichmentInputs(sb, clientId, undefined)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const en = enrichContacts({ contacts, touches, hints: inputs.hints, outboundEmails: inputs.outboundEmails } as any)
  const { sections } = buildPriorityView(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { contacts: en.contacts, touchpoints: en.touches, stageMeta: stageMetaOf(stages), now, perPage: 5000, open: { hot: true, cold: false }, briefs } as any,
    (row: { id: string }) => row.id,
  )
  const hotIds = (sections.find((s) => s.key === 'hot')?.items ?? []) as string[]
  console.log(`基线（页面同口径）：今天要联系 = ${hotIds.length}；该客户是否已有「非咨询」阶段：${hasNotEnquiryStage}（干跑不要求）`)

  // ── 2. 对基线里每个人跑一遍 ──
  const touchByContact = new Map<string, TouchRow[]>()
  for (const t of en.touches as TouchRow[]) {
    const list = touchByContact.get(t.contact_id) ?? []
    list.push(t)
    touchByContact.set(t.contact_id, list)
  }
  const contactById = new Map<string, Record<string, unknown>>(en.contacts.map((c) => [c.id, { ...c }]))
  const eventsByContact = new Map<string, ScreenStageEvent[]>()
  for (const ids of chunk(hotIds, 100)) {
    const rows = await fetchAll<{ contact_id: string; from_stage: string | null; to_stage: string; changed_by: string | null; created_at: string }>((f, t) =>
      sb.from('contact_stage_events').select('contact_id, from_stage, to_stage, changed_by, created_at').in('contact_id', ids).range(f, t),
    )
    for (const r of rows) {
      const list = eventsByContact.get(r.contact_id) ?? []
      list.push({ fromStage: r.from_stage, toStage: r.to_stage, changedBy: r.changed_by, createdAt: r.created_at })
      eventsByContact.set(r.contact_id, list)
    }
  }

  const complete = useModel ? makeComplete() : async (): Promise<string> => ''
  const vetoTerms = flattenEnquiryTerms()
  const keepCounts: Record<string, number> = {}
  const vetoTermHits: Record<string, number> = {}
  const moved: Array<Record<string, unknown>> = []

  for (const id of hotIds) {
    const c = contactById.get(id)
    if (!c) continue
    const email = (c.primary_email as string | null) ?? null
    const decision: ScreenDecision = await decideScreen({
      eligibility: {
        contact: { id, stage: (c.stage as string | null) ?? null, doNotContact: c.do_not_contact === true, emails: email ? [email] : [], hasPhone: !!c.primary_phone },
        touches: (touchByContact.get(id) ?? []).map(toScreenTouch),
        events: eventsByContact.get(id) ?? [],
        contactKind: contactKindOf(email ? [email] : [], rules),
        hasNotEnquiryStage: true,
        config,
        now,
      },
      fromAddress: email,
      vetoTerms,
      staffNames,
      businessDescription,
      model: { complete },
    })
    if (decision.action === 'keep') {
      const k = decision.detail ? `${decision.why}:${decision.detail}` : decision.why
      keepCounts[decision.why.startsWith('ineligible') ? decision.why : k] = (keepCounts[decision.why.startsWith('ineligible') ? decision.why : k] ?? 0) + 1
      if (decision.why === 'veto' && decision.detail) vetoTermHits[decision.detail] = (vetoTermHits[decision.detail] ?? 0) + 1
    } else {
      const first = (touchByContact.get(id) ?? [])[0]
      moved.push({
        id,
        name: c.display_name,
        email,
        layer: decision.layer,
        category: decision.category,
        reason: decision.reason,
        note: decision.note,
        subject: first?.metadata?.subject ?? null,
        preview120: (first?.raw ?? first?.summary ?? '').replace(/\s+/g, ' ').slice(0, 120),
      })
    }
  }

  console.log(`\n=== 结果：${hotIds.length} → ${hotIds.length - moved.length}（挪走 ${moved.length} 个；模型：${useModel ? SCREEN_MODEL : '未调用'}） ===`)
  console.log('\n— 留下的原因分布 —')
  for (const [k, v] of Object.entries(keepCounts).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(4), k)
  console.log('\n— 硬否决词命中次数 —', vetoTermHits)
  console.log('\n— 被挪走者 —')
  for (const m of moved) console.log(`[${m.layer}/${m.category}] ${m.name} <${m.email}> | ${m.subject} | ${m.reason}`)

  // ── 3. 金标准一：我们用邮件回过信的人，第一封来信 ──
  let goldFlagged = 0
  let goldTotal = 0
  let goldLayerOne = 0
  let goldVeto = 0
  let goldNoVerdict = 0
  const goldBad: Array<Record<string, unknown>> = []
  if (useModel) {
    const repliedIds = new Set<string>()
    for (const [cid, list] of touchByContact) {
      if (list.some((t) => t.direction === 'outbound' && t.channel === 'email' && t.source === 'microsoft_mail')) repliedIds.add(cid)
    }
    for (const cid of repliedIds) {
      // 只取真正的来信（白名单来源）；Mailchimp 的「打开了/点了」不是来信。
      const inbound = (touchByContact.get(cid) ?? [])
        .filter((t) => t.direction === 'inbound' && SCREENABLE_INBOUND_SOURCES.has(`${t.channel}/${t.source ?? ''}`))
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0]
      if (!inbound) continue
      const email = (contactById.get(cid)?.primary_email as string | null) ?? null
      // 同行 / 员工本来就不进筛选，不拿来测。
      if (contactKindOf(email ? [email] : [], rules) !== 'retail') continue
      const msg = { subject: typeof inbound.metadata?.subject === 'string' ? (inbound.metadata.subject as string) : null, preview: inbound.raw ?? inbound.summary, fromAddress: email }
      goldTotal++
      // 第一层命中的是**真的自动回复 / 退信**（主题就写着）——这类人本来就因为「我们回过他」进不了筛选，单独计数，不算误判。
      if (layerOneVerdict(msg) !== null) {
        goldLayerOne++
        continue
      }
      // 硬否决命中的，生产里不会走到模型，同样单独计数。
      if (hasEnquiryEvidence([msg], { terms: vetoTerms, staffNames }).hit) {
        goldVeto++
        continue
      }
      const verdict = await callScreenModel({ complete }, { businessDescription, messages: [msg] })
      if (verdict === null) goldNoVerdict++
      const accepted = acceptNonEnquiry(verdict, [msg], config.confidenceThreshold)
      if (accepted.accept) {
        goldFlagged++
        goldBad.push({ cid, email, subject: msg.subject, category: accepted.category, reason: accepted.reason, preview150: (msg.preview ?? '').replace(/\s+/g, ' ').slice(0, 150) })
      }
    }
    console.log(`\n=== 金标准一：我们回过信的人 ${goldTotal} 个（其中第一层命中真自动回复/退信 ${goldLayerOne} 个，硬否决放行 ${goldVeto} 个，模型没出结果 ${goldNoVerdict} 个），被模型误判成「不是咨询」的 ${goldFlagged} 个（必须是 0；模型没出结果 > 0 说明这次校准无效） ===`)
    for (const b of goldBad) console.log('  ✗', b)
  }

  const out = arg('out')
  if (out) fs.writeFileSync(out, JSON.stringify({ baseline: hotIds.length, moved, keepCounts, vetoTermHits, goldTotal, goldLayerOne, goldVeto, goldNoVerdict, goldFlagged, goldBad }, null, 1))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
