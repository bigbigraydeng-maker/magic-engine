/**
 * POST /api/clients/[id]/crm/contacts
 *
 * 新客人快速录入。销售最高频动作之一:「刚有个新客人打进来,先记一下」。没有这个
 * 入口,纯电话新 lead 就只能继续记在 Excel 里 —— Sheet 永远死不了。
 *
 * 复用 identity.resolveContact:靠电话 / 邮箱合并,不靠姓名。同一个人重复录入
 * (双击 / 又打来一次)不会产生两条,命中既有身份即复用 —— 天然幂等,无需 clientRef。
 * 新建的联系人零触点,segments 会把他排进「新进线，没人碰过」,当天名单里立刻能看到。
 *
 * Body: { name?, phone?, email? }  (phone / email 至少一个能规范化)
 * Responses: 200 { contactId, created } / 400 / 401 / 403 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { contactCardTitle } from '@/lib/crm/display-name'
import { buildIdentities, normalisePhone, resolveContact, AmbiguousIdentityError } from '@/lib/crm/identity'
import { contactKindOf, isSystemAccountName, normaliseDomain, readDomainRules, SYSTEM_ACCOUNT_NAMES } from '@/lib/crm/contact-kind'
import { EMPTY_ATTRIBUTION } from '@/lib/crm/attribution'
import { segmentContact } from '@/lib/crm/segments'
import { buildContactModel } from '@/lib/crm/contact-model'
import { enrichContacts, type SourceKey } from '@/lib/crm/contact-enrichment'
import { loadAllEnrichmentConversations, loadEnrichmentInputs, type EnrichmentInputs } from '@/lib/crm/contact-enrichment-loader'
import {
  responseRowFor,
  stageMetaOf,
  type ContactRow,
  type TouchRow,
  type StageRow,
} from '@/lib/crm/contact-response-row'
import { buildPriorityView } from '@/lib/crm/contact-list-view'
import { contactsTouchedToday, localDayStartMs } from '@/lib/crm/day-list'
import { loadStageSuppressedTodayIds } from '@/lib/crm/day-stage-events'
import { handledNextAction, type NextAction } from '@/lib/crm/next-action'
import { recentStaffNotes } from '@/lib/crm/recent-staff-notes'
import { isMarketingAction } from '@/lib/crm/pipeline'
import { SECTION_KEYS, type SectionKey } from '@/lib/crm/list-sections'
import { loadLatestBriefByContact, loadLatestBriefByContactCached, type BriefByContact } from '@/lib/crm/brief-lookup'
import { fetchAll, fetchAllBatched } from '@/lib/supabase-paginate'
import { createStepTimer, type StepTimer } from '@/lib/http/step-timing'
import { orderContactIdsByLatestTouch, scanLatestTouchContactIds, type TouchRowLite } from '@/lib/crm/contact-touch-order'
import {
  extractCustomColumns,
  visibleCustomColumns,
  type CustomColumnKey,
} from '@/lib/crm/table-columns'

/** 分页 / 筛选 / 搜索的解析结果。见 `parseListQuery`。 */
interface ListQuery {
  /** 任一参数出现即为 true —— 老调用方不带参数，走老路径、拿老形状。 */
  paged: boolean
  /** 1-based。 */
  page: number
  /** 已 clamp 到 [1, 500]。 */
  perPage: number
  /** 空数组 = 不筛。 */
  stages: string[]
  /** 已 trim；空串当 null。 */
  q: string | null
  /** `?view=priority` → hot / cold 两张名单视图。null = 老的平铺列表。 */
  view: 'priority' | null
  /** 段展开状态：`?open=hot,cold`。缺省 undefined = 用 list-sections 的默认（前两段展开）。 */
  open?: Partial<Record<SectionKey, boolean>>
  /** 段内翻页：`?p_hot=2&p_cold=1`，1-based。 */
  sectionPage?: Partial<Record<SectionKey, number>>
  /** `?contact=<id>` —— 今日待办的直达链接；服务端定位它落在哪段哪页。 */
  focusContactId?: string
  /** `?ids=a,b` —— 只取这几位客人（最多 20 位），付款总览页原地弹出抽屉用；不筛选、不排序、不翻页。 */
  ids?: string[]
  /**
   * `?kind=retail|trade` —— 只筛终端客户 / 只筛同行（2026-09-28 WP-B3）。
   * 不传 = 老行为，不做任何按身份的筛选，逐字不变（默认「全部客人」不因为
   * 加这个功能就悄悄把员工/同行从原有列表里拿掉——那是另一个决定，这次没做）。
   * 只在平铺分页路径（getPaged）生效，分段视图这一轮不接。
   */
  kind?: 'retail' | 'trade'
  /**
   * `?assignee=me|unassigned|<email>` —— 按跟进人筛（issue #3158 part 3）。
   *   - `me` = 当前登录员工的邮箱（服务端用 `access.user.email` 判，调用方不用自己传）
   *   - `unassigned` = `assigned_to IS NULL`
   *   - `<email>` = 字面匹配 `assigned_to`
   * 跟 kind 一样只在分页路径生效；分段视图这一轮不接。
   */
  assignee?: 'me' | 'unassigned' | string
}

const DEFAULT_PER_PAGE = 100
const MAX_PER_PAGE = 500
const MAX_IDS = 20
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 解析列表查询参数。
 *
 * `paged` 的判据是「参数**出现过**」，不是「值非默认」—— 前端显式传
 * `?page=1&perPage=100` 时它要的是新形状（`items` / `total`），不是老形状。
 * 老调用方一个参数都不带，于是天然走老路径，形状不变。
 *
 * 返回 `{ error }` 表示参数非法（400），调用方直接回。
 */
