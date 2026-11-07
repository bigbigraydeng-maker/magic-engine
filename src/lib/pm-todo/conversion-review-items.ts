/**
 * 今日待办里的「成交/咨询待核对」（Issue #1397 PR3）。
 *
 * 文案原则（板桥复审的必改项）：
 *   · 不许出现"回写""CAPI""事件"这类内部说法 —— PM 看不懂按下去会发生什么。
 *   · 要说清**按了会怎样、不按会损失什么**，而不只是"有一条待处理"。
 *   · href 直达能动手的那一页，不是 API 地址。
 *
 * 这里是**拉**模式：直接查库里待处理的行，不依赖任何事件送达。
 * 事件丢了、进程崩了，待办照样出得来 —— 管道不许断头。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-items'
import { readCapiClientConfig, stageCountsAsQualifiedLead } from '@/lib/conversions/capi-client-config'
import {
  dealStageEventId,
  latestMetaLeadId,
  legalMetaLeadId,
  qualifiedLeadSourceRef,
  redactQualifiedSourceRef,
} from '@/lib/conversions/conversion-lead'
import { formatMoney } from '@/lib/conversions/money'
import { DAY_MS, META_EVENT_WINDOW_DAYS, isPastEventWindow } from '@/lib/conversions/event-window'

/** 一次最多列这么多，免得某天灌进来几百条把今日待办淹掉。 */
const MAX_ITEMS = 20
/** 先按「已报价 / 已开回传的客户」筛完，再截断。这个数只是筛完之后的安全上限。 */
const FILTERED_SCAN = 500
/** 发送记录按成交编号分批读。一批再截断会把后面已发出的当成没发过。 */
const WRITEBACK_ID_BATCH = 100

type PendingRow = {
  id: string
  client_id: string
  outcome_kind: 'purchase' | 'balance' | 'lead'
  customer_first: string | null
  customer_last: string | null
  amount_minor: number | null
  currency: string | null
  order_ref: string | null
  occurred_at: string
}

type DoubtRow = {
  id: string
  outcome_id: string
  me_sale_outcomes: { client_id: string; customer_first: string | null; order_ref: string | null } | null
}

/** 只露首字母 —— 待办会被截图、会进日志。 */
function shortName(first: string | null, last: string | null): string {
  const f = first?.trim()
  const l = last?.trim()
  if (f) return `${f[0].toUpperCase()}${l ? ` ${l[0].toUpperCase()}.` : ''} 这位客人`
  return '这位客人'
}

function daysAgo(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000)
}

