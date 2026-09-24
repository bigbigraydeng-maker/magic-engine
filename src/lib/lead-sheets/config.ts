/**
 * 路线配置的读取与校验（`client_lead_sheet_routes`）。
 *
 * 校验是**fail-loud** 的：配置里写了不认识的字段名、判重列指到不存在的列，
 * 一律当场报错并跳过这条路线。宁可这个客户这轮不同步、在待办里喊一声，
 * 也不能默默写出一片错位或空白的行 —— 那是客户和销售直接看的表。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  LEAD_SHEET_FIELDS,
  destinationKey,
  type LeadSheetColumn,
  type LeadSheetField,
  type LeadSheetRoute,
} from './types'

interface RouteRow {
  route_key: string
  label: string | null
  spreadsheet_id: string
  tab_name: string
  match_any_answer_fields: string[] | null
  priority: number | null
  columns: unknown
  value_labels: unknown
  dedup_columns: number[] | null
  dedup_id_column: number | null
  header_row: string[] | null
  timezone: string | null
  backfill_since: string | null
  enabled: boolean | null
}

const FIELD_SET = new Set<string>(LEAD_SHEET_FIELDS)

export class LeadSheetConfigError extends Error {
  constructor(public readonly routeKey: string, message: string) {
    super(`线索表格路线「${routeKey}」配置有问题：${message}`)
    this.name = 'LeadSheetConfigError'
  }
}

function parseColumns(routeKey: string, raw: unknown): LeadSheetColumn[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new LeadSheetConfigError(routeKey, 'columns 必须是非空数组')
  }
  return raw.map((item, i) => {
    if (typeof item !== 'object' || item === null) {
      throw new LeadSheetConfigError(routeKey, `第 ${i + 1} 列不是对象`)
    }
    const col = item as Record<string, unknown>
    const field = col.field
    if (typeof field !== 'string' || !FIELD_SET.has(field)) {
      throw new LeadSheetConfigError(
        routeKey,
        `第 ${i + 1} 列的 field「${String(field)}」不认识（可用：${LEAD_SHEET_FIELDS.join(' / ')}）`,
      )
    }
    if (field === 'answer' && typeof col.key !== 'string') {
      throw new LeadSheetConfigError(routeKey, `第 ${i + 1} 列是 answer，但没写 key（问题名）`)
    }
    /**
     * 🔴 literal 没写 value 一律判坏。
     *
     * 这一列现在扛着「来源表单」—— 而 seed SQL 是用 `jsonb_set(模板,'{11,value}',…)`
     * 往固定下标塞标签的。下标打偏（有人在模板里加了一列忘了改那个 11）的三种结果
     * 本机实测过，**全是静默**：挂到错的列上不报错、下标越界直接 no-op。
     * 而 `buildRow` 对 literal 取不到值连 `blankedFields` 都不记一笔
     * （row.ts 故意的：literal 留白通常是有意为之）。
     * 结果就是整张表的「来源表单」列一片空白 / 全写着模板里的占位符，看着像有意为之。
     * 在这里当场抛，打偏 = 配置报错 = 整个客户停手 + 出待办。
     */
    if (field === 'literal' && (typeof col.value !== 'string' || col.value === '')) {
      throw new LeadSheetConfigError(
        routeKey,
        `第 ${i + 1} 列是 literal，但没写 value（要写进去的固定文本）`,
      )
    }
    const format = col.format
    if (format !== undefined && format !== 'iso' && format !== 'local') {
      throw new LeadSheetConfigError(routeKey, `第 ${i + 1} 列的 format 只能是 iso 或 local`)
    }
    return {
      field: field as LeadSheetField,
      ...(typeof col.key === 'string' ? { key: col.key } : {}),
      ...(typeof col.value === 'string' ? { value: col.value } : {}),
      ...(typeof col.prefix === 'string' ? { prefix: col.prefix } : {}),
      ...(format ? { format } : {}),
      ...(col.mapped === true ? { mapped: true as const } : {}),
    }
  })
}

