/**
 * CTS CRM 表格同步——编排层（Issue #1397 CAPI 续，2026-09-13）。
 *
 * 纯 I/O 编排：读表 → 关联两个 tab → 分类（`cts-crm-sheet-sync.ts`）→ 查价
 * （`cts-tour-price.ts`）→ 关联既有联系人 → 写 `me_sale_outcomes`。分类规则
 * 本身不在这里，方便单测；这一层只负责把各块接起来。
 *
 * 单独导出成一个函数（不塞进 API 路由 handler 里），是子牙复审建议：以后如果
 * 这条同步要转成 Inngest 事件处理器，直接复用这个函数，不用重写判断逻辑。
 *
 * ~~这一轮**只人工触发**，不接 cron/Inngest~~ —— 2026-09-15 起由
 * `conversion-daily-pipeline`（Inngest）每天自动调；2026-09-22 起改成**分块**调
 * `runCtsCrmSyncChunk()`（每块 ≤ 20 行）：整表一步跑 4–24 分钟，被网关 ~125 秒
 * 超时强杀，流水线连续 6 天没跑完（PITFALLS F10 第二实例）。手动路由仍走
 * `runCtsCrmSync()` 一次跑整表，两条调用路径并存。
 *
 * `maxInsertsPerRun` 是给现有人工审核页面（固定 limit=200）留的安全阀：不会
 * 一次性把几百条历史存量全灌进待审核队列，超出的部分下次再跑会继续处理
 * （已经写过的靠幂等键快速跳过，不会重复劳动）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { readSheetValues } from '@/lib/google-sheets/client'
import { buildIdentities } from '@/lib/crm/identity'
import { buildIntakeRow, type IntakeInput } from './intake'
import { lookupTourPrice } from './cts-tour-price'
import { toMajorUnits } from './money'
import {
  parseSheet1Row,
  parseCrmManagementRow,
  classifyCtsCrmPerson,
  ctsPhoneE164,
  ctsSourceRef,
  type Sheet1LeadRow,
} from './cts-crm-sheet-sync'

/** 同 `src/lib/seo-meta/cts-meta-pr.ts` 里的 CTS_CLIENT_ID —— 同一个客户，不同域各自声明这个字面量是既有惯例。 */
const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const SPREADSHEET_ID = '1vISaVkVkcQMSaR6Jo7xdmym6Ed5eE-q9025snYWYDVA'
const SHEET1_RANGE = 'Sheet1!A2:R'
const CRM_MANAGEMENT_RANGE = 'CRM管理!A2:H'
const DEFAULT_MAX_INSERTS_PER_RUN = 50
/** CTS 官网价格 feed（`first-party-tours.ts`）如果注册了，会用这个域名查——没注册就跳过这一步，不报错。 */
const CTS_WEBSITE_DOMAIN = 'ctstours.co.nz'

export interface HeldItem {
  /** 只露最后 4 位，这份摘要可能被贴进聊天/工单。 */
  phoneMasked: string
  tourInterest: string | null
  reason: string
}

export interface CtsCrmSyncSummary {
  totalCrmRows: number
  excludedNoPhone: number
  excludedByNotes: number
  excludedNoDate: number
  insertedLeads: number
  insertedPurchases: number
  /** 已经同步过、这次命中幂等键被跳过——预期行为，不是错误。 */
  skippedAlreadySynced: number
  /** 阶段=已订金/已出行，但查不到价格或缺真实成交日期，搁置未写入。 */
  heldForManualReview: HeldItem[]
  /** 没能在 contacts 里找到匹配的人——这些行的 do_not_contact 检查这次不生效。 */
  contactNotLinked: number
  insertErrors: Array<{ phoneMasked: string; error: string }>
  cappedAtMaxInserts: boolean
}

function maskPhone(phone: string): string {
  return phone.length > 4 ? `***${phone.slice(-4)}` : phone
}

function emptySummary(): CtsCrmSyncSummary {
  return {
    totalCrmRows: 0,
    excludedNoPhone: 0,
    excludedByNotes: 0,
    excludedNoDate: 0,
    insertedLeads: 0,
    insertedPurchases: 0,
    skippedAlreadySynced: 0,
    heldForManualReview: [],
    contactNotLinked: 0,
    insertErrors: [],
    cappedAtMaxInserts: false,
  }
}

/** Sheet1 按电话建索引，供 CRM管理 逐行关联；查不到有效电话的行直接跳过索引。 */
function indexSheet1ByPhone(rows: Sheet1LeadRow[]): Map<string, Sheet1LeadRow> {
  const map = new Map<string, Sheet1LeadRow>()
  for (const row of rows) {
    const phone = ctsPhoneE164(row.phoneRaw)
    if (phone && !map.has(phone)) map.set(phone, row)
  }
  return map
}