export async function pushConversionReviewItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  clientNames: Map<string, { name: string }>,
  now: Date,
): Promise<void> {
  // ── 待核对的成交/咨询 ────────────────────────────────────────────────
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .select(
      'id, client_id, outcome_kind, customer_first, customer_last, ' +
        'amount_minor, currency, order_ref, occurred_at',
    )
    .eq('review_status', 'pending_review')
    .is('redacted_at', null)
    .order('occurred_at', { ascending: true })
    .limit(MAX_ITEMS)

  if (error) throw new Error(`成交待核对查询失败: ${error.message}`)

  for (const row of (data ?? []) as unknown as PendingRow[]) {
    const clientName = clientNames.get(row.client_id)?.name ?? '客户'
    const who = shortName(row.customer_first, row.customer_last)
    const age = daysAgo(row.occurred_at, now)
    // 广告平台只收 7 天内的 —— 快到期的要显眼，过期的别再催人做无用功。
    // 按精确时间判（不按取整后的天数）：距今 7.3 天也已经发不出去了。
    const expired = isPastEventWindow(row.occurred_at, now)

    let what: string
    if (row.outcome_kind === 'lead') {
      what =
        `${who}${age === 0 ? '今天' : `${age} 天前`}来问过一次。要把「这是个真实咨询」告诉广告平台吗？` +
        '告诉后，平台会去找更多像他这样会主动来问的人；不告诉，平台只知道谁点了广告，不知道谁真的开口。'
    } else {
      const money = formatMoney(row.amount_minor, row.currency) ?? '一笔款'
      const kindWord = row.outcome_kind === 'balance' ? '付了尾款' : '付了定金'
      what =
        `${who}${kindWord} ${money}${row.order_ref ? `（单号 ${row.order_ref}）` : ''}。` +
        '要把这笔成交告诉广告平台吗？' +
        '告诉后，平台会去找更多像他这样真会掏钱的人，同样的预算能带回更多真客户；' +
        '不告诉，平台会继续找那些爱填表但不付钱的人。'
    }

    if (expired) {
      what += ` ⚠️ 这条已经过去 ${age} 天，广告平台只收 7 天内的 —— 现在告诉它也收不进去了，可以直接选「不发送」。`
    }

    items.push({
      kind: 'conversion_needs_review',
      client_name: clientName,
      client_id: row.client_id,
      what,
      how: expired
        ? '打开页面，在这条上点「不发送」并选原因「超过时限」即可。'
        : '打开页面，看一眼客人和金额对不对，对就点「告诉广告平台」（会再确认一次），不对就点「不发送」并选个原因。',
      // 🔴 必须是绝对网址。相对路径会被 dropBrokenLinks 静默丢掉
      //    （同 `cross_client_leak` 那次事故，见 manual-items.ts:1540）。
      href: `https://app.magicengine.com.au/dashboard/conversions?client=${row.client_id}&focus=${row.id}`,
    })
  }

  // ── 发出去了但不知道对方收没收 ──────────────────────────────────────
  // 这一档程序绝不会自己重发 —— 重发一次就是永久多记一笔成交，撤不回。
  const { data: doubts, error: doubtErr } = await supabase
    .from('me_conversion_writebacks')
    .select('id, outcome_id, me_sale_outcomes(client_id, customer_first, order_ref)')
    .eq('status', 'in_doubt')
    .limit(MAX_ITEMS)

  if (doubtErr) throw new Error(`不确定状态查询失败: ${doubtErr.message}`)

  for (const row of (doubts ?? []) as unknown as DoubtRow[]) {
    const outcome = row.me_sale_outcomes
    if (!outcome) continue
    const clientName = clientNames.get(outcome.client_id)?.name ?? '客户'

    items.push({
      kind: 'conversion_send_in_doubt',
      client_name: clientName,
      client_id: outcome.client_id,
      what:
        `有一笔成交${outcome.order_ref ? `（单号 ${outcome.order_ref}）` : ''}发给广告平台时断线了，` +
        '不确定对方收到没有。系统**不会**自己重发 —— 万一对方其实收到了，重发就等于把同一笔算成两笔，而且撤不回。',
      how:
        '去广告平台后台的事件管理页看一眼这笔在不在：' +
        '在，就点「已确认收到」；不在，就点「重新发送」。',
      // 🔴 必须是绝对网址（见上面同类注释）。
      // 带上 focus=<outcome_id> —— 同客户多条 in_doubt 时，光滚到 "需要你动手"
      // 区块不够，PM 分不清邮件说的是哪一笔。page.tsx 的 focus effect 会用这个
      // id 定位到具体卡片，找不到就静默不动（stuck 空表面上说明已处理完）。
      href: `https://app.magicengine.com.au/dashboard/conversions?client=${outcome.client_id}&focus=${row.outcome_id}&status=in_doubt`,
    })
  }

  await pushTokenDeadItems(supabase, items, clientNames, now)
  await pushHeldSendItems(supabase, items, clientNames, now)
  await pushUnsentQualifiedLeads(supabase, items, clientNames, now)
  await pushQualifiedLeadsNeverRecorded(supabase, items, clientNames, now)
  await pushMissingDealStageCompanions(supabase, items, clientNames, now)
}