function parseListQuery(url: URL): ListQuery | { error: string } {
  const sp = url.searchParams
  const paged =
    sp.has('page') || sp.has('perPage') || sp.has('stage') || sp.has('stages') || sp.has('q') || sp.has('kind') || sp.has('ids')

  const rawPage = sp.get('page')
  const rawPerPage = sp.get('perPage')

  let page = 1
  if (rawPage !== null) {
    const n = Number(rawPage)
    if (!Number.isInteger(n) || n <= 0) return { error: 'invalid page/perPage' }
    page = n
  }

  let perPage = DEFAULT_PER_PAGE
  if (rawPerPage !== null) {
    const n = Number(rawPerPage)
    if (!Number.isInteger(n) || n <= 0) return { error: 'invalid page/perPage' }
    perPage = Math.min(n, MAX_PER_PAGE)
  }

  // 两种写法都收：?stage=a&stage=b（重复键）和 ?stages=a,b（逗号分隔）。
  const stages = [
    ...sp.getAll('stage'),
    ...(sp.get('stages') ?? '').split(','),
  ]
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  const rawQ = sp.get('q')
  const q = rawQ === null ? null : rawQ.trim() || null

  // PostgREST 的 `or(...)` 语法用逗号和括号分隔条件，q 里带这些字符会把
  // 语法拆坏（甚至注入别的条件）。不尝试转义 —— 直接拒绝，让调用方自己清。
  if (q !== null && /[,()]/.test(q) && !(/^[+\d\s().-]+$/.test(q) && /\d/.test(q))) return { error: 'invalid characters in q' }

  const rawView = sp.get('view')
  if (rawView !== null && rawView !== 'priority') return { error: 'invalid view' }
  const view = rawView === 'priority' ? ('priority' as const) : null

  let open: Partial<Record<SectionKey, boolean>> | undefined
  if (sp.has('open')) {
    const wanted = new Set(
      (sp.get('open') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    )
    for (const k of wanted) {
      if (!SECTION_KEYS.includes(k as SectionKey)) return { error: `invalid section in open: ${k}` }
    }
    // 显式传 open 就是完整声明：列出来的展开，没列出的收起。半声明会让
    // 「收起 waiting」这个动作做不到（缺省会把它重新展开）。
    open = Object.fromEntries(SECTION_KEYS.map((k) => [k, wanted.has(k)])) as Partial<Record<SectionKey, boolean>>
  }

  let sectionPage: Partial<Record<SectionKey, number>> | undefined
  for (const k of SECTION_KEYS) {
    const raw = sp.get(`p_${k}`)
    if (raw === null) continue
    const n = Number(raw)
    if (!Number.isInteger(n) || n <= 0) return { error: `invalid p_${k}` }
    sectionPage = { ...(sectionPage ?? {}), [k]: n }
  }

  const rawFocus = sp.get('contact')
  const focusContactId = rawFocus === null ? undefined : rawFocus.trim() || undefined

  let ids: string[] | undefined
  if (sp.has('ids')) {
    ids = (sp.get('ids') ?? '').split(',').map((v) => v.trim()).filter((v) => v.length > 0)
    if (ids.length === 0 || ids.length > MAX_IDS || !ids.every((v) => UUID_RE.test(v))) {
      return { error: 'invalid ids' }
    }
  }

  const rawKind = sp.get('kind')
  if (rawKind !== null && rawKind !== 'retail' && rawKind !== 'trade') return { error: 'invalid kind' }
  const kind = rawKind === 'retail' || rawKind === 'trade' ? rawKind : undefined

  // ?assignee：me / unassigned / 具体邮箱。邮箱不校验 RFC 格式，只拒绝明显会把
  // PostgREST 查询拆坏的字符（跟上面 q 同款），不认合法性是 UI 的事。
  const rawAssignee = sp.get('assignee')
  let assignee: ListQuery['assignee']
  if (rawAssignee !== null) {
    const trimmed = rawAssignee.trim()
    if (trimmed.length === 0) {
      assignee = undefined
    } else if (trimmed === 'me' || trimmed === 'unassigned') {
      assignee = trimmed
    } else if (/[,()%_]/.test(trimmed)) {
      return { error: 'invalid characters in assignee' }
    } else {
      assignee = trimmed.toLowerCase()
    }
  }

  // view=priority 不走分页路径：它自己一次拉全（筛选后的）子集再在内存里分段。
  return { paged: view === null && paged, page, perPage, stages, q, view, open, sectionPage, focusContactId, ids, kind, assignee }
}

/**
 * 分页路径要跑两次同样过滤的查询（一次 count、一次取页），两次过滤条件必须
 * 逐字一致。抽出"过滤参数"（不是"builder 装饰函数"）—— 装饰函数会把 supabase
 * 的泛型链一路带上来撞递归深度上限；这里只吐三个值让两个调用方各自 apply。
 */
function contactFilterParams(query: ListQuery): {
  stages: string[] | null
  orExpr: string | null
} {
  return {
    stages: query.stages.length > 0 ? query.stages : null,
    orExpr:
      query.q === null
        ? null
        : searchFilters(query.q, ['display_name', 'primary_phone', 'primary_email']),
  }
}

/** Build safe PostgREST search patterns for human-formatted NZ/AU phone numbers. */
function searchFilters(q: string, fields: string[]): string {
  const phoneLike = /^[+\d\s().-]+$/.test(q)
  const safe = phoneLike ? q.replace(/[()]/g, '') : q
  const patterns = new Set([safe])
  if (phoneLike) {
    const digits = q.replace(/\D/g, '')
    if (digits) patterns.add(digits)
    if (digits.startsWith('0') && digits.length >= 3) patterns.add(digits.slice(1))
    for (const country of ['NZ', 'AU'] as const) {
      const normalised = normalisePhone(q, country)
      if (normalised) patterns.add(normalised)
    }
  }
  return fields.flatMap((field) => [...patterns].map((pattern) => `${field}.ilike.%${pattern}%`)).join(',')
}

async function searchIdentityContactIds(clientId: string, q: string): Promise<string[]> {
  const rows = await fetchAll<{ contact_id: string }>((from, to) =>
    supabaseAdmin.from('contact_identities').select('contact_id').eq('client_id', clientId)
      .in('kind', ['phone', 'email']).or(searchFilters(q, ['value']))
      .order('id', { ascending: true }).range(from, to),
  )
  return [...new Set(rows.map((row) => row.contact_id).filter((id) => UUID_RE.test(id)))]
}

/**
 * 「同行」「员工」各自的 id——不管请求要 retail 还是 trade 视图，都从这两个
 * 小集合出发：trade 视图直接 `.in()` 同行那一份；retail 视图 `.not(...'in'...)`
 * 排掉同行+员工。两条路径的 id 列表都只跟「同行/员工有多少人」成正比（CTS 约
 * 20 人），不会随客户总联系人数（1000+）一起变大，避免 PostgREST `.in()` 背上
 * 一条跟总数一样长的 URL（本文件其它地方已经踩过这类"in 列表太长"的坑）。
 *
 * 判据跟 `crm/today/route.ts` 完全一致（同一份 `contactKindOf`/`readDomainRules`，
 * 不在这里另起一套）：一个人可能有多个邮箱身份，同行常用私人邮箱来问事，
 * 只看 `primary_email` 会漏判。
 *
 * ## 为什么现在只捞「可能命中」的行（2026-10-26 提速）
 *
 * 老版本为了找这 20 来个人，把**全部** `contact_identities`（CTS 2788 行）和
 * **全部** `contacts`（1211 行）都翻一遍——连一次普通翻页都要付这份钱，页面
 * 3.6 秒里它占一大块。但读 `contact-kind.ts` 就知道：一个人要能算成 trade 或
 * staff，只有两条路——邮箱域名命中配置里的 own/trade 清单（`domainMatches` 是
 * `===` 或 `.endsWith('.' + listed)`），或者 `display_name` 落在固定的
 * `SYSTEM_ACCOUNT_NAMES` 里。于是把「可能命中」的行先筛出来，再拿**原封不动的**
 * `contactKindOf` / `isSystemAccountName` 在它们身上重跑一遍，结果跟全表扫逐字
 * 相同：多捞是安全的（原判据会把它剔掉），少捞才是 bug（会漏掉真正的同行）。
 *
 * 域名清单为空、又没有系统账号要查时，直接返回空——一次查询都不发。
 */
async function loadTradeAndStaffIds(clientId: string): Promise<{ tradeIds: string[]; staffIds: string[] }> {
  const clientRes = await supabaseAdmin.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
  const rules = readDomainRules((clientRes.data as { leads_config: unknown } | null)?.leads_config)
  const domains = [...rules.own, ...rules.trade].map(normaliseDomain).filter((d) => d.length > 0)
  // PostgREST 的 `.or(...)` 用逗号分隔、用括号分组，`ilike` 还认 `%` `_` 是通配符。
  // 客户配置里的域名要是混进这些字符（`normaliseDomain` 不清理它们，实测 `ab,cd.com`
  // 原样留着），拼出来的过滤串要么报错把页面打挂，要么静默少捞行、把同行当成终端客户
  // 混进名单 —— 后者更坏。所以这里用**白名单**：只有合法域名字符（`normaliseDomain`
  // 已经转小写，punycode 的 `xn--` 也在内）才允许拼进过滤串，其余一律**退回整表扫描**：
  // 慢一点，但结果一定对。白名单而不是逐个列禁用字符，是为了一次盖住所有特殊字符。
  const filterSafe = domains.every((d) => /^[a-z0-9.-]+$/.test(d))

  // 系统账号（WhatsApp Business 等）只有固定几个名字，按名字收窄即可 ——
  // 以前这里整表扫 1211 行只为挑出 6 个，是这个接口最大的一块浪费。
  // ilike 用 %name% 是**故意放宽**的：宁可多捞几行回来，再用原来的
  // `isSystemAccountName`（trim + 小写 + 精确查表）复核一遍；少捞才是 bug。
  const nameOr = [...SYSTEM_ACCOUNT_NAMES].map((n) => `display_name.ilike.%${n}%`).join(',')
  const nameScan = fetchAll<{ id: string; display_name: string | null }>((from, to) =>
    supabaseAdmin
      .from('contacts')
      .select('id, display_name')
      .eq('client_id', clientId)
      .or(nameOr)
      .order('id', { ascending: true })
      .range(from, to),
  )

  if (domains.length === 0) {
    const named = await nameScan
    return { tradeIds: [], staffIds: named.filter((c) => isSystemAccountName(c.display_name)).map((c) => c.id) }
  }

  const valueOr = domains.map((d) => `value.ilike.%${d}`).join(',')
  const emailOr = domains.map((d) => `primary_email.ilike.%${d}`).join(',')

  // 🔴 魏征 2026-09-28 复审 B3 查出：range 分页必须配 order，否则页之间顺序不稳，
  // 客户联系人/身份超过一页（1000 条）时会漏行或重复行——跟本仓库 2026-07-29 CTS
  // 事故同款问题，`crm/today/route.ts` 抄的是同一套判定逻辑但那边配了 order，
  // 这里漏抄了。
  const [identities, byEmail, named] = await Promise.all([
    fetchAll<{ contact_id: string; value: string }>((from, to) =>
      supabaseAdmin
        .from('contact_identities')
        .select('contact_id, value')
        .eq('client_id', clientId)
        .eq('kind', 'email')
        // 脏配置时不加这层收窄，整表扫回来再用原判据复核（慢，但不会漏人）。
        .or(filterSafe ? valueOr : 'value.not.is.null')
        .order('contact_id', { ascending: true })
        .range(from, to),
    ),
    fetchAll<{ id: string; primary_email: string | null; display_name: string | null }>((from, to) =>
      supabaseAdmin
        .from('contacts')
        .select('id, primary_email, display_name')
        .eq('client_id', clientId)
        .or(filterSafe ? emailOr : 'id.not.is.null')
        .order('id', { ascending: true })
        .range(from, to),
    ),
    nameScan,
  ])

  const emailsByContact = new Map<string, string[]>()
  for (const c of byEmail) {
    if (c.primary_email) emailsByContact.set(c.id, [c.primary_email])
  }
  for (const i of identities) {
    const list = emailsByContact.get(i.contact_id) ?? []
    if (!list.includes(i.value)) list.push(i.value)
    emailsByContact.set(i.contact_id, list)
  }

  const tradeIds: string[] = []
  const staffIds: string[] = []
  // 系统账号（WhatsApp Business 等）跟自己人一起从零售名单里排掉。
  for (const c of named) if (isSystemAccountName(c.display_name)) staffIds.push(c.id)
  for (const [id, emails] of emailsByContact) {
    const kind = contactKindOf(emails, rules)
    if (kind === 'trade') tradeIds.push(id)
    else if (kind === 'staff') staffIds.push(id)
  }
  return { tradeIds, staffIds }
}

/** 每批读多少条触点来排序；最多读几批（防止一个大客户把整张触点表翻一遍）。 */
const TOUCH_SCAN_PAGE = 1000
const TOUCH_SCAN_MAX_PAGES = 40

const PAGE_CONTACT_COLUMNS =
  'id, display_name, primary_phone, primary_email, do_not_contact, snooze_until, stage, first_seen_at, pinned_at, important_note, important_due_at, assigned_to'

/** 这一页的人的全部触点（带全字段，给分段与整理用）。 */
function fetchTouchesFor(clientId: string, ids: string[]): Promise<TouchRow[]> {
  return fetchAll<TouchRow>((from, to) =>
    supabaseAdmin
      .from('contact_touchpoints')
      .select('id, contact_id, channel, direction, occurred_at, summary, raw, metadata, source')
      .eq('client_id', clientId)
      .in('contact_id', ids)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
  )
}

/** 最新触点倒序的第 i 批（只带 contact_id / occurred_at，给排序用）。 */
async function fetchTouchBatch(clientId: string, i: number): Promise<TouchRowLite[]> {
  const res = await supabaseAdmin
    .from('contact_touchpoints')
    .select('contact_id, occurred_at')
    .eq('client_id', clientId)
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .range(i * TOUCH_SCAN_PAGE, (i + 1) * TOUCH_SCAN_PAGE - 1)
  if (res.error) throw new Error(res.error.message)
  return (res.data ?? []) as TouchRowLite[]
}

/** 按给定顺序取一页的人。`.in()` 一次最多 100 个 id（URL 长度），分批并行取后按原顺序拼回。 */
async function loadContactsByIds(clientId: string, ids: string[]): Promise<ContactRow[]> {
  if (ids.length === 0) return []
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100))
  const results = await Promise.all(
    chunks.map((chunk) =>
      supabaseAdmin.from('contacts').select(PAGE_CONTACT_COLUMNS).eq('client_id', clientId).in('id', chunk),
    ),
  )
  const byId = new Map<string, ContactRow>()
  for (const res of results) {
    if (res.error) throw new Error(res.error.message)
    for (const row of (res.data ?? []) as ContactRow[]) byId.set(row.id, row)
  }
  return ids.map((id) => byId.get(id)).filter((c): c is ContactRow => c !== undefined)
}