/**
 * 只读匹配既有联系人——不新建、不合并。这条同步的职责是记录 CAPI 事实，不是
 * 建联系人（那是 `meta-leads-hourly` cron 已经在做的事，见 `crm/meta-lead.ts`）。
 * 匹配不上就如实留空，调用方把这类行计进 `contactNotLinked`。
 */
async function findExistingContactId(
  supabase: SupabaseClient,
  clientId: string,
  phone: string | null,
  email: string | null,
): Promise<string | null> {
  const identities = buildIdentities({ phone, email, defaultCountry: 'NZ' })
  if (identities.length === 0) return null

  const { data } = await supabase
    .from('contact_identities')
    .select('contact_id, kind, value')
    .eq('client_id', clientId)
    .in(
      'value',
      identities.map((i) => i.value),
    )

  const matched = (data ?? []).filter((h) =>
    identities.some((i) => i.kind === h.kind && i.value === h.value),
  )
  const contactIds = [...new Set(matched.map((m) => m.contact_id as string))]
  // 两个不同的既有联系人都命中——含糊不清，宁可留空交给人工审核页面上的
  // "未关联联系人"提示，也不要猜一个。
  return contactIds.length === 1 ? contactIds[0] : null
}

async function insertOutcome(
  supabase: SupabaseClient,
  input: IntakeInput,
  phoneMasked: string,
  summary: CtsCrmSyncSummary,
  onSuccess: () => void,
): Promise<void> {
  const built = buildIntakeRow(input, { defaultPhoneCountry: '64', now: new Date() })
  if (!built.ok) {
    summary.insertErrors.push({ phoneMasked, error: built.errors.join('; ') })
    return
  }

  const { data, error } = await supabase.from('me_sale_outcomes').insert(built.row).select('id').single()

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      // 幂等键命中——正常去重，见 ctsSourceRef 的设计说明。
      summary.skippedAlreadySynced++
      return
    }
    summary.insertErrors.push({ phoneMasked, error: error.message })
    return
  }

  await supabase.from('me_conversion_audit').insert({
    outcome_id: (data as { id: string }).id,
    action: 'created',
    actor: 'cts-crm-sheet-sync',
    detail: { source_kind: input.sourceKind, source_ref: input.sourceRef },
  })
  onSuccess()
}

export interface RunCtsCrmSyncDeps {
  supabase?: SupabaseClient
  maxInsertsPerRun?: number
}

/**
 * 分块游标——给 Inngest 逐块推进用（2026-09-22，PITFALLS F10 第二实例）。
 *
 * 🔴 三个字段全是 number：它要经过 Inngest 的 step 记忆化（JSON 序列化），
 *    `Date`/`undefined`/`Infinity` 都会在那一层变形。
 */
export interface CtsCrmSyncCursor {
  /** 从 CRM管理 的第几行（0 起）开始处理。 */
  offset: number
  /** 这一块最多看多少行；不传 = 一直看到表尾（手动路由沿用这个）。 */
  limit?: number
  /** 之前几块累计写入了多少条——`maxInsertsPerRun` 这道安全阀要跨块生效。 */
  insertedSoFar: number
}

export interface CtsCrmSyncChunkResult {
  /** 只含这一块处理的行；跨块汇总用 `mergeCtsCrmSummaries`。 */
  summary: CtsCrmSyncSummary
  nextOffset: number
  /** 这次读到的 CRM管理 总行数——两块之间表格可能变化，以每次读到的为准。 */
  totalSheetRows: number
  insertedSoFar: number
  /** 已经看到表尾。 */
  done: boolean
}

/** 跨块合并：计数相加、清单拼接（搁置项按打码电话+团名去重——同一行在两块之间因表格插行被看两次时不重复列）。 */
export function mergeCtsCrmSummaries(a: CtsCrmSyncSummary, b: CtsCrmSyncSummary): CtsCrmSyncSummary {
  const heldKeys = new Set(a.heldForManualReview.map((h) => `${h.phoneMasked}|${h.tourInterest ?? ''}`))
  const held = [...a.heldForManualReview]
  for (const h of b.heldForManualReview) {
    const key = `${h.phoneMasked}|${h.tourInterest ?? ''}`
    if (!heldKeys.has(key)) {
      heldKeys.add(key)
      held.push(h)
    }
  }
  return {
    totalCrmRows: a.totalCrmRows + b.totalCrmRows,
    excludedNoPhone: a.excludedNoPhone + b.excludedNoPhone,
    excludedByNotes: a.excludedByNotes + b.excludedByNotes,
    excludedNoDate: a.excludedNoDate + b.excludedNoDate,
    insertedLeads: a.insertedLeads + b.insertedLeads,
    insertedPurchases: a.insertedPurchases + b.insertedPurchases,
    skippedAlreadySynced: a.skippedAlreadySynced + b.skippedAlreadySynced,
    heldForManualReview: held,
    contactNotLinked: a.contactNotLinked + b.contactNotLinked,
    insertErrors: [...a.insertErrors, ...b.insertErrors],
    cappedAtMaxInserts: a.cappedAtMaxInserts || b.cappedAtMaxInserts,
  }
}