type HeldOutcome = {
  client_id: string
  outcome_kind?: 'purchase' | 'balance' | 'lead'
  occurred_at: string
  review_status: string
  redacted_at: string | null
}

type HeldRow = {
  outcome_id: string
  me_sale_outcomes: HeldOutcome | null
}

/**
 * 已批准、但被允许名单停在队列里的成交。没有新的定时任务：人改完名单后
 * 在成交页点「再试一次」，发送口会再查名单和 7 天窗口。
 */
function isDealKind(kind: HeldOutcome['outcome_kind']): boolean {
  return kind === 'purchase' || kind === 'balance'
}

function tallyHeld(
  rows: HeldRow[],
  now: Date,
  wantDeal: boolean,
): Map<string, { count: number; oldestId: string; oldest: string }> {
  const byClient = new Map<string, { count: number; oldestId: string; oldest: string }>()
  for (const row of rows) {
    const o = row.me_sale_outcomes
    if (!o || o.review_status !== 'approved' || o.redacted_at) continue
    if (isPastEventWindow(o.occurred_at, now)) continue
    const wanted = wantDeal ? isDealKind(o.outcome_kind) : o.outcome_kind === 'lead'
    if (!wanted) continue
    const cur = byClient.get(o.client_id)
    if (!cur) {
      byClient.set(o.client_id, { count: 1, oldestId: row.outcome_id, oldest: o.occurred_at })
      continue
    }
    cur.count += 1
    if (o.occurred_at < cur.oldest) {
      cur.oldest = o.occurred_at
      cur.oldestId = row.outcome_id
    }
  }
  return byClient
}

function appendHeldLines(
  rows: HeldRow[],
  items: ManualItem[],
  clientNames: Map<string, { name: string }>,
  now: Date,
): void {
  const byClient = tallyHeld(rows, now, true)
  for (const [clientId, agg] of byClient) {
    const daysLeft = Math.max(0, 7 - daysAgo(agg.oldest, now))
    const when = daysLeft === 0 ? '今天就会过期' : `再过 ${daysLeft} 天就过期`
    items.push({
      kind: 'conversion_needs_review',
      client_name: clientNames.get(clientId)?.name ?? '客户',
      client_id: clientId,
      what:
        `有 ${agg.count} 笔已经批准的成交按这个客户允许发送的名单先停住了，没有发出去。` +
        `最早的一笔${when}。名单改好之前它们不会自己发出去。`,
      how: '名单改好之后，打开这一页，在「需要你动手」里点「再试一次」。还在 7 天内、而且名单允许，才会发出去。',
      href: `https://app.magicengine.com.au/dashboard/conversions?client=${clientId}&focus=${agg.oldestId}&status=held`,
    })
  }
  for (const [clientId, agg] of tallyHeld(rows, now, false)) {
    items.push({
      kind: 'conversion_needs_review',
      client_name: clientNames.get(clientId)?.name ?? '客户',
      client_id: clientId,
      what: '按名单不发，不用处理。',
      how: `这 ${agg.count} 条已批准的咨询不在允许发送的名单里。不用改名单，也不用重发。`,
      href: `https://app.magicengine.com.au/dashboard/conversions?client=${clientId}`,
    })
  }
}

async function loadHeldRows(supabase: SupabaseClient, now: Date, kinds: string[]): Promise<HeldRow[]> {
  const since = new Date(now.getTime() - META_EVENT_WINDOW_DAYS * DAY_MS).toISOString()
  const { data, error } = await supabase
    .from('me_conversion_writebacks')
    .select('id, outcome_id, me_sale_outcomes!inner(client_id, outcome_kind, occurred_at, review_status, redacted_at)')
    .eq('status', 'queued')
    .contains('payload_preview', { held: true })
    .eq('me_sale_outcomes.review_status', 'approved')
    .is('me_sale_outcomes.redacted_at', null)
    .in('me_sale_outcomes.outcome_kind', kinds)
    .gte('me_sale_outcomes.occurred_at', since)
    .order('occurred_at', { foreignTable: 'me_sale_outcomes', ascending: false })
    .limit(200)
  if (error) throw new Error(`名单停住待补发查询失败: ${error.message}`)
  return (data ?? []) as unknown as HeldRow[]
}

