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
import { buildIdentities, resolveContact, AmbiguousIdentityError } from '@/lib/crm/identity'
import { EMPTY_ATTRIBUTION } from '@/lib/crm/attribution'
import { segmentContact } from '@/lib/crm/segments'
import { buildContactModel } from '@/lib/crm/contact-model'
import {
  responseRowFor,
  stageMetaOf,
  type ContactRow,
  type TouchRow,
  type StageRow,
} from '@/lib/crm/contact-response-row'
import { buildPriorityView } from '@/lib/crm/contact-list-view'
import type { SectionKey } from '@/lib/crm/list-sections'
import { fetchAll } from '@/lib/supabase-paginate'
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
  /** `?view=priority` → 4 段视图。null = 老的平铺列表。 */
  view: 'priority' | null
  /** 段展开状态：`?open=waiting,acted`。缺省 undefined = 用 list-sections 的默认（前两段展开）。 */
  open?: Partial<Record<SectionKey, boolean>>
  /** 段内翻页：`?p_waiting=2&p_off_list=1`，1-based。 */
  sectionPage?: Partial<Record<SectionKey, number>>
  /** `?contact=<id>` —— 今日待办的直达链接；服务端定位它落在哪段哪页。 */
  focusContactId?: string
}

const DEFAULT_PER_PAGE = 100
const MAX_PER_PAGE = 500

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
    sp.has('page') || sp.has('perPage') || sp.has('stage') || sp.has('stages') || sp.has('q')

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
  if (q !== null && /[,()]/.test(q)) return { error: 'invalid characters in q' }

  const SECTION_KEYS: SectionKey[] = ['waiting', 'acted', 'queued', 'off_list']
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

  // view=priority 不走分页路径：它自己一次拉全（筛选后的）子集再在内存里分段。
  return { paged: view === null && paged, page, perPage, stages, q, view, open, sectionPage, focusContactId }
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
        : `display_name.ilike.%${query.q}%,primary_phone.ilike.%${query.q}%,primary_email.ilike.%${query.q}%`,
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
async function getPaged(clientId: string, query: ListQuery): Promise<NextResponse> {
  let total: number
  let pageContacts: ContactRow[]
  let stageRows: StageRow[]
  try {
    // 两次查询的过滤条件必须逐字一致 —— 共享一份过滤参数后各自 apply。
    const filters = contactFilterParams(query)

    let countBuilder = supabaseAdmin
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
    if (filters.stages !== null) countBuilder = countBuilder.in('stage', filters.stages)
    if (filters.orExpr !== null) countBuilder = countBuilder.or(filters.orExpr)

    let pageBuilder = supabaseAdmin
      .from('contacts')
      .select('id, display_name, primary_phone, primary_email, do_not_contact, snooze_until, stage, first_seen_at, pinned_at, important_note, important_due_at')
      .eq('client_id', clientId)
    if (filters.stages !== null) pageBuilder = pageBuilder.in('stage', filters.stages)
    if (filters.orExpr !== null) pageBuilder = pageBuilder.or(filters.orExpr)

    const [countRes, pageRes, stages] = await Promise.all([
      countBuilder,
      pageBuilder
        .order('id', { ascending: true })
        .range((query.page - 1) * query.perPage, query.page * query.perPage - 1),
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
    if (pageRes.error) throw new Error(pageRes.error.message)
    total = countRes.count ?? 0
    pageContacts = (pageRes.data ?? []) as ContactRow[]
    stageRows = stages
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '读取失败' },
      { status: 500 },
    )
  }

  const pageIds = pageContacts.map((c) => c.id)
  let touches: TouchRow[]
  try {
    touches =
      pageIds.length === 0
        ? []
        : await fetchAll<TouchRow>((from, to) =>
            supabaseAdmin
              .from('contact_touchpoints')
              .select('id, contact_id, channel, direction, occurred_at, summary, raw, metadata, source')
              .eq('client_id', clientId)
              .in('contact_id', pageIds)
              .order('occurred_at', { ascending: false })
              .order('id', { ascending: false })
              .range(from, to),
          )
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '读取失败' },
      { status: 500 },
    )
  }

  const { out, customPerContact } = assembleRows(pageContacts, touches, stageRows)

  return NextResponse.json({
    total,
    page: query.page,
    perPage: query.perPage,
    columns: visibleCustomColumns(customPerContact),
    items: out,
  })
}