/**
 * 展示层补全（只读，不改库）：名字缺失 → 从对话里找回 / 取邮箱前缀；没存的邮箱 → 从邮件对话补；
 * 我们发出的人工邮件（只在对话里、没落触点的）→ 补成外发记录，别再判「还没联系」；顺带算每人的来源渠道。
 * scoped=true 只查这一批人（分页），false = 整个客户（分段 / 老路径）。失败时原样返回。
 */
async function enrichForDisplay(
  clientId: string,
  contacts: ContactRow[],
  touches: TouchRow[],
  scoped: boolean,
  /**
   * 原料已经在路上时直接等它，别再发一次。
   *
   * 这一步只要「这一页有哪些人」，而那串编号在上一步（`page_ready`）就已经拿到了；
   * 原来却要等触点和摘要都回来之后才开始发请求，白串了一轮。实测（Server-Timing）
   * `touches_briefs 317ms` 之后才轮到 `enrich 516ms`，两段加起来 833ms；并行之后
   * 只花两者里慢的那一个。跟同文件 `touchesEarly` 是同一个套路。
   */
  preloaded?: Promise<EnrichmentInputs>,
) {
  const inputs = await (preloaded ?? loadEnrichmentInputs(supabaseAdmin, clientId, scoped ? contacts.map((c) => c.id) : undefined))
  return enrichContacts({ contacts, touches, hints: inputs.hints, outboundEmails: inputs.outboundEmails })
}

