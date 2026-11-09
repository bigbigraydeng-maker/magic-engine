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
 * 判重用的单元格归一化。
 *
 * 只吃掉「同一个值的不同写法」：首尾空白、大小写、以及人顺手加的空格 / 连字符 /
 * 括号（销售把 `+64211914575` 规整成 `+64 21 191 4575` 是每天都会发生的事）。
 * **不做任何语义转换** —— 不把 `021…` 换算成 `+6421…`，那属于猜。
 */
function normaliseDedupCell(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s\-()]/g, '')
}

/** 机器键的前缀段，跟「看得见的身份」那种键区分开。 */
const ID_KEY_TAG = 'id'

/**
 * 一行的**全部**判重键（能用的那些）。
 *
 * 一行最多产生两把：
 *   · 机器键 —— `idColumn` 那一列（lead id 这种机器写、人不会改的值）非空时才有。
 *   · 身份键 —— `dedupColumns` 拼出来的「看得见的身份」（时间 + 电话这种）。
 *
 * 🔴 **两把都要算，判重时任一撞上就算「表里已经有了」**。
 *
 *    只留机器键不行：表里已有的老行（PM 手填的、外部管道写的）**根本没有那一列**，
 *    算不出机器键 —— 我们算出机器键、它们算出身份键，两边永远对不上，
 *    于是把人家手填好的行**整批重写一遍**。（这个回归是 2026-09-24 用生产数据
 *    试算时当场撞出来的：改成只用机器键之后，「表里已有」从 3 掉到 0。）
 *
 *    只留身份键也不行：销售在表里把电话排版一下、或者有人改了时间列的显示格式，
 *    键就变了 → 下一轮判成「表里没有」→ **再追加一行**，而销售的跟进记录
 *    会被劈到两行上。
 *
 *    两把一起用，两种情况都盖住：老行靠身份键认出来，我们自己写过的行
 *    以后靠机器键认出来（人怎么编辑都不影响）。
 */
export function dedupKeys(
  cells: readonly string[],
  dedupColumns: readonly number[],
  idColumn?: number,
): string[] {
  const keys: string[] = []

  if (idColumn !== undefined) {
    const id = normaliseDedupCell(cells[idColumn] ?? '')
    if (id !== '') keys.push(`${ID_KEY_TAG}${KEY_SEP}${id}`)
  }

  const identity = dedupColumns.map((i) => normaliseDedupCell(cells[i] ?? '')).join(KEY_SEP)
  /**
   * 🔴 身份键**要求每一段都非空**，不是「有一段非空就行」。
   *    想清楚过的反例：判重列是「留资时间 + 电话」，两个人同一分钟填了同一张表单、
   *    其中一个拿不到电话 —— 按「任一段非空」两条会算出同一把键，第二条被当成
   *    「表里已经有了」**永远不会写**，而且它在回执里跟真正的重复行分不开。
   *    线索就这么丢了，Facebook 90 天后还取不回来。
   */
  if (identity.split(KEY_SEP).every((part) => part !== '')) keys.push(identity)

  return keys
}
