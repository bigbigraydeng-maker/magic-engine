/**
 * Meta Graph API — Lead Ads 即时表单（只读）。
 *
 * WHY
 * ---
 * 在这之前，Facebook 表单来的人**只能靠人手导 CSV** 进 ME
 * （`scripts/import-cts-fb-leads.ts` 头部自己写着「这是历史存量的搬运，不是长期
 * 管道」）。2026-07-30 查 CTS 时的实测后果：CRM 里最后一个新人停在 7/25，而 Meta
 * 后台 7/26–7/30 又进了 27 个人 —— 销售的「今天该联系谁」里一个都没有，广告每天
 * 还在花 NZ$78–85。这个模块就是那条缺失的管道的取数端。
 *
 * 只读。这里不写 Meta 的任何东西。
 *
 * 权限：Page Access Token 需要 `leads_retrieval`（外加 `pages_show_list` /
 * `pages_manage_ads` 之一才能列出表单）。ME 现有的私信同步用的是同一个 Page token
 * （`pages_messaging`），**但 leads_retrieval 是另一个权限，不保证已经有** ——
 * 所以取数失败时把 Graph 的原话原样带回去（见 GraphError），让 cron 日志能直接告诉
 * 人「缺哪个权限」，而不是静默返回 0 条、看起来像「今天没人填表」。
 *
 * 字段兜底：Graph 对 lead 节点的字段名偶有版本差异，请求到一个不认识的字段会让
 * **整次调用**报错、当天的 lead 全丢。所以完整字段失败一次就退回最小字段集
 * （id / created_time / field_data）重试 —— 宁可丢归因，不丢人。
 */

const GRAPH_BASE = 'https://graph.facebook.com/v20.0'

/** 翻页上限，防跑飞用，不是真实业务上限。 */
const MAX_PAGES = 20

/** 一次表单提交里的一个问答。`name` 是 Meta 的字段名，不是给人看的问题文案。 */
export interface MetaLeadAnswer {
  name: string
  value: string
}

export interface MetaLeadForm {
  formId: string
  name: string | null
  status: string | null
}

export interface MetaLead {
  leadId: string
  /** ISO。Meta 返回 "2026-07-28T04:19:48+0000" 这种带非标准时区的写法，已归一。 */
  createdTime: string
  formId: string | null
  adId: string | null
  adName: string | null
  adsetId: string | null
  campaignId: string | null
  /** 'fb' / 'ig'。ME 的归因不区分（都算 'meta'），只存进 metadata 备查。 */
  platform: string | null
  /** true = 自然贴文里的表单，不是广告带来的。拿不到时 null，不假装 false。 */
  isOrganic: boolean | null
  answers: MetaLeadAnswer[]
}

/**
 * 取数结果。`error` 非空时 `rows` 可能是**部分**数据（翻到一半断了），
 * 调用方要按「没跑完」处理，别把半截当全量。
 */
export interface GraphRead<T> {
  rows: T[]
  error: string | null
}

interface GraphList<T> {
  data?: T[]
  paging?: { next?: string }
}

type GraphGet<T> = { json: T; error: null } | { json: null; error: string }

async function graphGet<T>(url: string, label: string): Promise<GraphGet<T>> {
  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    return { json: null, error: `${label} 网络错误: ${String(err)}` }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { json: null, error: `${label} HTTP ${res.status}: ${body.slice(0, 400)}` }
  }
  try {
    return { json: (await res.json()) as T, error: null }
  } catch (err) {
    return { json: null, error: `${label} 返回不是 JSON: ${String(err)}` }
  }
}

/**
 * Meta 的 "2026-07-28T04:19:48+0000" ISO 变体 → 标准 ISO。
 * 认不出来就返回 null —— 一条没有可信时间的 lead，写进去会污染「最近联系时间」
 * 和冷热分级，不如不写。
 */