/**
 * `?ids=` 路径：只取指定的几位客人，组装方式与列表逐字相同（同一个 assembleRows）。
 * 付款总览页点客人名字时用它原地弹出抽屉；按 client_id 收口，别家客户的编号取不到。
 */
async function getByIds(
  clientId: string,
  ids: string[],
  viewerEmail: string | null,
  timer: StepTimer,
): Promise<NextResponse> {
  try {
    const [pageContacts, touches, stageRows, briefs] = await Promise.all([
      loadContactsByIds(clientId, ids),
      fetchTouchesFor(clientId, ids),
      fetchAll<StageRow>((from, to) =>
        supabaseAdmin
          .from('client_pipeline_stages')
          .select('stage_key, label, marketing_action, is_terminal')
          .eq('client_id', clientId)
          .order('sort_order', { ascending: true })
          .range(from, to),
      ),
      loadLatestBriefByContactCached(clientId),
    ])
    timer.step('by_ids')
    const enriched = await enrichForDisplay(clientId, pageContacts, touches, true)
    const { out, customPerContact } = assembleRows(enriched.contacts, enriched.touches, stageRows, briefs, enriched.sources)
    const res = NextResponse.json({
      total: out.length,
      page: 1,
      perPage: ids.length,
      columns: visibleCustomColumns(customPerContact),
      items: out,
      viewerEmail,
    })
    res.headers.set('Server-Timing', timer.header())
    return res
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '读取失败' }, { status: 500 })
  }
}

/**
 * 分页路径：只拉当前页的人 + 这些人的触点。
 *
 * 跟老路径的区别只有「拉谁」—— 逐人组装（segmentContact / extractCustomColumns /
 * 输出字段）逐字复用，两个形状里同一个人长得一模一样。
 *
 * 触点必须按 `contact_id in (当前页)` 收窄：CTS 量级下全量触点 1271 条，
 * 分页的意义就是别为了 100 个人把全库读一遍。
 */
