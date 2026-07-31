/**
 * GET /api/clients/[id]/contacts
 *
 * 「按房子看客人」这一页的读模型 —— 中介在车里、在开放日现场用手机开的那一页。
 *
 * 整条学习链里只有一步机器做不了：**这个咨询是不是真买家，只有跟他谈过的中介知道**。
 * 这一页存在的唯一理由就是把那一下点击变得足够便宜（5 分钟标完一屋子人），
 * 否则「每个真买家多少钱」永远算不出来，投放只能去优化「咨询数」这种表面数。
 *
 * 隔离（这一页最大的风险 —— 门户是外部人员登录的）：
 *   · requirePaidClientAccess 先把「这个登录邮箱能不能碰这个客户」问清楚；
 *     它查的是 client_portal_users，URL 上的 clientId 本身不构成任何授权。
 *   · 下面**每一条**查询都带 .eq('client_id', clientId)，一条都不能少 ——
 *     少一条就是另一个中介的客人出现在这位中介的屏幕上。
 *
 * 改状态走已有的 PATCH /api/clients/[id]/crm/contacts/[cid]/stage：那里已经有
 * 归属校验、阶段合法值校验和审计，再开一条写路径等于多开一个越权面。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import {
  sourceLine,
  suggestStage,
  compareGroups,
  compareByRecency,
  type BoardStage,
  type BriefIntent,
} from '@/lib/crm/contact-board'

interface ContactRow {
  id: string
  display_name: string | null
  stage: string | null
  listing_id: string | null
  attr_ad_name: string | null
  attr_platform: string | null
}

interface TouchRow {
  contact_id: string
  channel: string
  occurred_at: string
  summary: string | null
  attr_ad_name: string | null
}

interface ListingRow {
  id: string
  address_line: string | null
  suburb: string | null
  status: string | null
}

interface StageRow {
  stage_key: string
  label: string
}

interface ConversationRow {
  id: string
  contact_id: string | null
}

interface BriefRow {
  conversation_id: string
  summary: string | null
  intent_level: string | null
}

/** 每人一份：最早一条（怎么进来的）+ 最晚一条（最后说了什么）。 */
interface TouchDigest {
  firstChannel: string | null
  firstAdName: string | null
  lastAt: string | null
  lastText: string | null
}