type QualifiedLeadRow = {
  id: string
  client_id: string
  source_ref: string | null
  meta_lead_id: string | null
  occurred_at: string
}

type QualifiedWriteback = {
  outcome_id: string
  event_id: string | null
  status: string
  last_error_code: string | null
  payload_preview: { held?: boolean } | null
}

/** Approved quoted leads whose send is missing, still queued, or failed. Not auth, not a held row. */
async function pushUnsentQualifiedLeads(
  supabase: SupabaseClient,
  items: ManualItem[],
  clientNames: Map<string, { name: string }>,
  now: Date,
): Promise<void> {
  const leads = await loadQualifiedLeads(supabase, now)
  if (leads.length === 0) return
  const writebacks = await loadQualifiedWritebacks(supabase, leads.map((lead) => lead.id))
  let added = 0
  for (const lead of leads) {
    if (added >= MAX_ITEMS) break
    if (!legalMetaLeadId(lead.meta_lead_id)) continue
    if (!needsQualifiedRetry(lead.id, writebacks)) continue
    items.push(qualifiedRetryItem(lead, clientNames))
    added += 1
  }
}

async function loadQualifiedLeads(supabase: SupabaseClient, now: Date): Promise<QualifiedLeadRow[]> {
  const since = new Date(now.getTime() - META_EVENT_WINDOW_DAYS * DAY_MS).toISOString()
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .select('id, client_id, source_ref, meta_lead_id, occurred_at')
    .eq('review_status', 'approved')
    .eq('outcome_kind', 'lead')
    .eq('source_kind', 'crm_stage_manual')
    .like('source_ref', 'crm_qualified:%')
    .not('meta_lead_id', 'is', null)
    .is('redacted_at', null)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: true })
    .limit(FILTERED_SCAN)
  if (error) throw new Error(`已报价未发出查询失败: ${error.message}`)
  return ((data ?? []) as unknown as QualifiedLeadRow[]).filter((row) => openQualifiedLead(row, now))
}

function openQualifiedLead(row: QualifiedLeadRow, now: Date): boolean {
  if (typeof row.source_ref !== 'string' || !row.source_ref.startsWith('crm_qualified:')) return false
  return !isPastEventWindow(row.occurred_at, now)
}

async function loadQualifiedWritebacks(
  supabase: SupabaseClient,
  outcomeIds: string[],
): Promise<QualifiedWriteback[]> {
  const rows: QualifiedWriteback[] = []
  for (let start = 0; start < outcomeIds.length; start += WRITEBACK_ID_BATCH) {
    const batch = outcomeIds.slice(start, start + WRITEBACK_ID_BATCH)
    rows.push(...await loadQualifiedWritebackBatch(supabase, batch))
  }
  return rows
}

async function loadQualifiedWritebackBatch(
  supabase: SupabaseClient,
  outcomeIds: string[],
): Promise<QualifiedWriteback[]> {
  const { data, error } = await supabase
    .from('me_conversion_writebacks')
    .select('outcome_id, event_id, status, last_error_code, payload_preview')
    .in('outcome_id', outcomeIds)
  if (error) throw new Error(`已报价发送记录查询失败: ${error.message}`)
  return (data ?? []) as unknown as QualifiedWriteback[]
}

function needsQualifiedRetry(outcomeId: string, writebacks: QualifiedWriteback[]): boolean {
  const own = writebacks.filter((row) => row.outcome_id === outcomeId && (row.event_id == null || row.event_id === outcomeId))
  if (own.length === 0) return true
  const row = own[0]
  if (row.payload_preview?.held === true) return false
  if (row.last_error_code === 'auth') return false
  return row.status === 'queued' || row.status === 'failed'
}

