/**
 * 「全部客人」横表的**客户专属列**（如 CTS 的「感兴趣的团」）。
 *
 * 为什么是数据驱动、不是配置：
 * ---------------------------------------------------------------------------
 * tour 兴趣只有旅行社客户用得上，别的客户（Oztop 建材…）没有。一个很自然的
 * 想法是给 clients.leads_config 存「这个客户显示哪些列」。但那一套（配置字段 +
 * seed + Settings UI）为了一个列太重，而且按 CLAUDE.md「加字段没配 UI = 产品
 * 缺陷」的红线，配置字段必须连 UI 一起做。
 *
 * 这里换成更省的判据：**谁有数据谁显示**。某客户任一联系人有非空的该列值，
 * 这列就出现；全客户都没数据就自动隐藏。CTS 有 tour 数据 → 自动显示；别的
 * 客户没有 → 自动不显示。零配置、零 migration、零红线。等真出现第二个需要
 * 「按客户改名 / 排序」的列时，再正经上 leads_config + 配置页。
 *
 * 纯函数：只吃触点、吐值，不碰 supabase / 环境，client / server 都能引，单测钉死。
 */

/** 稳定英文 slug（代码引用，永不改）。加新列在这里扩联合类型 —— 强制同步下游。 */
export type CustomColumnKey = 'tour_interest'

/** extract 需要的最小触点形状。GET 读模型按这个投喂。 */
export interface TouchpointForColumn {
  channel: string
  occurredAt: string
  metadata: Record<string, unknown> | null
}

export interface CustomColumnDef {
  key: CustomColumnKey
  /** 表头（板桥定：说「团」不说「tour」）。 */
  label: string
  /** 从这个人的全部触点里抽出该列的值；没有就 null。 */
  extract: (touchpoints: TouchpointForColumn[]) => string | null
}

export interface CustomColumnMeta {
  key: CustomColumnKey
  label: string
}

function ts(v: string | null | undefined): number {
  if (!v) return 0
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * 模型 / 表单偶尔把「没有」写成字符串 "null"/"none"/"—"。原样留着，后面所有
 * 「有没有值」的判断都会把它当成有值，那列就永远显示、还全是垃圾。清掉。
 */
function cleanValue(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  if (/^(null|none|n\/?a|unknown|-|—)$/i.test(s)) return null
  return s
}

/**
 * 感兴趣的团。确定性两级取值（钉死成一个规则，防提示词一改就漂）：
 *   ① meta_lead_form 触点上的 tour_interest_raw —— 客户自己在 FB 表单下拉选的，
 *      最干净、最该信；多条取最近一条非空。
 *   ② 没有再退回手工笔记解析出的 metadata.tour_interest（最近一条非空）。
 * 实务上①覆盖几乎所有 FB 来源，②只对纯手工联系人生效。都没有就 null。
 */
function extractTourInterest(touchpoints: TouchpointForColumn[]): string | null {
  const byRecent = [...touchpoints].sort((a, b) => ts(b.occurredAt) - ts(a.occurredAt))

  for (const t of byRecent) {
    if (t.channel === 'meta_lead_form') {
      const raw = cleanValue(t.metadata?.tour_interest_raw)
      if (raw) return raw
    }
  }
  for (const t of byRecent) {
    const parsed = cleanValue(t.metadata?.tour_interest)
    if (parsed) return parsed
  }
  return null
}

/** 可用自定义列注册表。加列：在这里追加 + 扩 CustomColumnKey 联合类型。 */
export const CUSTOM_COLUMNS: CustomColumnDef[] = [
  { key: 'tour_interest', label: '感兴趣的团', extract: extractTourInterest },
]

/** 一个联系人的全部自定义列值（GET 逐人算，横表逐格渲染）。 */
export function extractCustomColumns(
  touchpoints: TouchpointForColumn[],
): Record<CustomColumnKey, string | null> {
  const out = {} as Record<CustomColumnKey, string | null>
  for (const col of CUSTOM_COLUMNS) out[col.key] = col.extract(touchpoints)
  return out
}

/**
 * 这个客户该显示哪些自定义列 —— 数据驱动：任一联系人有非空值就显示。
 * 传入的是「每个联系人的自定义列值」（即 extractCustomColumns 的结果数组）。
 */
export function visibleCustomColumns(
  perContact: Array<Record<CustomColumnKey, string | null>>,
): CustomColumnMeta[] {
  return CUSTOM_COLUMNS.filter((col) => perContact.some((v) => v[col.key] != null)).map((col) => ({
    key: col.key,
    label: col.label,
  }))
}