/** Supabase 一次最多回 1000 行（PITFALLS F9）——按主键分页读全。 */
const EXISTING_REFS_PAGE = 1000

/**
 * 已同步过的幂等键集合——在任何按行的数据库往返之前先判「已同步」直接跳过。
 *
 * 🔴 这不是安全闸，只是省事：真正防重复的仍是 `(client_id, source_kind, source_ref)`
 *    唯一索引 + 23505 处理。没有这一步时，600 行历史行每行都要先查联系人、查价、
 *    再撞唯一索引（每行 3–5 次往返，实测 0.4–2.4 秒/行），拆块只是把 20 分钟分摊、
 *    没有减少（子牙 2026-09-22 复审 M6）。
 */
async function loadExistingSourceRefs(supabase: SupabaseClient): Promise<Set<string>> {
  const refs = new Set<string>()
  let lastId: string | null = null
  for (;;) {
    let q = supabase
      .from('me_sale_outcomes')
      .select('id, source_ref')
      .eq('client_id', CTS_CLIENT_ID)
      .eq('source_kind', 'crm_sheet_sync')
      .not('source_ref', 'is', null)
      .order('id', { ascending: true })
      .limit(EXISTING_REFS_PAGE)
    if (lastId) q = q.gt('id', lastId)
    const { data, error } = await q
    if (error) throw new Error(`读取已同步记录失败：${error.message}`)
    const rows = (data ?? []) as Array<{ id: string; source_ref: string | null }>
    for (const r of rows) if (r.source_ref) refs.add(r.source_ref)
    if (rows.length < EXISTING_REFS_PAGE) break
    lastId = rows[rows.length - 1].id
  }
  return refs
}

function tallyExcluded(summary: CtsCrmSyncSummary, reason: 'no_qualifying_phone' | 'excluded_by_notes' | 'no_usable_date'): void {
  if (reason === 'no_qualifying_phone') summary.excludedNoPhone++
  else if (reason === 'excluded_by_notes') summary.excludedByNotes++
  else summary.excludedNoDate++
}

/** 一条合格线索：关联联系人、组装、写库。 */
async function processQualifiedLead(
  supabase: SupabaseClient,
  classified: Extract<ReturnType<typeof classifyCtsCrmPerson>, { kind: 'qualified_lead' }>,
  summary: CtsCrmSyncSummary,
  markInserted: () => void,
): Promise<void> {
  const phoneMasked = maskPhone(classified.phoneE164)
  const contactId = await findExistingContactId(supabase, CTS_CLIENT_ID, classified.phoneE164, classified.email)
  if (!contactId) summary.contactNotLinked++

  await insertOutcome(
    supabase,
    {
      clientId: CTS_CLIENT_ID,
      contactId,
      outcomeKind: 'lead',
      customerPhone: classified.phoneE164,
      customerEmail: classified.email,
      customerFirst: classified.fullName,
      occurredAt: classified.occurredAt,
      sourceKind: 'crm_sheet_sync',
      sourceRef: ctsSourceRef(classified.phoneE164, 'lead'),
    },
    phoneMasked,
    summary,
    () => {
      summary.insertedLeads++
      markInserted()
    },
  )
}

/** 一条成交候选：关联联系人、查价，查到才写库，查不到搁置人工。 */
async function processPurchaseCandidate(
  supabase: SupabaseClient,
  classified: Extract<ReturnType<typeof classifyCtsCrmPerson>, { kind: 'purchase_candidate' }>,
  summary: CtsCrmSyncSummary,
  markInserted: () => void,
): Promise<void> {
  const phoneMasked = maskPhone(classified.phoneE164)
  const contactId = await findExistingContactId(supabase, CTS_CLIENT_ID, classified.phoneE164, classified.email)
  if (!contactId) summary.contactNotLinked++

  const price = await lookupTourPrice(supabase, CTS_CLIENT_ID, classified.tourInterest, CTS_WEBSITE_DOMAIN)
  const majorAmount = price ? toMajorUnits(price.amountMinor, price.currency) : null
  if (!price || majorAmount == null) {
    summary.heldForManualReview.push({
      phoneMasked,
      tourInterest: classified.tourInterest,
      reason: `官网/团数据里查不到"${classified.tourInterest}"的价格，需要人工核实金额`,
    })
    return
  }

  await insertOutcome(
    supabase,
    {
      clientId: CTS_CLIENT_ID,
      contactId,
      outcomeKind: 'purchase',
      customerPhone: classified.phoneE164,
      customerEmail: classified.email,
      customerFirst: classified.fullName,
      amount: majorAmount,
      currency: price.currency,
      occurredAt: classified.occurredAt,
      sourceKind: 'crm_sheet_sync',
      sourceRef: ctsSourceRef(classified.phoneE164, 'purchase', classified.tourInterest),
    },
    phoneMasked,
    summary,
    () => {
      summary.insertedPurchases++
      markInserted()
    },
  )
}