type StageContact = { id: string; client_id: string; stage: string | null; stage_updated_at: string | null }
type LeadBackedContact = StageContact & { leadId: string }
type ClientGate = { id: string; conversion_stage: string | null; leads_config: unknown }
type QualifiedOutcomeRef = { source_ref: string | null }

/** Stage saved, but the qualified row never landed. The next stage scan will not try again. */
async function pushQualifiedLeadsNeverRecorded(
  supabase: SupabaseClient,
  items: ManualItem[],
  clientNames: Map<string, { name: string }>,
  now: Date,
): Promise<void> {
  const gates = await loadLiveQualifiedGates(supabase)
  if (gates.length === 0) return
  const contacts = await loadQualifiedStageContacts(supabase, now, gates)
  if (contacts.length === 0) return
  const withLead = await contactsWithMetaLead(supabase, contacts)
  if (withLead.length === 0) return
  const recorded = await loadQualifiedOutcomeRefs(supabase, withLead.map((row) => row.id))
  const waiting = withLead.filter((row) => !leadAlreadyRecorded(row, recorded))
  for (const row of waiting.slice(0, MAX_ITEMS)) items.push(missingQualifiedItem(row, clientNames))
}

async function loadLiveQualifiedGates(supabase: SupabaseClient): Promise<ClientGate[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, conversion_stage, leads_config')
    .eq('conversion_stage', 'live')
    .limit(FILTERED_SCAN)
  if (error) throw new Error(`已报价客户设置查询失败: ${error.message}`)
  return ((data ?? []) as unknown as ClientGate[]).filter((gate) => gateOpensQualified(gate))
}

function gateOpensQualified(gate: ClientGate): boolean {
  if (gate.conversion_stage !== 'live') return false
  const cfg = readCapiClientConfig(gate.leads_config)
  return cfg.conversionLeadsEnabled && !cfg.qualifiedLeadStageMalformed && Boolean(cfg.qualifiedLeadStageKey)
}

async function loadQualifiedStageContacts(
  supabase: SupabaseClient,
  now: Date,
  gates: ClientGate[],
): Promise<StageContact[]> {
  const keys = qualifiedStageKeys(gates)
  if (keys.length === 0) return []
  const since = new Date(now.getTime() - META_EVENT_WINDOW_DAYS * DAY_MS).toISOString()
  const { data, error } = await supabase
    .from('contacts')
    .select('id, client_id, stage, stage_updated_at')
    .in('client_id', gates.map((gate) => gate.id))
    .in('stage', keys)
    .gte('stage_updated_at', since)
    .order('stage_updated_at', { ascending: true })
    .limit(FILTERED_SCAN)
  if (error) throw new Error(`已报价没记上查询失败: ${error.message}`)
  return ((data ?? []) as unknown as StageContact[])
    .filter((row) => openStageContact(row, now) && contactWaitsForQualifiedRow(row, gates))
}

function qualifiedStageKeys(gates: ClientGate[]): string[] {
  const keys = new Set<string>()
  for (const gate of gates) {
    const key = readCapiClientConfig(gate.leads_config).qualifiedLeadStageKey
    if (key) keys.add(key)
  }
  return [...keys]
}

function openStageContact(row: StageContact, now: Date): boolean {
  if (!row.id || !row.client_id || !row.stage || !row.stage_updated_at) return false
  return !isPastEventWindow(row.stage_updated_at, now)
}

