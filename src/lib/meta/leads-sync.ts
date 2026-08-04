/**
 * Facebook 即时表单 → CRM 每小时自动同步。
 *
 * 这是「新人自动进 CRM」那条链的编排层：找表单 → 拉新 lead → 建人 / 合并 → 写触点。
 * 取数在 `meta/lead-forms.ts`，建人写触点在 `crm/meta-lead.ts`，这里只管调度和纪律。
 *
 * 开关跟私信同步同一个：只同步 `clients.facebook_page_id` 有值的客户
 * （设置页里选了主页才有）。新增客户不用改代码。
 *
 * 三条纪律（对着 docs/clients/cts/three-islands-crm-integration-plan.md 的防护清单）：
 *   · **逐条 try/catch continue** —— 一条脏 lead / 一个坏表单，不能让这个客户剩下的
 *     lead 全部放弃（防护 C；私信同步当年就是整个循环共用一个 try 才踩的坑）。
 *   · **失败要说人话** —— 取数报错原样带回 cron 日志。缺 `leads_retrieval` 权限跟
 *     「今天真的没人填表」在数据上长得一模一样，不带原因就永远查不出来。
 *   · **不静默截断** —— 部分失败照样把已拿到的写进去，但结果里标 `error`，
 *     别让半截当成跑完了。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getMetaTokenForClient, getStoredPageToken } from '@/lib/meta/token-manager'
import { getPageAccessToken } from '@/lib/meta/page-posts'
import { fetchFormLeads, fetchPageLeadForms } from '@/lib/meta/lead-forms'
import { ingestMetaLead } from '@/lib/crm/meta-lead'

export interface MetaLeadsSyncClient {
  id: string
  name: string | null
  facebook_page_id: string | null
  country: string | null
  semrush_db: string | null
}

export interface MetaLeadsSyncResult {
  clientId: string
  clientName: string | null
  /** 这次扫了多少个表单。 */
  forms: number
  /** Meta 在窗口内返回了多少条 lead（含已经存在的）。 */
  leadsFetched: number
  /** 真正接进 CRM 的（新写 + 已存在的幂等命中都算「接上了」）。 */
  leadsIngested: number
  /** 其中让系统多出一个新人的条数 —— 这才是 PM 关心的「今天进了几个新人」。 */
  newContacts: number
  /** 电话邮箱都不成形，没建人。 */
  skippedNoIdentity: number
  /** 单条出错跳过的条数。 */
  failed: number
  skipped?: 'no_page_id' | 'no_meta_token' | 'no_page_token'
  error?: string
}

/**
 * 往回多拉一段再同步一次，而不是只拉「比上次新的」。
 * Meta 侧 lead 偶有延迟入库，卡死在水位线上会让那几条永远补不回来。
 */
const WATERMARK_LOOKBACK_MS = 24 * 60 * 60 * 1000

/** 第一次跑（库里一条 Meta 表单触点都没有）往回补多久。 */
const FIRST_RUN_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000

/** 任何情况下都不往回超过这个范围 —— 防止一次 cron 把几年的历史全拉一遍。 */
const MAX_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000

/**
 * 从哪一刻开始拉。
 *
 * 用「库里最新一条 Meta 表单触点的时间」当水位线（而不是另开一张同步状态表）：
 * 触点本身就是幂等的真相源，重叠区间重跑只会命中唯一键、不产生重复。
 */
export async function getLeadWatermark(clientId: string, now: Date = new Date()): Promise<Date> {
  const { data } = await supabaseAdmin
    .from('contact_touchpoints')
    .select('occurred_at')
    .eq('client_id', clientId)
    .eq('channel', 'meta_lead_form')
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const floor = new Date(now.getTime() - MAX_LOOKBACK_MS)
  const newest = data?.occurred_at ? Date.parse(data.occurred_at as string) : NaN

  const since = Number.isFinite(newest)
    ? new Date(newest - WATERMARK_LOOKBACK_MS)
    : new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS)

  return since < floor ? floor : since
}

/** 本地号码补哪个国码。跟 web-form-lead.ts 同一套判断。 */
export function resolveDefaultCountry(client: {
  country: string | null
  semrush_db: string | null
}): 'NZ' | 'AU' {
  return client.country === 'NZ' || client.semrush_db === 'nz' ? 'NZ' : 'AU'
}

/** 把一个客户 Facebook 表单里的新 lead 拉进 CRM。永不抛异常。 */
export async function syncClientMetaLeads(
  client: MetaLeadsSyncClient,
): Promise<MetaLeadsSyncResult> {
  const base = {
    clientId: client.id,
    clientName: client.name,
    forms: 0,
    leadsFetched: 0,
    leadsIngested: 0,
    newContacts: 0,
    skippedNoIdentity: 0,
    failed: 0,
  }

  const pageId = client.facebook_page_id
  if (!pageId) return { ...base, skipped: 'no_page_id' }

  // 跟私信同步同一条取 token 的路：先用「连接 Meta」按钮存下来的 Page token，
  // 没有再从 env 里的 user token 换一个。
  let pageToken = await getStoredPageToken(client.id, pageId)
  if (!pageToken) {
    const userToken = await getMetaTokenForClient(client.id)
    if (!userToken) return { ...base, skipped: 'no_meta_token' }
    pageToken = await getPageAccessToken(userToken, pageId)
  }
  if (!pageToken) return { ...base, skipped: 'no_page_token' }

  const defaultCountry = resolveDefaultCountry(client)
  const errors: string[] = []

  const formsRead = await fetchPageLeadForms(pageId, pageToken)
  if (formsRead.error) errors.push(formsRead.error)
  // 表单一个都没列出来 + 有报错 = 取数就没通（多半是 token 缺 leads_retrieval）。
  // 直接如实回报，别让它看起来像「今天没人填表」。
  if (formsRead.rows.length === 0) {
    return { ...base, ...(errors.length ? { error: errors.join(' | ') } : {}) }
  }

  const since = await getLeadWatermark(client.id)

  let forms = 0
  let leadsFetched = 0
  let leadsIngested = 0
  let newContacts = 0
  let skippedNoIdentity = 0
  let failed = 0

  for (const form of formsRead.rows) {
    forms++
    try {
      const leadsRead = await fetchFormLeads(form.formId, pageToken, since)
      if (leadsRead.error) errors.push(`表单 ${form.formId}: ${leadsRead.error}`)
      leadsFetched += leadsRead.rows.length

      for (const lead of leadsRead.rows) {
        // ingestMetaLead 自己吞异常，这里的 try 是给「它之外还能炸的东西」兜底。
        const res = await ingestMetaLead({ clientId: client.id, defaultCountry, lead })
        if (res.skipped === 'no_identity') skippedNoIdentity++
        else if (res.skipped === 'error') failed++
        else {
          leadsIngested++
          if (res.createdContact) newContacts++
        }
      }
    } catch (err) {
      // 一个坏表单不牵连这个客户剩下的表单。
      failed++
      errors.push(`表单 ${form.formId} 整体失败: ${String(err)}`)
    }
  }

  return {
    ...base,
    forms,
    leadsFetched,
    leadsIngested,
    newContacts,
    skippedNoIdentity,
    failed,
    ...(errors.length ? { error: errors.join(' | ') } : {}),
  }
}
