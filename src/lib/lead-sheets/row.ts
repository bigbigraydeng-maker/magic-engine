/**
 * 纯函数：一条线索 + 一条路线 → 一行单元格 / 一把判重键。
 *
 * 没有 IO，没有客户语义。所有「哪一列放什么」「这个选项翻成什么中文」都从
 * 路线配置里读。
 */

import type { LeadRecord, LeadSheetColumn, LeadSheetRoute } from './types'

/** 判重键的列分隔符。用不可能出现在表格文本里的记录分隔符。 */
const KEY_SEP = ''

/**
 * 选项值归一化 —— 查 `value_labels` 用的键。
 *
 * 🔴 **为什么必须归一**：同一个选项在不同版本的表单里写法会飘。CTS 实测同一个
 *    「还在决定」出现过 `still_deciding_-_show_me_all`、`still_deciding_—_show_me_all_4`、
 *    `still_deciding_-_show_me_everything` 三种；破折号有 `-` 也有 `—`。
 *    按原样精确匹配 = 每次表单微调都要补一次配置，漏补就写出一列英文 slug。
 *
 * 归一规则：小写 → 各种破折号/下划线/空格/连续分隔符压成一个 `_` → 去掉首尾 `_`。
 * **只动分隔符**，不删字、不删括号、不做近似匹配 —— 近似匹配会把
 * 「圣诞·奥克兰出发」和「圣诞·基督城出发」认成同一个。
 */
export function normaliseAnswerValue(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s\-‐-―_]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/** `2026-09-23T21:52:24Z` + `Pacific/Auckland` → `2026-09-24 09:52`。 */
export function formatLocalMinute(iso: string, timeZone: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? ''
  // en-CA 在午夜会给 hour='24'，统一掰回 '00'（日期部分 Intl 已经算对了）。
  const hour = get('hour') === '24' ? '00' : get('hour')
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}`
}

/** 渲染一行时顺带记下来的「配置还差什么 / 库里还缺什么」。 */
export interface RowNotes {
  /** 配置里没有中文的选项值（归一化后的键）。 */
  unmappedValues: string[]
  /** 想填但取不到值的字段名。 */
  blankedFields: string[]
}

export function emptyNotes(): RowNotes {
  return { unmappedValues: [], blankedFields: [] }
}

function rawValue(lead: LeadRecord, col: LeadSheetColumn): string | null {
  switch (col.field) {
    case 'lead_id':       return lead.leadId
    case 'occurred_at':   return lead.occurredAt
    case 'contact_name':  return lead.name
    case 'contact_email': return lead.email
    case 'contact_phone': return lead.phone
    case 'ad_id':         return lead.adId
    case 'ad_name':       return lead.adName
    case 'adset_id':      return lead.adsetId
    case 'adset_name':    return lead.adsetName
    case 'campaign_id':   return lead.campaignId
    case 'campaign_name': return lead.campaignName
    case 'form_id':       return lead.formId
    case 'form_name':     return lead.formName
    case 'platform':      return lead.platform
    case 'is_organic':    return lead.isOrganic === null ? null : String(lead.isOrganic)
    case 'answer':        return col.key ? (lead.answers[col.key] ?? null) : null
    case 'literal':       return col.value ?? null
    case 'blank':         return null
  }
}

/** 渲染一列。返回的永远是字符串（空 = `''`）。 */
export function buildCell(
  lead: LeadRecord,
  col: LeadSheetColumn,
  route: LeadSheetRoute,
  notes: RowNotes,
): string {
  let v =
    col.field === 'occurred_at' && col.format === 'local'
      ? formatLocalMinute(lead.occurredAt, route.timezone)
      : rawValue(lead, col)

  if (v === null || v === '') {
    // 'blank' 是配置故意留白的占位列（人工维护的那些），不算「想填没填上」。
    if (col.field !== 'blank' && col.field !== 'literal') notes.blankedFields.push(col.field)
    return ''
  }

  if (col.mapped) {
    const key = normaliseAnswerValue(v)
    const label = route.valueLabels[key]
    if (label === undefined) {
      // 🔴 查不到**原样输出**，不留空。留空 = 销售看到一列空白，不知道客人选了什么；
      //    原样输出至少是真话，而且会在回执里被点名，好补配置。
      notes.unmappedValues.push(key)
    } else {
      v = label
    }
  }

  return col.prefix ? `${col.prefix}${v}` : v
}

/** 渲染整行。长度恒等于 `route.columns.length`。 */
export function buildRow(lead: LeadRecord, route: LeadSheetRoute, notes: RowNotes): string[] {
  return route.columns.map((col) => buildCell(lead, col, route, notes))
}

/**
 * 一行的判重键。
 *
 * 用「渲染出来的单元格文本」而不是 lead id 本身，是为了能跟**别人写的行**对上 ——
 * 表里已经有的行我们只看得到文本，看不到它背后是哪条 lead。CTS 的旧表本来就有
 * 另一条管道（客户自己的 Zapier/Make）在写，判重必须建立在「表里看得见的东西」上。
 */
export function dedupKey(cells: readonly string[], dedupColumns: readonly number[]): string {
  return dedupColumns.map((i) => (cells[i] ?? '').trim().toLowerCase()).join(KEY_SEP)
}

/** 判重键全空 = 这行没有可比的身份，当成「不在表里」而不是「已存在」。 */
export function isUsableDedupKey(key: string): boolean {
  return key.split(KEY_SEP).some((part) => part !== '')
}