async function contactsWithMetaLead(supabase: SupabaseClient, rows: StageContact[]): Promise<LeadBackedContact[]> {
  if (rows.length === 0) return []
  const { data, error } = await supabase
    .from('contact_touchpoints')
    .select('contact_id, source_ref, occurred_at')
    .eq('source', 'meta_lead_form')
    .in('contact_id', rows.map((row) => row.id))
    .limit(FILTERED_SCAN)
  if (error) throw new Error(`已报价线索编号查询失败: ${error.message}`)
  const byContact = new Map<string, Array<{ source_ref?: unknown; occurred_at?: unknown }>>()
  for (const point of (data ?? []) as Array<{ contact_id?: string; source_ref?: unknown; occurred_at?: unknown }>) {
    if (!point.contact_id) continue
    const list = byContact.get(point.contact_id) ?? []
    list.push(point)
    byContact.set(point.contact_id, list)
  }
  const found: LeadBackedContact[] = []
  for (const row of rows) {
    const leadId = latestMetaLeadId(byContact.get(row.id) ?? [])
    if (leadId) found.push({ ...row, leadId })
  }
  return found
}

function contactWaitsForQualifiedRow(row: StageContact, gates: ClientGate[]): boolean {
  const gate = gates.find((item) => item.id === row.client_id)
  if (!gate || gate.conversion_stage !== 'live') return false
  const cfg = readCapiClientConfig(gate.leads_config)
  if (!cfg.conversionLeadsEnabled || cfg.qualifiedLeadStageMalformed) return false
  return stageCountsAsQualifiedLead(row.stage, cfg.qualifiedLeadStageKey)
}

async function loadQualifiedOutcomeRefs(supabase: SupabaseClient, contactIds: string[]): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .select('source_ref')
    .eq('source_kind', 'crm_stage_manual')
    .eq('outcome_kind', 'lead')
    .in('contact_id', contactIds)
    .limit(FILTERED_SCAN)
  if (error) throw new Error(`已报价是否已记查询失败: ${error.message}`)
  const found = new Set<string>()
  for (const row of (data ?? []) as unknown as QualifiedOutcomeRef[]) {
    const key = redactQualifiedSourceRef(row.source_ref)
    if (key?.startsWith('crm_qualified:')) found.add(key)
  }
  return found
}

/** Same lead-id digest and stage as the row the send path would have written. */
function leadAlreadyRecorded(row: LeadBackedContact, recorded: Set<string>): boolean {
  if (!row.stage) return true
  return recorded.has(qualifiedLeadSourceRef(row.leadId, row.stage))
}

function missingQualifiedItem(row: StageContact, clientNames: Map<string, { name: string }>): ManualItem {
  return {
    kind: 'conversion_needs_review',
    client_name: clientNames.get(row.client_id)?.name ?? '客户',
    client_id: row.client_id,
    what: '有一条已报价记下了，但发给广告平台这一步没记上。不补的话，广告平台不知道这个人已经问过价。',
    how: '打开这个客人，把阶段改成别的，再改回已报价。改回来会再记一次，不会记成两笔。',
    href: `https://app.magicengine.com.au/dashboard/clients/${row.client_id}/crm/all?contact=${row.id}`,
  }
}

function qualifiedRetryItem(lead: QualifiedLeadRow, clientNames: Map<string, { name: string }>): ManualItem {
  return {
    kind: 'conversion_needs_review',
    client_name: clientNames.get(lead.client_id)?.name ?? '客户',
    client_id: lead.client_id,
    what: '有一条已报价发给广告平台没成功。不补发的话，广告平台不知道这个人已经问过价。',
    how: '打开这一页，找到这一条，点「再试一次」。同一条不会发成两笔。',
    href: `https://app.magicengine.com.au/dashboard/conversions?client=${lead.client_id}&focus=${lead.id}`,
  }
}

async function pushHeldSendItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  clientNames: Map<string, { name: string }>,
  now: Date,
): Promise<void> {
  const deals = await loadHeldRows(supabase, now, ['purchase', 'balance'])
  const leads = await loadHeldRows(supabase, now, ['lead'])
  appendHeldLines([...deals, ...leads], items, clientNames, now)
}