async function getPaged(
  clientId: string,
  query: ListQuery,
  viewerEmail: string | null,
  timer: StepTimer,
): Promise<NextResponse> {
  // 全客户 AI 摘要跟搜什么、翻哪页无关，是这次请求里最慢的一段（实测约 0.7 秒）：
  // 一进来就开跑（跟下面的页查询并行），且 30 秒内同一客户只查一次——搜索框每敲一个字都会进来。
  const briefsPromise = loadLatestBriefByContactCached(clientId)
  let total = 0
  let pageContacts: ContactRow[] = []
  let stageRows: StageRow[] = []
  // 数据库函数给出这一页的 id 之后，这一页的触点与「取这些人的资料」互不依赖，同时开始（省约 0.17 秒）。
  let touchesEarly: Promise<TouchRow[]> | null = null
  try {
    // 两次查询的过滤条件必须逐字一致 —— 共享一份过滤参数后各自 apply。
    const filters = contactFilterParams(query)

    // ?assignee 解析成一个 { kind, email? } 结构：me 现查登录邮箱，unassigned 直接给 IS NULL。
    // 没登录邮箱（罕见）又传了 me：返回空名单——比把筛选默默吞了诚实。
    let assigneeFilter: { kind: 'eq'; email: string } | { kind: 'null' } | null = null
    if (query.assignee === 'me') {
      if (!viewerEmail) {
        return NextResponse.json({
          total: 0,
          page: query.page,
          perPage: query.perPage,
          columns: [],
          items: [],
          viewerEmail,
        })
      }
      assigneeFilter = { kind: 'eq', email: viewerEmail }
    } else if (query.assignee === 'unassigned') {
      assigneeFilter = { kind: 'null' }
    } else if (typeof query.assignee === 'string') {
      assigneeFilter = { kind: 'eq', email: query.assignee }
    }

    // kind 筛选（?kind=retail|trade，WP-B3）：先把同行/员工这两小撮人的 id 算出来，
    // 两条查询各自叠加同一份 id 过滤——跟 stages/orExpr 一样，必须逐字一致。
    let kindInIds: string[] | null = null
    let kindNotInIds: string[] | null = null
    if (query.kind) {
      const { tradeIds, staffIds } = await loadTradeAndStaffIds(clientId)
      if (query.kind === 'trade') {
        if (tradeIds.length === 0) {
          return NextResponse.json({
            total: 0,
            page: query.page,
            perPage: query.perPage,
            columns: [],
            items: [],
            viewerEmail,
          })
        }
        kindInIds = tradeIds
      } else {
        kindNotInIds = [...tradeIds, ...staffIds]
      }
    }

    // Search all stored phone/email identities as well as the primary fields.
    // Pass the resulting IDs to the RPC rather than a long PostgREST URL.
    if (query.q !== null && filters.orExpr !== null) {
      const [primary, secondary] = await Promise.all([
        fetchAll<{ id: string }>((from, to) => supabaseAdmin.from('contacts').select('id')
          .eq('client_id', clientId).or(filters.orExpr!).order('id', { ascending: true }).range(from, to)),
        searchIdentityContactIds(clientId, query.q),
      ])
      const ids = [...new Set([...primary.map((row) => row.id), ...secondary])]
      const permitted = kindInIds === null ? ids : ids.filter((id) => kindInIds!.includes(id))
      if (permitted.length === 0) return NextResponse.json({ total: 0, page: query.page, perPage: query.perPage, columns: [], items: [], viewerEmail })
      kindInIds = permitted
    }

    // 先取「符合筛选的全部人」的 id（几百到一两千行，只带 id 和首次进线时间），再按「最近有互动」排好序，
    // 最后只把当前这一页的人取全。排序不能放在 SQL 里：「最近联系」是逐人对触点取最大值，
    // 而 contacts.last_seen_at 不可信（生产里 721/1159 人比真实最新触点旧）。见 contact-touch-order.ts。
    const noFilter =
      filters.stages === null && filters.orExpr === null && kindInIds === null && kindNotInIds === null && assigneeFilter === null
    const need = query.page * query.perPage
    let fastDone = false

    // 最快的路径：数据库函数一次返回「这一页的 id（按最近真实互动排好）+ 符合筛选的总数」，
    // 筛选条件在函数里逐项对应上面的 stage / q / kind。函数还没装上（迁移晚于代码上线）或出错时，
    // 记一条日志，退回下面两条老路径——页面不会因此打不开。
    //
    // 跟进人筛选（part 3 新加）不走 RPC：函数签名里没有这个参数，加它要动数据库，
    // 等以后再说。此时直接跳到下面的 slow 路径。
    if (assigneeFilter === null) {
      const [rpcRes, stagesRpc] = await Promise.all([
        supabaseAdmin.rpc('crm_contacts_page_by_latest_touch', {
          p_client_id: clientId,
          p_stages: filters.stages,
          p_q: null,
          p_in_ids: kindInIds,
          p_not_in_ids: kindNotInIds !== null && kindNotInIds.length > 0 ? kindNotInIds : null,
          p_limit: query.perPage,
          p_offset: (query.page - 1) * query.perPage,
        }),
        fetchAll<StageRow>((from, to) =>
          supabaseAdmin
            .from('client_pipeline_stages')
            .select('stage_key, label, marketing_action, is_terminal')
            .eq('client_id', clientId)
            .order('sort_order', { ascending: true })
            .range(from, to),
        ),
      ])
      timer.step('rpc_stages')
      if (rpcRes.error) {
        console.warn('[crm contacts] page function unavailable, using the app-side path:', rpcRes.error.message)
      } else {
        const rows = (rpcRes.data ?? []) as Array<{ id: string; total: number | string }>
        let rpcTotal: number | null = rows.length > 0 ? Number(rows[0].total) : 0
        if (rows.length === 0 && query.page > 1) {
          // 翻过头了：这一页没有人，总数得再问一次第一页才知道。问不到就当函数不可用、退回老路径，
          // 不能悄悄报 0。
          const first = await supabaseAdmin.rpc('crm_contacts_page_by_latest_touch', {
            p_client_id: clientId,
            p_stages: filters.stages,
            p_q: null,
            p_in_ids: kindInIds,
            p_not_in_ids: kindNotInIds !== null && kindNotInIds.length > 0 ? kindNotInIds : null,
            p_limit: 1,
            p_offset: 0,
          })
          if (first.error) {
            console.warn('[crm contacts] page function total lookup failed, using the app-side path:', first.error.message)
            rpcTotal = null
          } else {
            const firstRows = (first.data ?? []) as Array<{ total: number | string }>
            rpcTotal = firstRows.length > 0 ? Number(firstRows[0].total) : 0
          }
        }
        if (rpcTotal !== null) {
          total = rpcTotal
          const rpcIds = rows.map((r) => r.id)
          if (rpcIds.length > 0) {
            touchesEarly = fetchTouchesFor(clientId, rpcIds)
            // 资料那一步若先出错，这条提前开始的查询不能变成没人接的未处理异常。
            touchesEarly.catch(() => undefined)
          }
          pageContacts = await loadContactsByIds(clientId, rpcIds)
          timer.step('page_rows')
          stageRows = stagesRpc
          fastDone = true
        }
      }
    }

    // 快路径（默认打开页面就是这条）：没有筛选时，不必把全客户的 id 取出来再排——
    // 总数用一次 count，前 need 位直接从最新触点往回翻出来；三件事并行，少两三次往返。
    if (!fastDone && noFilter) {
      const [countRes, scanned, stagesFast] = await Promise.all([
        supabaseAdmin.from('contacts').select('id', { count: 'exact', head: true }).eq('client_id', clientId),
        scanLatestTouchContactIds({
          need,
          pageSize: TOUCH_SCAN_PAGE,
          maxPages: TOUCH_SCAN_MAX_PAGES,
          fetchTouchPage: (i) => fetchTouchBatch(clientId, i),
        }),
        fetchAll<StageRow>((from, to) =>
          supabaseAdmin
            .from('client_pipeline_stages')
            .select('stage_key, label, marketing_action, is_terminal')
            .eq('client_id', clientId)
            .order('sort_order', { ascending: true })
            .range(from, to),
        ),
      ])
      if (countRes.error) throw new Error(countRes.error.message)
      if (scanned !== null) {
        total = countRes.count ?? 0
        pageContacts = await loadContactsByIds(
          clientId,
          scanned.slice((query.page - 1) * query.perPage, query.page * query.perPage),
        )
        stageRows = stagesFast
        fastDone = true
      }
    }

    if (!fastDone) {
      const idChunks: Array<string[] | null> = kindInIds === null ? [null] : Array.from(
        { length: Math.ceil(kindInIds.length / 100) }, (_, i) => kindInIds!.slice(i * 100, i * 100 + 100),
      )
      const [idParts, stages] = await Promise.all([
        Promise.all(idChunks.map((chunk) => fetchAll<{ id: string; first_seen_at: string | null }>((from, to) => {
          let b = supabaseAdmin.from('contacts').select('id, first_seen_at').eq('client_id', clientId)
          if (filters.stages !== null) b = b.in('stage', filters.stages)
          if (chunk !== null) b = b.in('id', chunk)
          if (kindNotInIds !== null && kindNotInIds.length > 0) {
            b = b.not('id', 'in', `(${kindNotInIds.join(',')})`)
          }
          // 跟进人筛选（part 3）：IS NULL / 字面相等，不走模糊匹配。
          if (assigneeFilter?.kind === 'null') b = b.is('assigned_to', null)
          else if (assigneeFilter?.kind === 'eq') b = b.eq('assigned_to', assigneeFilter.email)
          return b.order('id', { ascending: true }).range(from, to)
        }))),
        fetchAll<StageRow>((from, to) =>
          supabaseAdmin
            .from('client_pipeline_stages')
            .select('stage_key, label, marketing_action, is_terminal')
            .eq('client_id', clientId)
            .order('sort_order', { ascending: true })
            .range(from, to),
        ),
      ])
      const idRows = idParts.flat()

      const orderedIds = await orderContactIdsByLatestTouch({
        contacts: idRows.map((r) => ({ id: r.id, firstSeenAt: r.first_seen_at })),
        need: query.page * query.perPage,
        pageSize: TOUCH_SCAN_PAGE,
        maxPages: TOUCH_SCAN_MAX_PAGES,
        fetchTouchPage: (i) => fetchTouchBatch(clientId, i),
      })

      total = orderedIds.length
      const wantedIds = orderedIds.slice((query.page - 1) * query.perPage, query.page * query.perPage)
      pageContacts = await loadContactsByIds(clientId, wantedIds)
      stageRows = stages
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '读取失败' },
      { status: 500 },
    )
  }

  timer.step('page_ready')
  const pageIds = pageContacts.map((c) => c.id)
  // 补全层的原料只要这串编号，现在就发出去，跟下面的触点/摘要并行跑。
  // 失败不影响名单（`loadEnrichmentInputs` 内部已经 catch 成空值），这里再挂一个
  // 兜底，避免它比下面的 await 先 reject 时变成没人接的未处理异常（同 `touchesEarly`）。
  const enrichInputsEarly: Promise<EnrichmentInputs> | null =
    pageIds.length === 0 ? null : loadEnrichmentInputs(supabaseAdmin, clientId, pageIds)
  enrichInputsEarly?.catch(() => undefined)
  let touches: TouchRow[]
  let briefs: BriefByContact
  try {
    ;[touches, briefs] = await Promise.all([
      pageIds.length === 0
        ? Promise.resolve([] as TouchRow[])
        : (touchesEarly ?? fetchTouchesFor(clientId, pageIds)),
      briefsPromise,
    ])
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '读取失败' },
      { status: 500 },
    )
  }

  timer.step('touches_briefs')
  const enrichedPage = await enrichForDisplay(clientId, pageContacts, touches, true, enrichInputsEarly ?? undefined)
  timer.step('enrich')
  const { out, customPerContact } = assembleRows(enrichedPage.contacts, enrichedPage.touches, stageRows, briefs, enrichedPage.sources)
  timer.step('assemble')

  const res = NextResponse.json({
    total,
    page: query.page,
    perPage: query.perPage,
    columns: visibleCustomColumns(customPerContact),
    items: out,
    // 「全部客人」页展开一个联系人时要显示「发出去会记在谁名下」，
    // 而这个响应是该页唯一读到当前登录身份的地方（跟「今天要联系」页
    // 从自己的 data.viewerEmail 拿是同一个模式，不新起一个接口）。
    viewerEmail,
  })
  res.headers.set('Server-Timing', timer.header())
  return res
}