function ms(v: string | null | undefined): number {
  if (!v) return 0
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

/** 折叠时带上时间戳，算完再扔掉 —— 不依赖查询返回的顺序。 */
interface Folding extends TouchDigest {
  firstMs: number
  lastMs: number
}

function fold(acc: Folding, t: TouchRow): Folding {
  const at = ms(t.occurred_at)
  if (at >= acc.lastMs) {
    acc.lastMs = at
    acc.lastAt = t.occurred_at
    acc.lastText = t.summary?.trim() || null
  }
  // 最早那条决定「怎么进来的」；归因也取最早一条 —— first touch 才是带来他的那次。
  if (at <= acc.firstMs) {
    acc.firstMs = at
    acc.firstChannel = t.channel
    acc.firstAdName = t.attr_ad_name?.trim() || null
  }
  return acc
}

function digestTouches(touches: TouchRow[]): Map<string, TouchDigest> {
  const acc = new Map<string, Folding>()
  for (const t of touches) {
    const at = ms(t.occurred_at)
    const cur = acc.get(t.contact_id)
    if (!cur) {
      acc.set(t.contact_id, {
        firstMs: at,
        lastMs: at,
        firstChannel: t.channel,
        firstAdName: t.attr_ad_name?.trim() || null,
        lastAt: t.occurred_at,
        lastText: t.summary?.trim() || null,
      })
      continue
    }
    acc.set(t.contact_id, fold(cur, t))
  }

  const out = new Map<string, TouchDigest>()
  acc.forEach((v, id) => {
    out.set(id, {
      firstChannel: v.firstChannel,
      firstAdName: v.firstAdName,
      lastAt: v.lastMs > 0 ? v.lastAt : null,
      lastText: v.lastMs > 0 ? v.lastText : null,
    })
  })
  return out
}

/** 房子标题：地址优先，退到郊区名，都没有就说「一套房（没填地址）」。 */
function listingTitle(l: ListingRow): string {
  const line = l.address_line?.trim()
  if (line) return line
  const suburb = l.suburb?.trim()
  if (suburb) return suburb
  return '一套房（还没填地址）'
}

async function loadAll(clientId: string) {
  return Promise.all([
    fetchAll<ContactRow>((from, to) =>
      supabaseAdmin
        .from('contacts')
        .select('id, display_name, stage, listing_id, attr_ad_name, attr_platform')
        .eq('client_id', clientId)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    fetchAll<TouchRow>((from, to) =>
      supabaseAdmin
        .from('contact_touchpoints')
        .select('contact_id, channel, occurred_at, summary, attr_ad_name')
        .eq('client_id', clientId)
        .order('occurred_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    ),
    fetchAll<ListingRow>((from, to) =>
      supabaseAdmin
        .from('listings')
        .select('id, address_line, suburb, status')
        .eq('client_id', clientId)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    fetchAll<StageRow>((from, to) =>
      supabaseAdmin
        .from('client_pipeline_stages')
        .select('stage_key, label')
        .eq('client_id', clientId)
        .order('sort_order', { ascending: true })
        .range(from, to),
    ),
    fetchAll<ConversationRow>((from, to) =>
      supabaseAdmin
        .from('conversations')
        .select('id, contact_id')
        .eq('client_id', clientId)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    fetchAll<BriefRow>((from, to) =>
      supabaseAdmin
        .from('conversation_briefs')
        .select('conversation_id, summary, intent_level')
        .eq('client_id', clientId)
        .order('conversation_id', { ascending: true })
        .range(from, to),
    ),
  ])
}

const INTENTS: readonly string[] = ['high', 'medium', 'low', 'unknown']
function asIntent(v: string | null): BriefIntent | null {
  return v && INTENTS.includes(v) ? (v as BriefIntent) : null
}

/** brief → conversation → contact。认不出人的对话直接丢掉。 */
function linkBriefs(
  conversations: ConversationRow[],
  briefs: BriefRow[],
): Map<string, BriefRow> {
  const byConversation = new Map(briefs.map((b) => [b.conversation_id, b]))
  const out = new Map<string, BriefRow>()
  for (const c of conversations) {
    if (!c.contact_id) continue
    const b = byConversation.get(c.id)
    if (b) out.set(c.contact_id, b)
  }
  return out
}

interface Person {
  contactId: string
  name: string
  listingId: string | null
  source: ReturnType<typeof sourceLine>
  lastTouchAt: string | null
  lastTouchText: string | null
  aiSummary: string | null
  stage: string | null
  stageLabel: string | null
  suggestion: ReturnType<typeof suggestStage>
}

function buildPeople(args: {
  contacts: ContactRow[]
  digests: Map<string, TouchDigest>
  briefByContact: Map<string, BriefRow>
  stages: BoardStage[]
}): Person[] {
  const stageLabel = new Map(args.stages.map((s) => [s.stageKey, s.label]))
  return args.contacts.map((c) => {
    const d = args.digests.get(c.id)
    const brief = args.briefByContact.get(c.id)
    return {
      contactId: c.id,
      name: c.display_name?.trim() || '未留姓名',
      listingId: c.listing_id,
      source: sourceLine({
        adName: c.attr_ad_name?.trim() || d?.firstAdName || null,
        platform: c.attr_platform,
        firstChannel: d?.firstChannel ?? null,
      }),
      lastTouchAt: d?.lastAt ?? null,
      lastTouchText: d?.lastText ?? null,
      aiSummary: brief?.summary?.trim() || null,
      stage: c.stage,
      stageLabel: c.stage ? (stageLabel.get(c.stage) ?? c.stage) : null,
      suggestion: suggestStage({
        currentStage: c.stage,
        intent: asIntent(brief?.intent_level ?? null),
        stages: args.stages,
      }),
    }
  })
}

function buildGroups(people: Person[], listings: ListingRow[]) {
  const listingById = new Map(listings.map((l) => [l.id, l]))
  const buckets = new Map<string, Person[]>()
  for (const p of people) {
    // 挂着一个已经不存在（或不属于本客户）的房子 → 当作没挂，绝不显示别人的房子。
    const key = p.listingId && listingById.has(p.listingId) ? p.listingId : ''
    const list = buckets.get(key) ?? []
    list.push(p)
    buckets.set(key, list)
  }

  const groups: Array<{
    listingId: string | null
    title: string
    subtitle: string | null
    people: Person[]
  }> = []
  buckets.forEach((list, key) => {
    const l = key ? listingById.get(key) : undefined
    groups.push({
      listingId: l ? l.id : null,
      title: l ? listingTitle(l) : '还没挂到房子上的客人',
      subtitle: l ? [l.suburb, l.status].filter(Boolean).join(' · ') || null : null,
      people: [...list].sort(compareByRecency),
    })
  })
  return groups.sort(compareGroups)
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let loaded: Awaited<ReturnType<typeof loadAll>>
  try {
    loaded = await loadAll(clientId)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '读取失败' },
      { status: 500 },
    )
  }

  const [contacts, touches, listings, stageRows, conversations, briefs] = loaded
  const stages: BoardStage[] = stageRows.map((s) => ({ stageKey: s.stage_key, label: s.label }))
  const people = buildPeople({
    contacts,
    digests: digestTouches(touches),
    briefByContact: linkBriefs(conversations, briefs),
    stages,
  })

  return NextResponse.json({
    stages,
    groups: buildGroups(people, listings),
    totalPeople: people.length,
  })
}
