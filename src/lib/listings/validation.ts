/**
 * 房子写入校验 —— 建档 / 编辑两条路都必须过这里。
 *
 * 为什么单独一层而不是写在路由里:校验必须放在最里层,不能只靠前端下拉。
 * 前端下拉只是「方便」,真正的闸门在这;有人直接 curl 打 API(或者以后多一个
 * 调用方 —— 批量导入 / 中介自助端 / agent 自动建档)时,绕过前端也绕不过这里。
 *
 * 取值校验跟数据库 CHECK 约束一一对应(见 20260730145332_listings.sql)。
 * 这里挡下来 → 400 带人话原因;这里漏过去 → 数据库 500 一句看不懂的约束名。
 *
 * 纯函数、无 IO,所以能被单元测试直接打。
 */

import {
  isPriceBand,
  isPropertyType,
  isListingStatus,
  PRICE_BANDS,
  PROPERTY_TYPES,
  LISTING_STATUSES,
  DEFAULT_LISTING_STATUS,
} from './constants'

/** 落库的列集合(snake_case,直接喂 supabase)。 */
export interface ListingWriteColumns {
  address_line?: string
  suburb?: string | null
  city?: string | null
  property_type?: string | null
  bedrooms?: number | null
  price_band?: string | null
  status?: string
  listed_on?: string | null
  delisted_on?: string | null
  sold_on?: string | null
  sold_price?: number | null
  vendor_notes?: string | null
  external_ref?: string | null
}

export type ValidationResult =
  | { ok: true; value: ListingWriteColumns }
  | { ok: false; error: string }

// 长度上限:数据库是 TEXT 不限长,但不设上限等于给「粘贴整篇文档进地址栏」开门。
const MAX_ADDRESS = 300
const MAX_SHORT = 120
const MAX_NOTES = 4000
/** smallint 放得下,现实里没有 100 房的挂牌。 */
const MAX_BEDROOMS = 100
/** NUMERIC(12,2) 的上限。 */
const MAX_SOLD_PRICE = 9_999_999_999.99

function fail(error: string): ValidationResult {
  return { ok: false, error }
}

/** 空字符串一律当「清空」处理,存 NULL,不存 ''。 */
function cleanText(raw: unknown, field: string, max: number):
  | { ok: true; value: string | null }
  | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: `${field} 必须是文本` }
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: true, value: null }
  if (trimmed.length > max) {
    return { ok: false, error: `${field} 太长(最多 ${max} 个字符)` }
  }
  return { ok: true, value: trimmed }
}

/** 严格 YYYY-MM-DD,而且必须是真实存在的日期(挡掉 2026-02-31)。 */
function cleanDate(raw: unknown, field: string):
  | { ok: true; value: string | null }
  | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: `${field} 必须是 YYYY-MM-DD 格式的日期` }
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: true, value: null }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { ok: false, error: `${field} 必须是 YYYY-MM-DD 格式的日期` }
  }
  const [y, m, d] = trimmed.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return { ok: false, error: `${field} 不是一个真实存在的日期` }
  }
  return { ok: true, value: trimmed }
}

function cleanBedrooms(raw: unknown):
  | { ok: true; value: number | null }
  | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null }
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return { ok: false, error: '卧室数必须是数字' }
  if (!Number.isInteger(n)) return { ok: false, error: '卧室数必须是整数' }
  if (n < 0 || n > MAX_BEDROOMS) {
    return { ok: false, error: `卧室数必须在 0 到 ${MAX_BEDROOMS} 之间` }
  }
  return { ok: true, value: n }
}

function cleanSoldPrice(raw: unknown):
  | { ok: true; value: number | null }
  | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null }
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return { ok: false, error: '成交价必须是数字' }
  if (n < 0) return { ok: false, error: '成交价不能是负数' }
  if (n > MAX_SOLD_PRICE) return { ok: false, error: '成交价超出可存范围' }
  // 钱只留两位小数(数据库是 NUMERIC(12,2),多出来的位会被静默四舍五入,
  // 与其让库悄悄改,不如这里就定死)。
  return { ok: true, value: Math.round(n * 100) / 100 }
}

/**
 * 三个枚举字段的统一处理。
 *
 * 注意「非法值一律报错」而不是「静默丢弃」:静默丢弃会让 FDE 以为存进去了,
 * 回头发现房型是空的,而且没人知道是哪一步吃掉的。
 */