/**
 * `?view=priority` —— hot / cold 两张名单视图。
 *
 * 跟 getPaged 的区别：**不分页拉人**。分段依赖「现在几点」（约好的回电到点没到、
 * 打不通满 3 天转交、推迟到没到期），不能在 SQL 里算，所以必须把筛选后的子集
 * 整批拉进内存。stage / q 的筛选照旧落在 SQL（跟 getPaged 共用 contactFilterParams），
 * 这是 BLOCKER-1（三方设计审）的架构解：断崖从「总人数」推到「筛选后的子集」。
 *
 * 已知代价：触点仍按 client_id 整批拉（跟老路径一样），没有按筛选后的人收窄。
 * CTS 量级约 5k 行 / 1.4MB，跟今天页每次打开读的量相同。真要收窄得按 100 个
 * contact_id 一批走 `.in()`（PostgREST URL 长度限制），留作后续一轮。
 */
async function getPriority(clientId: string, query: ListQuery, viewerEmail: string | null, timer: StepTimer): Promise<NextResponse> {
  let contacts: ContactRow[]
  let touches: TouchRow[]
  let stageRows: StageRow[]
  let briefs: BriefByContact
  let leadsConfig: unknown = null
  let clientCountry = ''
  let allNoteContacts: Array<{ id: string; display_name: string | null; primary_email: string | null }> | null
  // Enrichment reads the same tenant-wide inputs regardless of the filtered contact list.
  // Start it with the other reads instead of waiting for all of them to finish.
  // Request-local only: both consumers use this client's same conversation rows.
  const sharedConversations = loadAllEnrichmentConversations(supabaseAdmin, clientId)
  sharedConversations.catch(() => undefined)
  const filters = contactFilterParams(query)
  const contactsRead = fetchAll<ContactRow>((from, to) => {
    let b = supabaseAdmin.from('contacts').select(PAGE_CONTACT_COLUMNS).eq('client_id', clientId)
    if (filters.stages !== null) b = b.in('stage', filters.stages)
    if (filters.orExpr !== null) b = b.or(filters.orExpr)
    return b.order('id', { ascending: true }).range(from, to)
  })
  // The lookup panel stays useful while the main queue is filtered by stage.
  // Fetch minimal tenant-scoped identity fields in parallel only for that case.
  const noteContactsRead = query.stages.length > 0 && query.q === null
    ? fetchAll<{ id: string; display_name: string | null; primary_email: string | null }>((from, to) =>
        supabaseAdmin.from('contacts').select('id, display_name, primary_email')
          .eq('client_id', clientId).order('id', { ascending: true }).range(from, to))
    : Promise.resolve(null)
  const selectedContacts = query.q === null ? contactsRead : (async () => {
    const [primary, identities] = await Promise.all([
      contactsRead,
      searchIdentityContactIds(clientId, query.q!),
    ])
    const ids = identities
    const parts = await Promise.all(Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) =>
      fetchAll<ContactRow>((from, to) => {
        let b = supabaseAdmin.from('contacts').select(PAGE_CONTACT_COLUMNS).eq('client_id', clientId).in('id', ids.slice(i * 100, i * 100 + 100))
        if (filters.stages !== null) b = b.in('stage', filters.stages)
        return b.order('id', { ascending: true }).range(from, to)
      }),
    ))
    return [...new Map([...primary, ...parts.flat()].map((row) => [row.id, row])).values()].sort((a, b) => a.id.localeCompare(b.id))
  })()
  selectedContacts.catch(() => undefined)
  const enrichmentInputs = query.q === null
    ? loadEnrichmentInputs(supabaseAdmin, clientId, undefined, sharedConversations)
    : selectedContacts.then((rows) => loadEnrichmentInputs(supabaseAdmin, clientId, rows.map((row) => row.id)))
  enrichmentInputs.catch(() => undefined)
  try {
    ;[contacts, touches, stageRows, briefs, { leadsConfig, country: clientCountry }, allNoteContacts] = await Promise.all([
      selectedContacts,
      // Summary is not consumed by the priority calculation or the list row.
      // Keep raw and metadata: they affect follow-up and do-not-contact rules.
      query.q !== null ? selectedContacts.then(async (rows) => {
        const ids = rows.map((row) => row.id)
        const parts = await Promise.all(Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) => fetchTouchesFor(clientId, ids.slice(i * 100, i * 100 + 100))))
        return parts.flat().map((row) => ({ ...row, summary: null }))
      }) : fetchAllBatched<Omit<TouchRow, 'summary'>>((from, to) =>
        supabaseAdmin
          .from('contact_touchpoints')
          .select('id, contact_id, channel, direction, occurred_at, created_at, raw, metadata, source')
          .eq('client_id', clientId)
          .order('occurred_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      ).then((rows) => rows.map((row) => ({ ...row, summary: null }))),
      fetchAll<StageRow>((from, to) =>
        supabaseAdmin
          .from('client_pipeline_stages')
          .select('stage_key, label, marketing_action, is_terminal')
          .eq('client_id', clientId)
          .order('sort_order', { ascending: true })
          .range(from, to),
      ),
      loadLatestBriefByContact(clientId, sharedConversations),
      supabaseAdmin
        .from('clients')
        .select('leads_config, country')
        .eq('id', clientId)
        .maybeSingle()
        .then((r) => {
          const d = r.data as { leads_config: unknown; country: string | null } | null
          return { leadsConfig: d?.leads_config ?? null, country: d?.country ?? '' }
        }),
      noteContactsRead,
    ])
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '读取失败' },
      { status: 500 },
    )
  }
  timer.step('priority_reads')

  // 系统账号（WhatsApp Business 等）不是客人，不进「智能」视图的任何一栏。
  contacts = contacts.filter((c) => !isSystemAccountName(c.display_name))
  // 客户自己的员工（登记在 leads_config.own_email_domains 的邮箱域名）也不是客人 —— 跟旧的「今天要联系」
  // 页一致，不进两张名单（2026-09 CTS 老板：「contact 里面怎么还有工作人员？」）。平铺名单不动（见 ListQuery.kind 的说明）。
  const ownRules = readDomainRules(leadsConfig)
  contacts = contacts.filter((c) => contactKindOf(c.primary_email ? [c.primary_email] : [], ownRules) !== 'staff')
  const noteContacts = allNoteContacts
    ? allNoteContacts.filter((c) => !isSystemAccountName(c.display_name) &&
        contactKindOf(c.primary_email ? [c.primary_email] : [], ownRules) !== 'staff')
    : contacts
  // 同行（旅行社 / 分销）：不在「今天先联系」散客名单里——挪到先放着并写明原因，仍可在全部客人里点「同行」筛出。
  const tradeIds = new Set(
    contacts.filter((c) => contactKindOf(c.primary_email ? [c.primary_email] : [], ownRules) === 'trade').map((c) => c.id),
  )

  const enrichedPri = await enrichForDisplay(clientId, contacts, touches, false, enrichmentInputs)
  timer.step('priority_enrich')
  contacts = enrichedPri.contacts
  touches = enrichedPri.touches

  const stageMeta = stageMetaOf(stageRows)
  const byContact = new Map<string, TouchRow[]>()
  for (const t of touches) {
    const list = byContact.get(t.contact_id) ?? []
    list.push(t)
    byContact.set(t.contact_id, list)
  }

  // 「今天」按客户所在地算（同 today 路由）：员工今天记的笔记 / 打的电话不许把人从
  // 「今天要联系」挪走 —— 2026-10-30 CTS 员工记完笔记人掉进「先放着」，以为没存上。
  // 读不到国家就按 NZ，猜错最多差两小时。
  const timeZone = clientCountry.toUpperCase() === 'AU' ? 'Australia/Sydney' : 'Pacific/Auckland'
  const nowPri = new Date()
  // 今天被推到成交 / 停止营销的人也要就地变灰（和今天要联系页同一份读取）。
  const stageSuppressedTodayIds = await loadStageSuppressedTodayIds(
    clientId,
    localDayStartMs(nowPri, timeZone),
    (k) => stageMeta.get(k)?.suppressed ?? false,
  )

  const customPerContact: Array<Record<CustomColumnKey, string | null>> = []
  const { sections, focus } = buildPriorityView(
    {
      contacts,
      touchpoints: touches,
      stageMeta,
      now: nowPri,
      perPage: query.perPage,
      open: query.open,
      page: query.sectionPage,
      focusContactId: query.focusContactId,
      briefs,
      tradeIds,
      dayStartMs: localDayStartMs(nowPri, timeZone),
      touchedToday: contactsTouchedToday(touches, nowPri, timeZone),
      stageSuppressedTodayIds,
    },
    (row, ranked) => {
      const tps = byContact.get(row.id) ?? []
      const built = responseRowFor(row as ContactRow, tps, stageMeta, buildContactModel(row, tps, stageMeta), ranked.seg, briefs.get(row.id) ?? null)
      customPerContact.push(built.custom)
      built.row.sources = enrichedPri.sources.get(row.id) ?? []
      // 今天已处理：页面就地变灰打勾，位置不动。
      built.row.handled = ranked.handled === true
      built.row.handledWhy = ranked.handledWhy ?? null
      if (ranked.handled === true) {
        // 已处理的卡片不能同时又写着「记下一步」（魏征复审 P2-b）：灰色 + 打勾那句话说明今天做了什么。
        // （afterCall 提醒本身由 dayRow 在员工记完笔记后撤掉；没记笔记时 dayRow 不会把卡片标成已处理。）
        built.row.nextAction = handledNextAction(built.row.nextAction as NextAction, ranked.handledWhy ?? '今天已处理')
      }
      return built.row
    },
  )

  timer.step('priority_assemble')
  const recentNotes = query.q === null ? recentStaffNotes(noteContacts, touches, new Date()) : []
  if (recentNotes.length > 0) {
    // The main priority scan intentionally omits summary for every touchpoint.
    // Read only the selected, latest staff note IDs so the inline card shows
    // that exact note's summary, even when no conversation brief exists.
    try {
      const { data, error } = await supabaseAdmin
        .from('contact_touchpoints')
        .select('id, summary')
        .eq('client_id', clientId)
        .in('id', recentNotes.map((note) => note.touchpointId))
      if (!error && data) {
        const summaries = new Map(data.map((row) => [row.id, row.summary]))
        for (const note of recentNotes) note.aiSummary = summaries.get(note.touchpointId) ?? null
      }
    } catch {
      // A missing summary must not hide the staff note or the contact list.
    }
  }
  timer.step('priority_note_summaries')
  const res = NextResponse.json({
    view: 'priority',
    focus,
    columns: visibleCustomColumns(customPerContact),
    stages: stageRows.map((stage) => ({
      stageKey: stage.stage_key,
      label: stage.label,
      marketingAction: isMarketingAction(stage.marketing_action) ? stage.marketing_action : 'suppress',
    })),
    sections,
    recentNotes,
    viewerEmail,
  })
  res.headers.set('Server-Timing', timer.header())
  return res
}