/**
 * 处理表格的一块（`cursor.offset` 起、最多 `cursor.limit` 行）。
 *
 * 每块都重新读整张表，而不是第一块把快照存起来：快照会经过 Inngest 的 step 记忆化
 * 存到它的云端，而整表含电话/邮箱/姓名（客户 PII）；这里返回的 summary 只有打码电话。
 * 两块之间表格被人改动的代价是某一行这次跳过、明天再来（幂等键保证不会重复写）。
 */
export async function runCtsCrmSyncChunk(
  cursor: CtsCrmSyncCursor,
  deps: RunCtsCrmSyncDeps = {},
): Promise<CtsCrmSyncChunkResult> {
  const supabase = deps.supabase ?? supabaseAdmin
  const maxInserts = deps.maxInsertsPerRun ?? DEFAULT_MAX_INSERTS_PER_RUN
  const summary = emptySummary()

  const [sheet1Raw, crmRaw, existingRefs] = await Promise.all([
    readSheetValues(CTS_CLIENT_ID, SPREADSHEET_ID, SHEET1_RANGE),
    readSheetValues(CTS_CLIENT_ID, SPREADSHEET_ID, CRM_MANAGEMENT_RANGE),
    loadExistingSourceRefs(supabase),
  ])

  // 读的范围是 A2 起，所以数组下标 i 对应表格第 i+2 行 —— 跟进记录在 R 还是 S 列
  // 要靠这个行号判（见 `ctsNoteColumnIndex`）。
  const sheet1ByPhone = indexSheet1ByPhone(sheet1Raw.map((cells, i) => parseSheet1Row(cells, i + 2)))
  const crmRows = crmRaw.map(parseCrmManagementRow)
  const start = Math.max(0, cursor.offset)
  const end = cursor.limit == null ? crmRows.length : Math.min(crmRows.length, start + cursor.limit)

  let insertedThisRun = cursor.insertedSoFar
  const markInserted = () => {
    insertedThisRun++
  }

  for (const crmRow of crmRows.slice(start, end)) {
    summary.totalCrmRows++
    const phoneKey = ctsPhoneE164(crmRow.phoneRaw)
    const matchedSheet1 = phoneKey ? (sheet1ByPhone.get(phoneKey) ?? null) : null
    const classified = classifyCtsCrmPerson(crmRow, matchedSheet1)

    if (classified.kind === 'excluded') {
      tallyExcluded(summary, classified.reason)
      continue
    }
    if (classified.kind === 'purchase_missing_date') {
      summary.heldForManualReview.push({
        phoneMasked: maskPhone(classified.phoneE164),
        tourInterest: classified.tourInterest,
        reason: classified.reason,
      })
      continue
    }
    const sourceRef =
      classified.kind === 'qualified_lead'
        ? ctsSourceRef(classified.phoneE164, 'lead')
        : ctsSourceRef(classified.phoneE164, 'purchase', classified.tourInterest)
    if (existingRefs.has(sourceRef)) {
      summary.skippedAlreadySynced++
      continue
    }
    if (insertedThisRun >= maxInserts) {
      summary.cappedAtMaxInserts = true
      continue
    }

    if (classified.kind === 'qualified_lead') {
      await processQualifiedLead(supabase, classified, summary, markInserted)
    } else {
      await processPurchaseCandidate(supabase, classified, summary, markInserted)
    }
  }

  return {
    summary,
    nextOffset: end,
    totalSheetRows: crmRows.length,
    insertedSoFar: insertedThisRun,
    done: end >= crmRows.length,
  }
}

/** 一次处理整张表——手动路由 `cts-crm-sync` 走这条，行为跟拆块之前一样。 */
export async function runCtsCrmSync(deps: RunCtsCrmSyncDeps = {}): Promise<CtsCrmSyncSummary> {
  const chunk = await runCtsCrmSyncChunk({ offset: 0, insertedSoFar: 0 }, deps)
  return chunk.summary
}