function cleanEnum(
  raw: unknown,
  field: string,
  guard: (v: unknown) => boolean,
  allowed: readonly string[],
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null }
  if (!guard(raw)) {
    return { ok: false, error: `${field} 取值不合法(只能是:${allowed.join(' / ')})` }
  }
  return { ok: true, value: raw as string }
}

/** 逐字段收集,任一失败立刻返回 —— 让调用方拿到第一条人话原因。 */
// eslint-disable-next-line complexity
function collectOptionalFields(
  body: Record<string, unknown>,
  out: ListingWriteColumns,
): string | null {
  const textFields: Array<[keyof ListingWriteColumns, string, string, number]> = [
    ['suburb', 'suburb', '郊区', MAX_SHORT],
    ['city', 'city', '城市', MAX_SHORT],
    ['vendor_notes', 'vendor_notes', '备注', MAX_NOTES],
    ['external_ref', 'external_ref', '外部编号', MAX_SHORT],
  ]
  for (const [col, key, label, max] of textFields) {
    if (!(key in body)) continue
    const r = cleanText(body[key], label, max)
    if (!r.ok) return r.error
    ;(out[col] as string | null) = r.value
  }

  const dateFields: Array<[keyof ListingWriteColumns, string, string]> = [
    ['listed_on', 'listed_on', '上市日期'],
    ['delisted_on', 'delisted_on', '撤下日期'],
    ['sold_on', 'sold_on', '成交日期'],
  ]
  for (const [col, key, label] of dateFields) {
    if (!(key in body)) continue
    const r = cleanDate(body[key], label)
    if (!r.ok) return r.error
    ;(out[col] as string | null) = r.value
  }

  if ('property_type' in body) {
    const r = cleanEnum(body.property_type, '房型', isPropertyType, PROPERTY_TYPES)
    if (!r.ok) return r.error
    out.property_type = r.value
  }
  if ('price_band' in body) {
    const r = cleanEnum(body.price_band, '价格档', isPriceBand, PRICE_BANDS)
    if (!r.ok) return r.error
    out.price_band = r.value
  }
  if ('bedrooms' in body) {
    const r = cleanBedrooms(body.bedrooms)
    if (!r.ok) return r.error
    out.bedrooms = r.value
  }
  if ('sold_price' in body) {
    const r = cleanSoldPrice(body.sold_price)
    if (!r.ok) return r.error
    out.sold_price = r.value
  }
  return null
}

function asObject(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  return body as Record<string, unknown>
}

/**
 * 建档校验。address_line 是唯一必填 —— 没有门牌的房子在列表里没法认。
 * status 不传就是数据库默认的 prospect。
 */
export function validateListingCreate(body: unknown): ValidationResult {
  const obj = asObject(body)
  if (!obj) return fail('请求内容必须是一个对象')

  const out: ListingWriteColumns = {}

  const addr = cleanText(obj.address_line, '地址', MAX_ADDRESS)
  if (!addr.ok) return fail(addr.error)
  if (!addr.value) return fail('地址不能为空')
  out.address_line = addr.value

  if ('status' in obj && obj.status !== null && obj.status !== undefined && obj.status !== '') {
    if (!isListingStatus(obj.status)) {
      return fail(`状态取值不合法(只能是:${LISTING_STATUSES.join(' / ')})`)
    }
    out.status = obj.status
  } else {
    out.status = DEFAULT_LISTING_STATUS
  }

  const err = collectOptionalFields(obj, out)
  if (err) return fail(err)

  return { ok: true, value: out }
}

/**
 * 编辑校验。只处理请求里真正出现的字段(未出现 = 不动),所以前端可以只发改了的那几个。
 * status 出现时不允许清空 —— 数据库上它是 NOT NULL。
 */
export function validateListingPatch(body: unknown): ValidationResult {
  const obj = asObject(body)
  if (!obj) return fail('请求内容必须是一个对象')

  const out: ListingWriteColumns = {}

  if ('address_line' in obj) {
    const addr = cleanText(obj.address_line, '地址', MAX_ADDRESS)
    if (!addr.ok) return fail(addr.error)
    if (!addr.value) return fail('地址不能为空')
    out.address_line = addr.value
  }

  if ('status' in obj) {
    if (!isListingStatus(obj.status)) {
      return fail(`状态取值不合法(只能是:${LISTING_STATUSES.join(' / ')})`)
    }
    out.status = obj.status
  }

  const err = collectOptionalFields(obj, out)
  if (err) return fail(err)

  if (Object.keys(out).length === 0) return fail('没有要修改的字段')

  return { ok: true, value: out }
}