/**
 * GET /api/clients/[id]/crm/contacts
 *
 * 「全部客人」横表的读模型。一次拉这个客户的人 + 触点 + 阶段模型，在内存里
 * 逐人组装 —— 冷热分级复用 lib/crm/segments 的纯函数，自定义列复用
 * lib/crm/table-columns。335 人 / ~640 触点量级下比 SQL 窗口函数简单，到几千人
 * 再换物化视图（跟 today 路由同一个天花板）。
 *
 * 隔离：requirePaidClientAccess + 所有读按 client_id 收口。admin 也从 URL 收口。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const timer = createStepTimer()
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  timer.step('gate')
  const viewerEmail = access.user.email?.toLowerCase().trim() ?? null

  const parsed = parseListQuery(new URL(req.url))
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  if (parsed.ids !== undefined) return getByIds(clientId, parsed.ids, viewerEmail, timer)
  if (parsed.paged) return getPaged(clientId, parsed, viewerEmail, timer)
  if (parsed.view === 'priority') return getPriority(clientId, parsed, viewerEmail, timer)

  // 必须分页拉全 —— Supabase 单次查询硬顶 1000 行，`.limit(20000)` 会被静默
  // 砍掉且不报错。实测 CTS：库里 1271 条触点只回 1000 条；配合 order desc，
  // 丢掉的是最老的记录，于是「最后接触」「往来次数」这些列全是错的。
  let contacts: ContactRow[]
  let touches: TouchRow[]
  let stageRows: StageRow[]
  let briefs: BriefByContact
  try {
    ;[contacts, touches, stageRows, briefs] = await Promise.all([
      fetchAll<ContactRow>((from, to) =>
        supabaseAdmin
          .from('contacts')
          .select(PAGE_CONTACT_COLUMNS)
          .eq('client_id', clientId)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAll<TouchRow>((from, to) =>
        supabaseAdmin
          .from('contact_touchpoints')
          .select('id, contact_id, channel, direction, occurred_at, summary, raw, metadata, source')
          .eq('client_id', clientId)
          .order('occurred_at', { ascending: false })
          // 同一时刻的多条（导入数据里表单与通话常共用一个时间戳）需要一个
          // 确定的次序，否则每次刷新顺序可能不同。
          .order('id', { ascending: false })
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
      loadLatestBriefByContact(clientId),
    ])
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '读取失败' },
      { status: 500 },
    )
  }

  const enrichedAll = await enrichForDisplay(clientId, contacts, touches, false)
  const { out, customPerContact } = assembleRows(enrichedAll.contacts, enrichedAll.touches, stageRows, briefs, enrichedAll.sources)

  return NextResponse.json({
    totalContacts: out.length,
    columns: visibleCustomColumns(customPerContact),
    contacts: out,
    viewerEmail,
  })
}

/**
 * 逐人组装输出行 —— 分页路径和老路径共用，保证同一个人在两个形状里长得一样。
 *
 * 返回 `out`（给响应）和 `customPerContact`（给 `visibleCustomColumns` 判
 * 「这个客户该显示哪些自定义列」）。
 */