function parseValueLabels(routeKey: string, raw: unknown): Record<string, string> {
  if (raw === null || raw === undefined) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new LeadSheetConfigError(routeKey, 'value_labels 必须是对象')
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'string') {
      throw new LeadSheetConfigError(routeKey, `value_labels["${k}"] 不是字符串`)
    }
    out[k] = v
  }
  return out
}

/** 一行配置 → 一条路线。校验不过直接抛。 */
export function parseRoute(row: RouteRow): LeadSheetRoute {
  const routeKey = row.route_key
  if (!row.spreadsheet_id || !row.tab_name) {
    throw new LeadSheetConfigError(routeKey, 'spreadsheet_id / tab_name 不能为空')
  }

  const columns = parseColumns(routeKey, row.columns)
  const dedupColumns = row.dedup_columns ?? []
  if (dedupColumns.length === 0) {
    throw new LeadSheetConfigError(routeKey, 'dedup_columns 不能为空 —— 没有判重键就会写重复行')
  }
  for (const i of dedupColumns) {
    if (!Number.isInteger(i) || i < 0 || i >= columns.length) {
      throw new LeadSheetConfigError(
        routeKey,
        `dedup_columns 里的 ${i} 超出列范围（共 ${columns.length} 列，下标 0 起）`,
      )
    }
  }

  /**
   * 🔴 判重列里至少要有一列能区分**人**。
   *
   * 想清楚过的反例：判重列配成只剩「留资时间」。`dedup_columns` 原来只校验
   * 「非空 + 下标合法」，这个配置会被放行 —— 然后同一分钟内留资的人**互相吞掉**，
   * 第二个起全部记进 `alreadyPresent`（那个数字没有任何出口），零报警。
   * 团名、预算这种答案列也不算能区分人。
   */
  const PERSONAL_FIELDS = new Set(['lead_id', 'contact_phone', 'contact_email', 'contact_name'])
  if (!dedupColumns.some((i) => PERSONAL_FIELDS.has(columns[i].field))) {
    throw new LeadSheetConfigError(
      routeKey,
      `dedup_columns 里一列能区分人的都没有（要至少一个 ${[...PERSONAL_FIELDS].join(' / ')}）—— ` +
        `不然同一分钟留资的人会互相吞掉，而且不会有任何地方报警`,
    )
  }

  const idCol = row.dedup_id_column
  if (idCol !== null && idCol !== undefined) {
    if (!Number.isInteger(idCol) || idCol < 0 || idCol >= columns.length) {
      throw new LeadSheetConfigError(
        routeKey,
        `dedup_id_column 的 ${idCol} 超出列范围（共 ${columns.length} 列，下标 0 起）`,
      )
    }
    /**
     * 🔴 机器键那一列必须真的是 lead id。
     *
     * 指错一列的后果是**判重悄悄退化**：那一列（比如姓名）人能编辑，改一下键就变了；
     * 或者那一列本来就是空的，机器键永远算不出来，判重只剩「时间+电话」——
     * 销售把电话规整成 `+64 21 …` 就会被再写一行。两种都不报错。
     */
    if (columns[idCol].field !== 'lead_id') {
      throw new LeadSheetConfigError(
        routeKey,
        `dedup_id_column 指到第 ${idCol + 1} 列（${columns[idCol].field}），但机器键那一列必须是 lead_id`,
      )
    }
  }

  const headerRow = row.header_row ?? null
  if (headerRow !== null) {
    if (!Array.isArray(headerRow) || headerRow.some((h) => typeof h !== 'string')) {
      throw new LeadSheetConfigError(routeKey, 'header_row 必须是字符串数组')
    }
    if (headerRow.length !== columns.length) {
      throw new LeadSheetConfigError(
        routeKey,
        `header_row 有 ${headerRow.length} 格，columns 有 ${columns.length} 列 —— 对不上就没法拿它比对表头`,
      )
    }
  }

  const timezone = row.timezone ?? 'Pacific/Auckland'
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone })
  } catch {
    throw new LeadSheetConfigError(routeKey, `时区「${timezone}」不认识`)
  }

  if (row.backfill_since && !Number.isFinite(Date.parse(row.backfill_since))) {
    throw new LeadSheetConfigError(routeKey, `backfill_since「${row.backfill_since}」不是合法时间`)
  }

  return {
    routeKey,
    label: row.label,
    spreadsheetId: row.spreadsheet_id,
    tabName: row.tab_name,
    matchAnyAnswerFields: row.match_any_answer_fields ?? [],
    priority: row.priority ?? 100,
    columns,
    valueLabels: parseValueLabels(routeKey, row.value_labels),
    dedupColumns,
    dedupIdColumn: idCol ?? null,
    headerRow,
    timezone,
    backfillSince: row.backfill_since,
    enabled: row.enabled !== false,
  }
}