type AuthFailedRow = {
  id: string
  outcome_id: string
  me_sale_outcomes: { client_id: string; occurred_at: string; review_status: string; redacted_at: string | null } | null
}

/**
 * 已批准、但因**授权失效**发不出去的成交/咨询——按客户合并成一条「需要你动手」。
 *
 * 2026-09-22 起授权失败不再永久作废，而是等令牌修好后由 `writeback-resend-run.ts`
 * 每天自动补发；但「令牌还没修好」这件事之前只写在 cron summary 里，PM 看不见，
 * CTS 19 条就是这样静静过了 7 天窗口的（子牙复审 M2：发现不许死在日志里）。
 * 这里是拉模式：直接查库，不依赖补发步骤有没有跑。
 */
async function pushTokenDeadItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  clientNames: Map<string, { name: string }>,
  now: Date,
): Promise<void> {
  const { data, error } = await supabase
    .from('me_conversion_writebacks')
    .select('id, outcome_id, me_sale_outcomes(client_id, occurred_at, review_status, redacted_at)')
    .eq('status', 'failed')
    .eq('last_error_code', 'auth')
    .limit(200)

  if (error) throw new Error(`授权失效待补发查询失败: ${error.message}`)

  const byClient = new Map<string, { count: number; oldestOccurredAt: string }>()
  for (const row of (data ?? []) as unknown as AuthFailedRow[]) {
    const o = row.me_sale_outcomes
    if (!o || o.review_status !== 'approved' || o.redacted_at) continue
    // 已经过了 7 天的补发步骤会自己判过期，这里只催还救得回来的。
    if (isPastEventWindow(o.occurred_at, now)) continue
    const cur = byClient.get(o.client_id)
    if (!cur) byClient.set(o.client_id, { count: 1, oldestOccurredAt: o.occurred_at })
    else {
      cur.count++
      if (o.occurred_at < cur.oldestOccurredAt) cur.oldestOccurredAt = o.occurred_at
    }
  }

  for (const [clientId, agg] of byClient) {
    const clientName = clientNames.get(clientId)?.name ?? '客户'
    const daysLeft = Math.max(0, 7 - daysAgo(agg.oldestOccurredAt, now))
    items.push({
      kind: 'conversion_capi_token_dead',
      client_name: clientName,
      client_id: clientId,
      what:
        `有 ${agg.count} 条已经批准的成交/咨询发不到广告平台：连接广告平台的授权失效了。` +
        `最早的一条再过 ${daysLeft} 天就超过平台只收 7 天内的限制，到时候这些就永久丢了，` +
        '广告平台会继续找不对的人。',
      how:
        '重新连接一次这个客户的广告平台授权（跟上次令牌过期时同一个步骤）。' +
        '连好之后不用手动补发——系统每天早上会自动把还在 7 天内的补发出去，看板上这些条目会自己消失。',
      // 🔴 必须是绝对网址（见上面同类注释）。
      href: `https://app.magicengine.com.au/dashboard/conversions?client=${clientId}&status=failed`,
    })
  }
}

type DealCompanionRow = {
  id: string
  client_id: string
  meta_lead_id: string | null
  occurred_at: string
  order_ref: string | null
}

/** Purchase recorded, but the lead-stage send is missing, queued, or failed for a reason other than auth. */
async function pushMissingDealStageCompanions(
  supabase: SupabaseClient,
  items: ManualItem[],
  clientNames: Map<string, { name: string }>,
  now: Date,
): Promise<void> {
  const gates = await loadLiveDealGates(supabase)
  if (gates.length === 0) return
  const deals = await loadDealsAwaitingCompanion(supabase, now, gates)
  if (deals.length === 0) return
  const settled = await loadSettledCompanionEventIds(supabase, deals.map((deal) => dealStageEventId(deal.id)))
  let added = 0
  for (const deal of deals) {
    if (added >= MAX_ITEMS) break
    if (settled.has(dealStageEventId(deal.id))) continue
    if (!dealStillExpectsCompanion(deal, gates)) continue
    items.push(missingCompanionItem(deal, clientNames))
    added += 1
  }
}

