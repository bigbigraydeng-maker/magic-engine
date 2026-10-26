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
import { authorizePageSync } from '@/lib/meta/page-sync-authorization'
import { fetchFormLeads, fetchPageLeadForms } from '@/lib/meta/lead-forms'
import { ingestMetaLead, parseLeadAnswers } from '@/lib/crm/meta-lead'
import { ALREADY_SYNCED_REASON, isMailchimpSettled } from '@/lib/mailchimp/outlet-tally'
import { classifyBrokenPageToken, metaPageSyncHeld, rememberBrokenPageToken } from '@/lib/meta/broken-page-token'
import type { SubscribeMemberResult } from '@/lib/mailchimp/client'
import type { TagRepair } from '@/lib/mailchimp/tags'

/** 出口结果 + 「已在名单里的人标签补打」的结论。 */
type MailchimpOutcome = SubscribeMemberResult & { tagRepair?: TagRepair }

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
  /**
   * 「这条上轮办完没有」这个查询失败了几批。
   *
   * **不混进 `mailchimp` tally** —— 那是出口结果，混进去会被日报和今日待办当成
   * 出口故障误报。这个数只说「去重闸这轮有没有瞎掉」：大于 0 时闸退化成改动前的
   * 每轮重打，不丢数据、但白花 provider 调用，而且**看起来跟正常运行一模一样**。
   */
  settledLookupFailures: number
  /**
   * Mailchimp 出口这一轮的结果分布，key = `subscribed` / `already_member` /
   * `skipped:<reason>` / `failed:<reason>`，value = 条数。
   *
   * **为什么要有这个字段**：在此之前 `ingestMetaLead` 返回的 `mailchimp` 结果
   * 在这一层被整个丢掉 —— 不计数、不上报。于是 2026-08~09 生产上「每一条
   * lead 的 Mailchimp 出口都因为读不到配置被 skip」这件事，在 cron 日志里
   * **一个字都看不到**（`clients.mailchimp_audience_id` 那一列根本没 apply，
   * 见 `lib/mailchimp/audience-config.ts`）。这个 tally 会进
   * `cron_run_logs.summary.results`，让「跳过了」和「真没有」能被分开看。
   *
   * 没有任何 lead 进到出口时是 `{}`，不是缺字段。
   */
  mailchimp: Record<string, number>
  skipped?: 'no_page_id' | 'no_meta_token' | 'no_page_token' | 'page_not_verified' | 'connection_unhealthy'
  error?: string
}

/**
 * 把一条 `SubscribeMemberResult` 压成 tally 的 key。
 *
 * `already_member` 会再分一岔：人确实在名单里（会员关系为真），但**来源标签
 * 没补上**时必须单独成一个 key。否则它跟一切正常的 `already_member` 混在一起，
 * 广告归因证据整月落不了地这件事就又变回「日志里看不见」——这条链路 2026-09
 * 刚栽过一次同样的跟头。
 */