/**
 * 两条写同一张表同一个 tab 的路线，结构对不对得上。
 * 对得上返回 null；对不上返回一句人话，直接拼进待办里给人看。
 *
 * 只比**会影响判重和列位**的东西。`value`（literal 的固定文本）故意不比 ——
 * 「来源表单」那一列每条路线各写各的标签，正是这个能力的用途。
 */
export function describeLayoutMismatch(
  a: LeadSheetRoute,
  b: LeadSheetRoute,
): string | null {
  if (a.columns.length !== b.columns.length) {
    return `列数不一样（${a.columns.length} 列 vs ${b.columns.length} 列）`
  }
  for (let i = 0; i < a.columns.length; i++) {
    const x = a.columns[i]
    const y = b.columns[i]
    if (
      x.field !== y.field ||
      x.key !== y.key ||
      x.prefix !== y.prefix ||
      x.format !== y.format ||
      x.mapped !== y.mapped
    ) {
      return `第 ${i + 1} 列放的东西不一样（「${describeColumn(x)}」vs「${describeColumn(y)}」）`
    }
  }
  if (a.dedupColumns.join(',') !== b.dedupColumns.join(',')) {
    return `判重列不一样（[${a.dedupColumns.join(', ')}] vs [${b.dedupColumns.join(', ')}]）`
  }
  if (a.dedupIdColumn !== b.dedupIdColumn) {
    return `机器键列不一样（${a.dedupIdColumn ?? '没有'} vs ${b.dedupIdColumn ?? '没有'}）`
  }
  if (a.timezone !== b.timezone) {
    return `时区不一样（${a.timezone} vs ${b.timezone}）—— 时间列会写出两种读数，判重对不上`
  }
  /**
   * 时间窗口也要一致。不一致不会丢线索，但会**悄悄割裂配置意图**：同一张表上
   * 一种表单的历史全灌进来了、另一种一条没有，而两条路线的回执都显示成功，
   * 没有任何地方会说「这张表只补了一半」。宁可当场判坏让人改配置。
   */
  if ((a.headerRow ?? []).join('\u0000') !== (b.headerRow ?? []).join('\u0000')) {
    return '表头签名不一样 —— 同一张表不可能有两种表头，必有一条配错了'
  }
  if ((a.backfillSince ?? null) !== (b.backfillSince ?? null)) {
    return (
      `补历史的时间窗口不一样（${a.backfillSince ?? '不限'} vs ${b.backfillSince ?? '不限'}）` +
      ` —— 同一张表会只补进来一半，而两边回执都显示成功`
    )
  }
  return null
}

/**
 * 一列的可读说明，只用在上面那条错误原话里。
 *
 * 🔴 `prefix` / `format` / `mapped` 也要带上 —— 比对本来就比这三样，不带的话
 *    两条路线只在 prefix 上不一致时，待办里会出现「第 3 列放的东西不一样
 *    （「contact_phone」vs「contact_phone」）」，左右一字不差，PM 看了没法办。
 */
function describeColumn(col: LeadSheetColumn): string {
  const bits = [col.field === 'answer' ? `answer:${col.key ?? ''}` : col.field]
  if (col.prefix) bits.push(`前缀 ${col.prefix}`)
  if (col.format) bits.push(`格式 ${col.format}`)
  if (col.mapped) bits.push('翻中文')
  return bits.join(' · ')
}