/**
 * `?view=priority` —— 4 段跟进视图。
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
async function getPriority(clientId: string, query: ListQuery): Promise<NextResponse> {
  let contacts: ContactRow[]
  let touches: TouchRow[]
  let stageRows: StageRow[]
  try {
    const filters = contactFilterParams(query)
    ;[contacts, touches, stageRows] = await Promise.all([
      fetchAll<ContactRow>((from, to) => {
        let b = supabaseAdmin
          .from('contacts')
          .select('id, display_name, primary_phone, primary_email, do_not_contact, snooze_until, stage, first_seen_at, pinned_at, important_note, important_due_at')
          .eq('client_id', clientId)
        if (filters.stages !== null) b = b.in('stage', filters.stages)
        if (filters.orExpr !== null) b = b.or(filters.orExpr)
        return b.order('id', { ascending: true }).range(from, to)
      }),
      fetchAll<TouchRow>((from, to) =>
        supabaseAdmin
          .from('contact_touchpoints')
          .select('id, contact_id, channel, direction, occurred_at, summary, raw, metadata, source')
          .eq('client_id', clientId)
          .order('occurred_at', { ascending: false })
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
    ])
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '读取失败' },
      { status: 500 },
    )
  }

  const stageMeta = stageMetaOf(stageRows)
  const byContact = new Map<string, TouchRow[]>()
  for (const t of touches) {
    const list = byContact.get(t.contact_id) ?? []
    list.push(t)
    byContact.set(t.contact_id, list)
  }

  const customPerContact: Array<Record<CustomColumnKey, string | null>> = []
  const { sections, focus } = buildPriorityView(
    {
      contacts,
      touchpoints: touches,
      stageMeta,
      now: new Date(),
      perPage: query.perPage,
      open: query.open,
      page: query.sectionPage,
      focusContactId: query.focusContactId,
    },
    (row, ranked) => {
      const tps = byContact.get(row.id) ?? []
      const built = responseRowFor(row as ContactRow, tps, stageMeta, buildContactModel(row, tps, stageMeta), ranked.seg)
      customPerContact.push(built.custom)
      return built.row
    },
  )

  return NextResponse.json({
    view: 'priority',
    focus,
    columns: visibleCustomColumns(customPerContact),
    sections,
  })
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
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const parsed = parseListQuery(new URL(req.url))
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  if (parsed.paged) return getPaged(clientId, parsed)
  if (parsed.view === 'priority') return getPriority(clientId, parsed)

  // 必须分页拉全 —— Supabase 单次查询硬顶 1000 行，`.limit(20000)` 会被静默
  // 砍掉且不报错。实测 CTS：库里 1271 条触点只回 1000 条；配合 order desc，
  // 丢掉的是最老的记录，于是「最后接触」「往来次数」这些列全是错的。
  let contacts: ContactRow[]
  let touches: TouchRow[]
  let stageRows: StageRow[]
  try {
    ;[contacts, touches, stageRows] = await Promise.all([
      fetchAll<ContactRow>((from, to) =>
        supabaseAdmin
          .from('contacts')
          .select('id, display_name, primary_phone, primary_email, do_not_contact, snooze_until, stage, first_seen_at, pinned_at, important_note, important_due_at')
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
          // 确定的次序，否则每次刷新顺序都可能不同。
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
    ])
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '读取失败' },
      { status: 500 },
    )
  }

  const { out, customPerContact } = assembleRows(contacts, touches, stageRows)

  return NextResponse.json({
    totalContacts: out.length,
    columns: visibleCustomColumns(customPerContact),
    contacts: out,
  })
}

/** 阶段 map：label 给「跟进到哪步」列，suppressed 决定这个人算不算已结论（影响冷热）。 */
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
    const built = responseRowFor(c, tps, stageMeta, model, seg)
    customPerContact.push(built.custom)
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
            name: r.display_name ?? '未留姓名',
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
