/**
 * 路线配置的读取与校验（`client_lead_sheet_routes`）。
 *
 * 校验是**fail-loud** 的：配置里写了不认识的字段名、判重列指到不存在的列，
 * 一律当场报错并跳过这条路线。宁可这个客户这轮不同步、在待办里喊一声，
 * 也不能默默写出一片错位或空白的行 —— 那是客户和销售直接看的表。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { LEAD_SHEET_FIELDS, type LeadSheetColumn, type LeadSheetField, type LeadSheetRoute } from './types'

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
    timezone,
    backfillSince: row.backfill_since,
    enabled: row.enabled !== false,
  }
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
      'route_key, label, spreadsheet_id, tab_name, match_any_answer_fields, priority, columns, value_labels, dedup_columns, timezone, backfill_since, enabled',
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