export interface LoadedRoutes {
  routes: LeadSheetRoute[]
  /** 配置坏掉、这轮被跳过的路线（会进人工待办）。 */
  invalid: Array<{ routeKey: string; reason: string }>
}

/** 读一个客户的全部路线。读表本身失败会抛；单条配置坏掉只跳过那一条。 */
export async function loadClientRoutes(
  supabase: SupabaseClient,
  clientId: string,
): Promise<LoadedRoutes> {
  const { data, error } = await supabase
    .from('client_lead_sheet_routes')
    .select(
      'route_key, label, spreadsheet_id, tab_name, match_any_answer_fields, priority, columns, value_labels, dedup_columns, dedup_id_column, header_row, timezone, backfill_since, enabled',
    )
    .eq('client_id', clientId)
    .eq('enabled', true)
    .order('priority', { ascending: true })

  if (error) throw new Error(`读线索表格路线配置失败：${error.message}`)

  const routes: LeadSheetRoute[] = []
  const invalid: Array<{ routeKey: string; reason: string }> = []
  for (const row of (data ?? []) as RouteRow[]) {
    try {
      routes.push(parseRoute(row))
    } catch (err) {
      invalid.push({ routeKey: row.route_key, reason: err instanceof Error ? err.message : String(err) })
    }
  }

  /**
   * 🔴 几条路线**允许**写同一张表的同一个 tab，但必须「长得一模一样」。
   *
   * PM 2026-09-24 拍板：CTS 所有表单的线索汇总进**一张**表，用一列「来源表单」
   * 区分。所以「多条路线 → 同一张表」从异常变成了**常态**：分流判据仍然只看
   * 「这条线索的问答里出现了哪些字段名」，分流的结果从「写哪张表」变成
   * 「那一列写哪个来源标签」。
   *
   * 但只有结构相同才安全。原先一律判坏防的是这个：列定义不一样时，A 路线判重
   * 会去读 B 路线写的那几格，而那几格在 B 的列定义里语义完全不同 —— 误判成
   * 「已存在」，**静默丢线索**。所以下面逐项比对，对不上照样判坏：
   *
   *   · 每一列的 field / key / prefix / format / mapped 必须一致。只有 `value`
   *     （literal 的固定文本）可以不同 —— 那正是「来源表单」这一列存在的理由。
   *   · dedup_columns / dedup_id_column / timezone 必须一致 —— `sync.ts` 对同一张表
   *     只读一次，判重键在这一组路线之间共享，用的是**第一条**路线的判重配置；
   *     不一致就等于后面那条路线拿别人的尺子量自己的行。
   *
   * 不比 value_labels：那顶多让同一个选项在同一列里出现两种写法（难看、销售按
   * 那一列筛会漏），不会丢线索。而配置坏一条 = 整个客户这轮停手，为这个把线索
   * 全停掉不划算。
   */
  const seen = new Map<string, LeadSheetRoute>()
  for (const r of [...routes]) {
    const key = destinationKey(r)
    const first = seen.get(key)
    if (!first) {
      seen.set(key, r)
      continue
    }
    const mismatch = describeLayoutMismatch(first, r)
    if (mismatch) {
      routes.splice(routes.indexOf(r), 1)
      invalid.push({
        routeKey: r.routeKey,
        reason:
          `路线「${r.routeKey}」跟「${first.routeKey}」指向同一张表的同一个 tab（${r.tabName}），` +
          `但两边${mismatch} —— 写进同一个 tab 会互相误判成「已存在」而丢线索`,
      })
    }
  }

  return { routes, invalid }
}

/** 哪些客户配了路线 —— 派单用，不读配置正文。 */
export async function loadRoutedClientIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from('client_lead_sheet_routes')
    .select('client_id')
    .eq('enabled', true)
  if (error) throw new Error(`读线索表格路线名单失败：${error.message}`)
  return [...new Set(((data ?? []) as Array<{ client_id: string }>).map((r) => r.client_id))]
}