function mailchimpTallyKey(res: MailchimpOutcome): string {
  if (res.status === 'skipped' || res.status === 'failed') return `${res.status}:${res.reason}`
  if (res.status === 'already_member' && res.tagRepair?.startsWith('failed:')) {
    return `already_member:tag_${res.tagRepair}`
  }
  return res.status
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

/**
 * 一次 `.in()` 最多塞多少个 lead id。
 *
 * 单个表单最多能返回 2000 条 lead（`lead-forms.ts` 的 `MAX_PAGES` × `limit`）。
 * 整批塞进一个 `.in()` 会撞请求体积上限 —— **这堵墙本仓已经撞过一次**：
 * `knowledge/mining.ts:655-667`，2026-09-15 issue #1760，722 个 UUID 拼出的
 * querystring 就把 PostgREST/反代顶爆返回 400。200 沿用那次验证过的经验安全值
 * （不是精确算出来的边界），保持两处一致，将来要调一起调。
 *
 * 切到 200 之后顺带把另一个坑也堵死：触点表唯一键是
 * `(client_id, source, source_ref)`，一个 id 最多命中一行 → 一批最多 200 行，
 * PostgREST 那个 1000 行默认上限**在结构上够不着**，所以这里不需要再套分页
 * （合并机器人 07267cf1 / a2860d16 时的取舍，见那两条提交）。
 */
const SETTLED_LOOKUP_BATCH = 200

/**
 * 这一批 lead 里，哪些上一轮已经办完了（触点里的 Mailchimp 回执已是终态）。
 *
 * **按批查，不逐条查** —— 逐条查正是这次要修的那种浪费。
 *
 * 为什么切批而不是分页读全量（合并 07267cf1 时的取舍）：单表单最多能回补 2000 条
 * （`lead-forms.ts` 的 `MAX_PAGES` × `limit`），一次性塞进 `.in()` 有两个坑 ——
 * 2000 个 17 位 id 拼出的 query string 约 34KB 会被网关按 414 打回，以及 PostgREST
 * 单次查询 1000 行硬顶会**静默截断**。切成每批 `SETTLED_LOOKUP_BATCH` 条之后：
 *   · query string 永远在 4KB 量级，414 打不到；
 *   · 触点表的唯一键是 `(client_id, source, source_ref)`，一个 id 最多命中一行，
 *     所以一批最多 200 行 —— **1000 行硬顶在结构上够不着**，不需要再套分页。
 * 两个坑一起堵掉，比只堵后一个更严。
 *
 * 读失败当没办完，照常重跑 —— 宁可多打一次，不可漏一次。但**必须出声**：这道闸
 * 静默失效的样子跟它正常工作一模一样（都是「照常重跑」），不喊一嗓子没有任何人
 * 会发现。所以除了 `console.warn`（只进 Render 日志，没人看），还把「这轮有几批
 * 没读成」一路带回 `MetaLeadsSyncResult`，进 `cron_run_logs.summary`。
 */
export async function readSettledLeadIds(
  clientId: string,
  leadIds: string[],
): Promise<{ settled: Set<string>; lookupFailures: number }> {
  const settled = new Set<string>()
  let failures = 0
  if (leadIds.length === 0) return { settled, lookupFailures: failures }

  for (let i = 0; i < leadIds.length; i += SETTLED_LOOKUP_BATCH) {
    const batch = leadIds.slice(i, i + SETTLED_LOOKUP_BATCH)
    const { data, error } = await supabaseAdmin
      .from('contact_touchpoints')
      .select('source_ref, metadata')
      .eq('client_id', clientId)
      // 用 `source` 不是 `channel`：`(client_id, source, source_ref)` 才是触点的
      // 幂等唯一键（`meta-lead.ts` 的 Phase A upsert 用的就是它），`channel` 只是
      // 业务分类。上面 `getLeadWatermark` 查 `channel` 是另一回事，两处都对，
      // 但**别顺手统一**成同一列 —— 统一哪一边都会炸掉另一边。
      .eq('source', 'meta_lead_form')
      .in('source_ref', batch)

    if (error || !data) {
      console.warn(
        `[meta-leads] client ${clientId} 读已办完回执失败，这批 ${batch.length} 条全部重跑: ${error?.message ?? 'no data'}`,
      )
      failures++
      continue
    }

    for (const row of data as Array<{ source_ref?: unknown; metadata?: unknown }>) {
      const ref = typeof row.source_ref === 'string' ? row.source_ref : ''
      if (!ref) continue
      const meta = row.metadata
      if (typeof meta !== 'object' || meta === null) continue
      if (isMailchimpSettled((meta as { mailchimp_result?: unknown }).mailchimp_result)) {
        settled.add(ref)
      }
    }
  }
  return { settled, lookupFailures: failures }
}

/** 本地号码补哪个国码。跟 web-form-lead.ts 同一套判断。 */
export function resolveDefaultCountry(client: {
  country: string | null
  semrush_db: string | null
}): 'NZ' | 'AU' {
  return client.country === 'NZ' || client.semrush_db === 'nz' ? 'NZ' : 'AU'
}

/** 报错里全是坏令牌时标成「等重连」，并记进暂停名单。混着真错误则只留 error。 */
async function withBrokenToken(
  clientId: string,
  pageId: string,
  error: string | undefined,
): Promise<{ error?: string; skipped?: 'connection_unhealthy' }> {
  if (!error) return {}
  await rememberBrokenPageToken(supabaseAdmin, clientId, pageId, error)
  return classifyBrokenPageToken(error) ? { error, skipped: 'connection_unhealthy' } : { error }
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
    settledLookupFailures: 0,
    mailchimp: {} as Record<string, number>,
  }

  const pageId = client.facebook_page_id
  if (!pageId) return { ...base, skipped: 'no_page_id' }

  if (await metaPageSyncHeld(supabaseAdmin, client.id, pageId)) {
    return { ...base, skipped: 'connection_unhealthy' }
  }

  // 跟私信同步同一道闸（AD-SEC-4）：主页核实过属于这个客户才取令牌。
  // 取令牌顺序不变：先用「连接 Meta」存下的 Page token，没有再从 env 里的 user token 换。
  const auth = await authorizePageSync(supabaseAdmin, client.id, pageId, process.env)
  if (!auth.ok) {
    if (auth.skipped !== 'page_not_verified') return { ...base, skipped: auth.skipped }
    const error = `主页绑定没核实，线索同步已暂停（${auth.reason}）`
    await rememberBrokenPageToken(supabaseAdmin, client.id, pageId, error)
    return { ...base, skipped: auth.skipped, error }
  }
  const pageToken = auth.pageToken

  const defaultCountry = resolveDefaultCountry(client)
  const errors: string[] = []

  const formsRead = await fetchPageLeadForms(pageId, pageToken)
  if (formsRead.error) errors.push(formsRead.error)
  // 表单一个都没列出来 + 有报错 = 取数就没通（多半是 token 缺 leads_retrieval）。
  // 直接如实回报，别让它看起来像「今天没人填表」。
  if (formsRead.rows.length === 0) {
    const error = errors.length ? errors.join(' | ') : undefined
    return { ...base, ...(await withBrokenToken(client.id, pageId, error)) }
  }

  const since = await getLeadWatermark(client.id)

  let forms = 0
  let leadsFetched = 0
  let leadsIngested = 0
  let newContacts = 0
  let skippedNoIdentity = 0
  let failed = 0
  let settledLookupFailures = 0
  const mailchimp: Record<string, number> = {}

  for (const form of formsRead.rows) {
    forms++
    try {
      const leadsRead = await fetchFormLeads(form.formId, pageToken, since)
      if (leadsRead.error) errors.push(`表单 ${form.formId}: ${leadsRead.error}`)
      leadsFetched += leadsRead.rows.length

      const settledRead = await readSettledLeadIds(
        client.id,
        leadsRead.rows.map((row) => row.leadId),
      )
      const settled = settledRead.settled
      settledLookupFailures += settledRead.lookupFailures

      for (const lead of leadsRead.rows) {
        // 上一轮已经办完的：零 provider 调用、零 metadata 覆盖，直接记账走人。
        //
        // 唯一例外 —— 本轮解析出**明确 opt-out** 的照常走完整流程。那一位会被写进
        // 触点 metadata 的 `do_not_contact`，以后拦住这个人所有渠道的外发（合同
        // 5426843158）；解析规则改宽之后，窗口内的老 lead 要还能被重新判一次。
        //
        // 取舍：办完之后就不再每轮回头看了。所以「有人在 Mailchimp 后台手工摘掉来源
        // 标签」这种事，原来 24 小时窗口内会被下一轮自愈，现在不会 —— 超出窗口本来
        // 也不自愈，这里只是把不自愈的起点从 24 小时提前到了办完那一刻。
        if (settled.has(lead.leadId) && parseLeadAnswers(lead.answers).optOutEvidence === null) {
          const key = `skipped:${ALREADY_SYNCED_REASON}`
          mailchimp[key] = (mailchimp[key] ?? 0) + 1
          // 它确实已经在 CRM 里，跟幂等命中同一口径算 ingested —— 这个数不能无声变样，
          // PM 每天看的「今天进了几个人」靠它。
          leadsIngested++
          continue
        }

        // ingestMetaLead 自己吞异常，这里的 try 是给「它之外还能炸的东西」兜底。
        const res = await ingestMetaLead({ clientId: client.id, defaultCountry, lead })
        // 出口结果先记账再分流 —— 无论这条 lead 后面算 ingested 还是 skipped，
        // 「它有没有进邮件名单」都必须留下痕迹。
        if (res.mailchimp) {
          const key = mailchimpTallyKey(res.mailchimp)
          mailchimp[key] = (mailchimp[key] ?? 0) + 1
        }
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

  const error = errors.length ? errors.join(' | ') : undefined
  return {
    ...base,
    forms,
    leadsFetched,
    leadsIngested,
    newContacts,
    skippedNoIdentity,
    failed,
    settledLookupFailures,
    mailchimp,
    ...(await withBrokenToken(client.id, pageId, error)),
  }
}