function assembleRows(
  contacts: ContactRow[],
  touches: TouchRow[],
  stageRows: StageRow[],
  briefs: BriefByContact,
  sources?: Map<string, SourceKey[]>,
): {
  out: Array<Record<string, unknown>>
  customPerContact: Array<Record<CustomColumnKey, string | null>>
} {
  const byContact = new Map<string, TouchRow[]>()
  for (const t of touches) {
    const list = byContact.get(t.contact_id) ?? []
    list.push(t)
    byContact.set(t.contact_id, list)
  }

  const stageMeta = stageMetaOf(stageRows)

  const now = new Date()
  const rows = contacts

  // 逐人组装。custom 存起来供数据驱动的「显不显示这列」判断。
  const customPerContact: Array<Record<CustomColumnKey, string | null>> = []
  const out = rows.map((c) => {
    const tps = byContact.get(c.id) ?? []
    // 装配形状收敛到共享 builder：全部客人 / 今天名单 / WP3 跟进表用同一个函数吃同一份数据，
    // 分段模块只有一份，喂它的形状也只能有一份。见 lib/crm/contact-model 头注。
    const model = buildContactModel(c, tps, stageMeta)
    const seg = segmentContact(model, now)
    // 响应行也只有一份 —— view=priority 与本路径共用 responseRowFor，
    // 否则两个入口会各自长出一套字段（2026-09-26 R5b：就是在这里发现它已经被抄了第二份）。
    const built = responseRowFor(c, tps, stageMeta, model, seg, briefs.get(c.id) ?? null)
    customPerContact.push(built.custom)
    if (sources !== undefined) built.row.sources = sources.get(c.id) ?? []
    return built.row
  })

  return { out, customPerContact }
}

interface Body {
  name?: unknown
  phone?: unknown
  email?: unknown
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const phone = typeof body.phone === 'string' ? body.phone : null
  const email = typeof body.email === 'string' ? body.email : null

  // 市场决定本地号码怎么补国码(CTS=NZ / Oztop=AU)。
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('semrush_db, country')
    .eq('id', clientId)
    .maybeSingle()
  const defaultCountry: 'NZ' | 'AU' =
    client?.country === 'NZ' || client?.semrush_db === 'nz' ? 'NZ' : 'AU'

  const identities = buildIdentities({ phone, email, defaultCountry })
  if (identities.length === 0) {
    return NextResponse.json(
      { error: '至少要填一个能用的电话或邮箱' },
      { status: 400 },
    )
  }

  try {
    const result = await resolveContact({
      clientId,
      identities,
      displayName: name || null,
      source: 'me_manual',
      // 手工录入:电话打错一位就可能撞上另一个老客户。自动合并会把两个真人的
      // 全部历史搅在一起且不可逆,所以交给人看一眼;也不拿新名字盖掉老客户的名字。
      mergeStrategy: 'reject',
      overwriteDisplayName: false,
      // 员工手工录进来的人:平台就是 'manual',广告层级一律 NULL —— 我们**不知道**
      // 他从哪来(线下认识 / 电话打进来 / 朋友介绍),编一个 platform 会污染
      // 「哪条广告有效」的分母。留 manual 是如实标注「这条没有广告归因」。
      attribution: { ...EMPTY_ATTRIBUTION, platform: 'manual' },
    })
    return NextResponse.json({ contactId: result.contactId, created: result.created })
  } catch (err) {
    if (err instanceof AmbiguousIdentityError) {
      // 电话和邮箱分别属于两个已存在的人 —— 多半是打错了。把两边摆出来让人看。
      const { data: rows } = await supabaseAdmin
        .from('contacts')
        .select('id, display_name, primary_phone, primary_email')
        .in('id', err.contactIds)
        .eq('client_id', clientId)

      return NextResponse.json(
        {
          error: '这个电话和邮箱分别属于两位已有的客人，请确认是不是填错了',
          reason: 'ambiguous',
          candidates: (rows ?? []).map((r) => ({
            contactId: r.id,
            name: contactCardTitle(r.display_name),
            phone: r.primary_phone,
            email: r.primary_email,
          })),
        },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '录入失败' },
      { status: 500 },
    )
  }
}