export function normaliseGraphTime(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  // +0000 / -0500 补成 +00:00 / -05:00，否则部分运行时 parse 不了。
  const fixed = raw.trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  const ms = Date.parse(fixed)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

interface RawForm {
  id?: string
  name?: string
  status?: string
}

/** 这个 Page 下的所有即时表单。含已停用的 —— 停用的表单仍会有历史 lead 要补。 */
export async function fetchPageLeadForms(
  pageId: string,
  pageAccessToken: string,
): Promise<GraphRead<MetaLeadForm>> {
  const params = new URLSearchParams({
    fields: 'id,name,status',
    limit: '100',
    access_token: pageAccessToken,
  })

  let url: string | undefined = `${GRAPH_BASE}/${pageId}/leadgen_forms?${params.toString()}`
  const rows: MetaLeadForm[] = []

  for (let page = 0; page < MAX_PAGES && url; page++) {
    // 显式标类型：url 在循环里被 got 的结果重新赋值，不标就绕成循环推断（TS7022）。
    const got: GraphGet<GraphList<RawForm>> = await graphGet(url, 'leadgen_forms')
    // 必须 `!== null`：空串也是合法 string，真值判断收窄不掉出错那一支。
    if (got.error !== null) return { rows, error: got.error }

    for (const raw of got.json.data ?? []) {
      if (!raw.id) continue
      rows.push({ formId: raw.id, name: raw.name ?? null, status: raw.status ?? null })
    }
    url = got.json.paging?.next
  }

  return { rows, error: null }
}

interface RawLead {
  id?: string
  created_time?: string
  form_id?: string
  ad_id?: string
  ad_name?: string
  adset_id?: string
  campaign_id?: string
  platform?: string
  is_organic?: boolean
  field_data?: Array<{ name?: string; values?: string[] }>
}

/** 完整字段。归因就靠这几列 —— 拿到了才知道「这个人是哪条广告带来的」。 */
const LEAD_FIELDS_FULL =
  'id,created_time,form_id,ad_id,ad_name,adset_id,campaign_id,platform,is_organic,field_data'

/** 兜底字段。只要 Graph 还认这三个，人就丢不了（归因为空是可接受的降级）。 */
const LEAD_FIELDS_MINIMAL = 'id,created_time,field_data'

function parseLead(raw: RawLead): MetaLead | null {
  if (!raw.id) return null
  const createdTime = normaliseGraphTime(raw.created_time)
  if (!createdTime) return null

  const answers: MetaLeadAnswer[] = []
  for (const f of raw.field_data ?? []) {
    const name = typeof f.name === 'string' ? f.name.trim() : ''
    const value = (f.values ?? []).find((v) => typeof v === 'string' && v.trim())
    if (!name || !value) continue
    answers.push({ name, value: value.trim() })
  }

  return {
    leadId: raw.id,
    createdTime,
    formId: raw.form_id ?? null,
    adId: raw.ad_id ?? null,
    adName: raw.ad_name ?? null,
    adsetId: raw.adset_id ?? null,
    campaignId: raw.campaign_id ?? null,
    platform: raw.platform ?? null,
    isOrganic: typeof raw.is_organic === 'boolean' ? raw.is_organic : null,
    answers,
  }
}

function leadsUrl(formId: string, token: string, sinceUnix: number, fields: string): string {
  const params = new URLSearchParams({
    fields,
    limit: '100',
    access_token: token,
    // Meta 的 lead 边不支持 since/until，只支持 filtering。时间戳是秒。
    filtering: JSON.stringify([
      { field: 'time_created', operator: 'GREATER_THAN', value: sinceUnix },
    ]),
  })
  return `${GRAPH_BASE}/${formId}/leads?${params.toString()}`
}

/**
 * `truncated` 跟 `error` 要分开：翻页翻不完是**结果**的问题（换字段没用，
 * 重试只会再烧 20 次请求），字段被拒才是**请求**的问题（值得换字段重试一次）。
 */
interface LeadWalk extends GraphRead<MetaLead> {
  truncated: boolean
}

async function walkLeads(firstUrl: string): Promise<LeadWalk> {
  let url: string | undefined = firstUrl
  const rows: MetaLead[] = []

  for (let page = 0; page < MAX_PAGES && url; page++) {
    const got: GraphGet<GraphList<RawLead>> = await graphGet(url, 'leads')
    if (got.error !== null) return { rows, error: got.error, truncated: false }

    for (const raw of got.json.data ?? []) {
      const lead = parseLead(raw)
      if (lead) rows.push(lead)
    }
    url = got.json.paging?.next
  }

  // 还攥着 cursor 就退出 = 被上限截断了。静默截断跟「跑完了」长得一模一样。
  if (url) {
    return { rows, error: `leads 翻页到第 ${MAX_PAGES} 页仍未结束，结果被截断`, truncated: true }
  }

  return { rows, error: null, truncated: false }
}

/**
 * 一个表单在 `since` 之后的全部 lead。
 *
 * 先要完整字段；整次调用被 Graph 拒掉时退回最小字段集重试一次 —— 拿不到归因
 * 好过整批人丢掉。两次都失败才如实报错。
 */
export async function fetchFormLeads(
  formId: string,
  pageAccessToken: string,
  since: Date,
): Promise<GraphRead<MetaLead>> {
  const sinceUnix = Math.floor(since.getTime() / 1000)

  const full = await walkLeads(leadsUrl(formId, pageAccessToken, sinceUnix, LEAD_FIELDS_FULL))
  // 翻页截断换字段也救不了（结果太多，不是请求写错），原样回报即可。
  if (!full.error || full.truncated) return { rows: full.rows, error: full.error }

  console.warn(`[meta/lead-forms] 表单 ${formId} 完整字段失败，退回最小字段集：${full.error}`)

  const minimal = await walkLeads(leadsUrl(formId, pageAccessToken, sinceUnix, LEAD_FIELDS_MINIMAL))
  if (minimal.error) {
    return { rows: minimal.rows, error: `${full.error} / 兜底也失败: ${minimal.error}` }
  }
  return minimal
}