async function loadLiveDealGates(supabase: SupabaseClient): Promise<ClientGate[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, conversion_stage, leads_config')
    .eq('conversion_stage', 'live')
    .limit(FILTERED_SCAN)
  if (error) throw new Error(`成交下一步客户设置查询失败: ${error.message}`)
  return ((data ?? []) as unknown as ClientGate[]).filter((gate) => gateOpensDealStage(gate))
}

function gateOpensDealStage(gate: ClientGate): boolean {
  if (gate.conversion_stage !== 'live') return false
  const cfg = readCapiClientConfig(gate.leads_config)
  return cfg.conversionLeadsEnabled && Boolean(cfg.conversionDealStageKey)
}

async function loadDealsAwaitingCompanion(
  supabase: SupabaseClient,
  now: Date,
  gates: ClientGate[],
): Promise<DealCompanionRow[]> {
  const since = new Date(now.getTime() - META_EVENT_WINDOW_DAYS * DAY_MS).toISOString()
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .select('id, client_id, meta_lead_id, occurred_at, order_ref')
    .in('client_id', gates.map((gate) => gate.id))
    .in('outcome_kind', ['purchase', 'balance'])
    .eq('review_status', 'approved')
    .is('redacted_at', null)
    .not('meta_lead_id', 'is', null)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: true })
    .limit(FILTERED_SCAN)
  if (error) throw new Error(`成交下一步查询失败: ${error.message}`)
  return ((data ?? []) as unknown as DealCompanionRow[]).filter((row) => !isPastEventWindow(row.occurred_at, now))
}

function dealStillExpectsCompanion(row: DealCompanionRow, gates: ClientGate[]): boolean {
  const gate = gates.find((item) => item.id === row.client_id)
  if (!gate || !legalMetaLeadId(row.meta_lead_id)) return false
  return gateOpensDealStage(gate)
}

type CompanionWriteback = {
  event_id?: string | null
  status?: string
  last_error_code?: string | null
  payload_preview?: { held?: boolean } | null
}

/** Ordinary queue and non-auth failures still need a person. Auth and allow-list holds do not. */
function stageSendNeedsPerson(row: CompanionWriteback): boolean {
  if (row.payload_preview?.held === true) return false
  if (row.last_error_code === 'auth') return false
  return row.status === 'queued' || row.status === 'failed'
}

async function loadSettledCompanionEventIds(supabase: SupabaseClient, eventIds: string[]): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('me_conversion_writebacks')
    .select('event_id, status, last_error_code, payload_preview')
    .in('event_id', eventIds)
    .limit(FILTERED_SCAN)
  if (error) throw new Error(`成交下一步发送记录查询失败: ${error.message}`)
  const found = new Set<string>()
  for (const row of (data ?? []) as CompanionWriteback[]) {
    if (!row.event_id || stageSendNeedsPerson(row)) continue
    found.add(row.event_id)
  }
  return found
}

function missingCompanionItem(deal: DealCompanionRow, clientNames: Map<string, { name: string }>): ManualItem {
  return {
    kind: 'conversion_needs_review',
    client_name: clientNames.get(deal.client_id)?.name ?? '客户',
    client_id: deal.client_id,
    what: `有一笔成交${deal.order_ref ? `（单号 ${deal.order_ref}）` : ''}的下一步还没记上。不补的话，广告平台只知道收了款，不知道这是同一条线索的下一步。`,
    how: '打开这一页，找到这一条，点「再试一次」。已经发出去的那笔不会再发一次。',
    href: `https://app.magicengine.com.au/dashboard/conversions?client=${deal.client_id}&focus=${deal.id}`,
  }
}
